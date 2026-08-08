// ============================================================================
// JSBattle — data layer.
//
// Two interchangeable backends behind one async interface:
//
//   SupabaseBackend  real accounts, global leaderboard, cross-device ranking
//   LocalBackend     localStorage only, single player, zero setup
//
// Which one is live is decided once at load from config.js. Every method is
// async on both so the view layer never has to care which it got.
//
// Interface:
//   init()                          -> Promise<void>
//   isRemote                        -> boolean
//   getUser()                       -> { id, username } | null
//   onChange(fn)                    -> subscribe to auth/user changes
//   signUp(email, pw, username)     -> { needsConfirmation }
//   signIn(email, pw)               -> void
//   signOut()                       -> void
//   submitScore(slug, score, chars, meta) -> { best, improved }
//   getMyScores()                   -> { [slug]: { score, char_count } }
//   getLevelLeaderboard(slug, n)    -> [{ username, score, char_count, rank }]
//   getGlobalLeaderboard(n)         -> [{ username, total_xp, levels_played, rank }]
//   getMyGlobalRank()               -> { rank, total_xp, levels_played } | null
// ============================================================================

const LS = {
  name: "jsbattle:playerName",
  scores: "jsbattle:scores:v2",
  draft: (slug) => `jsbattle:draft:${slug}`
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

// ----------------------------------------------------------------------------
// Local backend
// ----------------------------------------------------------------------------
const LocalBackend = {
  isRemote: false,
  _user: null,
  _listeners: [],

  async init() {
    const name = localStorage.getItem(LS.name);
    this._user = name ? { id: "local", username: name } : null;
  },

  getUser() {
    return this._user;
  },

  onChange(fn) {
    this._listeners.push(fn);
  },

  _emit() {
    this._listeners.forEach((fn) => fn(this._user));
  },

  // Local "auth" is just claiming a display name — email/password are ignored.
  async signUp(_email, _password, username) {
    localStorage.setItem(LS.name, username);
    this._user = { id: "local", username };
    this._emit();
    return { needsConfirmation: false };
  },

  async signIn(_email, _password) {
    throw new Error(
      "Sign-in needs a Supabase project. Right now you are playing locally — pick a display name instead."
    );
  },

  async signOut() {
    localStorage.removeItem(LS.name);
    this._user = null;
    this._emit();
  },

  isRecovering() {
    return false;
  },
  clearRecovery() {},

  async requestPasswordReset() {
    throw new Error("Password reset needs a Supabase project — local play has no password.");
  },

  async updatePassword() {
    throw new Error("Password reset needs a Supabase project — local play has no password.");
  },

  async updateUsername(username) {
    localStorage.setItem(LS.name, username);
    this._user = { id: "local", username };
    this._emit();
  },

  async getMyScores() {
    return readJson(LS.scores, {});
  },

  async submitScore(slug, score, charCount, meta) {
    const all = readJson(LS.scores, {});
    const prev = all[slug];
    const improved = !prev || score > prev.score;
    if (improved) {
      all[slug] = { score, char_count: charCount, meta, updated_at: Date.now() };
      localStorage.setItem(LS.scores, JSON.stringify(all));
    }
    return { best: all[slug].score, improved };
  },

  async getLevelLeaderboard(slug) {
    const all = readJson(LS.scores, {});
    const mine = all[slug];
    if (!mine || !this._user) return [];
    return [
      {
        username: this._user.username,
        score: mine.score,
        char_count: mine.char_count,
        rank: 1,
        isMe: true
      }
    ];
  },

  async getGlobalLeaderboard() {
    const rank = await this.getMyGlobalRank();
    return rank ? [{ ...rank, username: this._user.username, isMe: true }] : [];
  },

  async getMyGlobalRank() {
    if (!this._user) return null;
    const all = readJson(LS.scores, {});
    const entries = Object.values(all);
    return {
      rank: 1,
      total_xp: entries.reduce((sum, s) => sum + s.score, 0),
      levels_played: entries.length
    };
  }
};

// ----------------------------------------------------------------------------
// Supabase backend
// ----------------------------------------------------------------------------
const SupabaseBackend = {
  isRemote: true,
  _sb: null,
  _user: null,
  _listeners: [],

  async init() {
    const cfg = window.JSBATTLE_CONFIG;
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("supabase-js failed to load from the CDN.");
    }
    this._sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

    const { data } = await this._sb.auth.getSession();
    await this._syncUser(data.session);

    this._sb.auth.onAuthStateChange((event, session) => {
      // Supabase delivers recovery and confirmation tokens in the URL *hash*
      // — the same place this app keeps its router state. supabase-js consumes
      // and strips those params before we ever route, so we cannot detect a
      // recovery by reading location.hash. This event is the reliable signal.
      if (event === "PASSWORD_RECOVERY") {
        this._recovering = true;
        location.hash = "#/reset-password";
      }
      this._syncUser(session).then(() => this._emit());
    });
  },

  isRecovering() {
    return !!this._recovering;
  },

  clearRecovery() {
    this._recovering = false;
  },

  // Resolves the auth session into the { id, username } shape the app uses,
  // reading the display name from the profiles table.
  async _syncUser(session) {
    if (!session || !session.user) {
      this._user = null;
      return;
    }
    const { data: profile } = await this._sb
      .from("profiles")
      .select("username")
      .eq("id", session.user.id)
      .maybeSingle();

    this._user = {
      id: session.user.id,
      username: (profile && profile.username) || session.user.email || "player",
      email: session.user.email
    };
  },

  getUser() {
    return this._user;
  },

  onChange(fn) {
    this._listeners.push(fn);
  },

  _emit() {
    this._listeners.forEach((fn) => fn(this._user));
  },

  async signUp(email, password, username) {
    const { data, error } = await this._sb.auth.signUp({
      email,
      password,
      options: { data: { username } }
    });
    if (error) throw new Error(error.message);
    // With email confirmation enabled, signUp returns a user but no session.
    if (!data.session) return { needsConfirmation: true };
    await this._syncUser(data.session);
    this._emit();
    return { needsConfirmation: false };
  },

  async signIn(email, password) {
    const { data, error } = await this._sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    await this._syncUser(data.session);
    this._emit();
  },

  async signOut() {
    await this._sb.auth.signOut();
    this._user = null;
    this._emit();
  },

  // Sends the reset email. redirectTo deliberately carries no hash of its own:
  // Supabase appends its token params as a hash, and two hashes cannot coexist.
  // The PASSWORD_RECOVERY event in init() is what moves the player to the form.
  async requestPasswordReset(email) {
    const redirectTo = location.origin + location.pathname;
    const { error } = await this._sb.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw new Error(error.message);
  },

  async updatePassword(password) {
    const { error } = await this._sb.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    this._recovering = false;
  },

  async updateUsername(username) {
    if (!this._user) throw new Error("Sign in first.");
    const { error } = await this._sb
      .from("profiles")
      .update({ username })
      .eq("id", this._user.id);
    if (error) {
      throw new Error(
        /duplicate key|unique/i.test(error.message)
          ? "That display name is already taken."
          : error.message
      );
    }
    this._user.username = username;
    this._emit();
  },

  async getMyScores() {
    if (!this._user) return {};
    const { data, error } = await this._sb
      .from("scores")
      .select("level_slug, score, char_count")
      .eq("user_id", this._user.id);
    if (error) throw new Error(error.message);
    return Object.fromEntries(
      (data || []).map((r) => [r.level_slug, { score: r.score, char_count: r.char_count }])
    );
  },

  // The RPC upserts and refuses to lower an existing best, so a replayed or
  // out-of-order submission can never cost you points.
  async submitScore(slug, score, charCount, meta) {
    if (!this._user) throw new Error("Sign in to submit a score.");
    const { data, error } = await this._sb.rpc("submit_score", {
      p_level_slug: slug,
      p_score: score,
      p_char_count: charCount,
      p_meta: meta || {}
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    const best = row ? row.score : score;
    return { best, improved: best === score && row && row.char_count === charCount };
  },

  async getLevelLeaderboard(slug, limit = 10) {
    const { data, error } = await this._sb
      .from("level_rankings")
      .select("username, user_id, score, char_count, rank")
      .eq("level_slug", slug)
      .order("rank", { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);
    const meId = this._user && this._user.id;
    return (data || []).map((r) => ({ ...r, isMe: r.user_id === meId }));
  },

  async getGlobalLeaderboard(limit = 25) {
    const { data, error } = await this._sb
      .from("global_rankings")
      .select("username, user_id, total_xp, levels_played, rank")
      .order("rank", { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);
    const meId = this._user && this._user.id;
    return (data || []).map((r) => ({ ...r, isMe: r.user_id === meId }));
  },

  async getMyGlobalRank() {
    if (!this._user) return null;
    const { data, error } = await this._sb
      .from("global_rankings")
      .select("total_xp, levels_played, rank")
      .eq("user_id", this._user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data || null;
  }
};

// ----------------------------------------------------------------------------
// Pick a backend. If Supabase is configured but fails to come up, fall back to
// local rather than showing the player a dead app.
// ----------------------------------------------------------------------------
let Store = window.JSBATTLE_CONFIG.isConfigured ? SupabaseBackend : LocalBackend;

const storeReady = (async () => {
  try {
    await Store.init();
  } catch (err) {
    console.warn("[jsbattle] Supabase unavailable, falling back to local:", err.message);
    Store = LocalBackend;
    await Store.init();
    window.JSBATTLE_STORE_ERROR = err.message;
  }
})();
