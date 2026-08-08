// ============================================================================
// JSBattle — configuration
//
// Fill these in with your Supabase project's values to turn on real accounts,
// a global leaderboard, and cross-device ranking.
//
//   Supabase dashboard -> Project Settings -> API
//     Project URL  ->  SUPABASE_URL
//     anon public  ->  SUPABASE_ANON_KEY
//
// The anon key is designed to be public — it is safe in client code. All
// access control is enforced by Row Level Security (see supabase-schema.sql).
//
// Leave these as the placeholders and the app runs fully offline against
// localStorage instead. Nothing breaks; you just get a local-only leaderboard.
// ============================================================================

window.JSBATTLE_CONFIG = {
  SUPABASE_URL: "YOUR_SUPABASE_URL",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY"
};

// Normalise before validating. Copying from the Supabase dashboard commonly
// picks up surrounding whitespace or a trailing slash, and supabase-js builds
// its endpoints by concatenation — so "https://x.supabase.co/" silently yields
// "https://x.supabase.co//rest/v1/..." and every request 404s with no clue why.
(function () {
  const c = window.JSBATTLE_CONFIG;
  const clean = (v) => (typeof v === "string" ? v.trim() : "");

  c.SUPABASE_URL = clean(c.SUPABASE_URL).replace(/\/+$/, "");
  c.SUPABASE_ANON_KEY = clean(c.SUPABASE_ANON_KEY);

  c.isConfigured =
    /^https:\/\/[^/]+\.supabase\.(co|in|net)$/i.test(c.SUPABASE_URL) &&
    c.SUPABASE_ANON_KEY.length > 30;

  // Loud, specific warnings beat a silent fall back to localStorage.
  if (!c.isConfigured && c.SUPABASE_URL && !c.SUPABASE_URL.startsWith("YOUR_")) {
    if (!/^https:\/\//i.test(c.SUPABASE_URL)) {
      console.error("[jsbattle] SUPABASE_URL must start with https:// —", c.SUPABASE_URL);
    } else if (!/\.supabase\./i.test(c.SUPABASE_URL)) {
      console.error(
        "[jsbattle] SUPABASE_URL should look like https://<ref>.supabase.co —",
        c.SUPABASE_URL
      );
    }
    if (c.SUPABASE_ANON_KEY.length <= 30) {
      console.error("[jsbattle] SUPABASE_ANON_KEY looks too short to be the anon key.");
    }
  }

  // The service_role key must never ship in client code — it bypasses RLS.
  if (/"?role"?\s*:\s*"?service_role/i.test(c.SUPABASE_ANON_KEY) ||
      (() => {
        try {
          return JSON.parse(atob(c.SUPABASE_ANON_KEY.split(".")[1] || "")).role === "service_role";
        } catch (e) {
          return false;
        }
      })()) {
    c.isConfigured = false;
    console.error(
      "[jsbattle] That is the service_role key, not the anon key. It bypasses Row Level " +
        "Security and must never be in client code. Refusing to use it — rotate it in the " +
        "Supabase dashboard and use the 'anon public' key instead."
    );
  }
})();
