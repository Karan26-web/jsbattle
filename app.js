// ============================================================================
// JSBattle — app.js
//
// Everything in this file is TRUSTED app code. The only untrusted code is
// what a player types into the editor, and that never runs here — it is only
// ever sent via postMessage into sandbox.html, loaded in an iframe with
// sandbox="allow-scripts" and no "allow-same-origin".
// ============================================================================

const EXEC_TIMEOUT_MS = 2500;

// ----------------------------------------------------------------------------
// Sandbox runner — owns the iframe lifecycle and the postMessage protocol.
//
// The iframe can only execute one thing at a time, and typing plus clicking
// Run trivially produces overlapping requests. So runs are serialised: one
// in flight, at most one queued, and a queued run that gets superseded by a
// newer one resolves as { type: "superseded" } instead of ever reaching the
// UI. Without this, a slow run started against older code can land after a
// fast run against newer code and overwrite the correct score.
// ----------------------------------------------------------------------------
class SandboxRunner {
  constructor(mountEl) {
    this.mountEl = mountEl;
    this.iframe = null;
    this.pending = null; // the single in-flight run: { resolve, timer }
    this.queued = null; // the single waiting run: { message, resolve }
    this.busy = false;
    this.destroyed = false;
    this._boundOnMessage = this._onMessage.bind(this);
    window.addEventListener("message", this._boundOnMessage);
    this._createIframe();
  }

  _createIframe() {
    if (this.iframe) this.iframe.remove();
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.position = "absolute";
    iframe.src = "sandbox.html";
    this.mountEl.appendChild(iframe);
    this.iframe = iframe;
    this._ready = new Promise((resolve) => {
      this._resolveReady = resolve;
    });
  }

  _onMessage(ev) {
    if (!this.iframe || ev.source !== this.iframe.contentWindow) return;
    const data = ev.data || {};
    if (data.type === "ready") {
      this._resolveReady && this._resolveReady();
      return;
    }
    if (!this.pending) return;
    if (
      data.type === "visual-result" ||
      data.type === "anim-result" ||
      data.type === "golf-result" ||
      data.type === "fatal-error"
    ) {
      clearTimeout(this.pending.timer);
      const resolve = this.pending.resolve;
      this.pending = null;
      resolve(data);
    }
  }

  _run(message) {
    return new Promise((resolve) => {
      if (this.destroyed) return resolve({ type: "superseded" });
      // A queued-but-not-yet-started run is always stale the moment a newer
      // one arrives — drop it rather than burning 2.5s of iframe time on it.
      if (this.queued) this.queued.resolve({ type: "superseded" });
      this.queued = { message, resolve };
      this._pump();
    });
  }

  async _pump() {
    if (this.busy || !this.queued) return;
    const job = this.queued;
    this.queued = null;
    this.busy = true;
    const result = await this._execute(job.message);
    this.busy = false;
    job.resolve(result);
    this._pump();
  }

  async _execute(message) {
    await this._ready;
    // Navigating away destroys the runner and detaches the iframe, which nulls
    // contentWindow. A run queued just before that would otherwise wake up here
    // and post into nothing.
    if (this.destroyed || !this.iframe || !this.iframe.contentWindow) {
      return { type: "superseded" };
    }
    return new Promise((resolve) => {
      this.pending = {
        resolve,
        timer: setTimeout(() => {
          this.pending = null;
          // "abort" terminates the worker running the player's code. The
          // iframe itself is on a live thread (the hang is in the worker), so
          // it will actually receive this. Recreating is the belt-and-braces
          // path for the OffscreenCanvas-less fallback, where the hang would
          // be on the iframe's own thread and abort could never be read.
          try {
            this.iframe.contentWindow.postMessage({ type: "abort" }, "*");
          } catch (e) {
            /* iframe already gone */
          }
          this._createIframe();
          resolve({
            type: "timeout",
            error: `Execution timed out after ${EXEC_TIMEOUT_MS}ms (infinite loop?).`
          });
        }, EXEC_TIMEOUT_MS)
      };
      this.iframe.contentWindow.postMessage(message, "*");
    });
  }

  runVisual(code, size) {
    return this._run({ type: "run-visual", code, size });
  }

  runAnim(code, size, times) {
    return this._run({ type: "run-anim", code, size, times });
  }

  runGolf(code, testCases) {
    return this._run({ type: "run-golf", code, testCases });
  }

  destroy() {
    this.destroyed = true;
    window.removeEventListener("message", this._boundOnMessage);
    // Unblock anything parked on _ready for an iframe that will never load.
    if (this._resolveReady) this._resolveReady();
    // Release anything still waiting, or a run in flight when the player
    // navigates away would try to paint into a DOM that no longer exists.
    if (this.queued) {
      this.queued.resolve({ type: "superseded" });
      this.queued = null;
    }
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve({ type: "superseded" });
      this.pending = null;
    }
    if (this.iframe) this.iframe.remove();
  }
}

// ----------------------------------------------------------------------------
// Pixel comparison
//
// A flat "what fraction of pixels match" is a bad metric here, because on most
// levels the background IS most of the canvas. On the orbit level the moving
// moon is ~0.5% of 120,000 pixels, so a submission that painted the background
// and nothing else measured 97% and scored 903 of a possible 1000 — and code
// that ignored `t` completely was within 13 points of a correct animation.
//
// So pixels are weighted. A pixel counts fully whenever the target or the
// player's output has something other than the background colour there;
// background-on-background agreement is worth BG_WEIGHT. Filling in the easy
// part therefore earns almost nothing, and the drawing is what is actually
// being scored. Weighting both sides also penalises painting extra ink where
// the target has none.
// ----------------------------------------------------------------------------
const COLOR_TOLERANCE = 40; // small allowance for anti-aliasing differences
const BG_WEIGHT = 0.05;

// The background is simply the most common colour in the target.
function modalColor(px) {
  const counts = new Map();
  let bestCount = 0;
  let bestKey = 0;
  for (let i = 0; i < px.length; i += 4) {
    const key = ((px[i] << 24) | (px[i + 1] << 16) | (px[i + 2] << 8) | px[i + 3]) >>> 0;
    const n = (counts.get(key) || 0) + 1;
    counts.set(key, n);
    if (n > bestCount) {
      bestCount = n;
      bestKey = key;
    }
  }
  return [(bestKey >>> 24) & 255, (bestKey >>> 16) & 255, (bestKey >>> 8) & 255, bestKey & 255];
}

function comparePixels(a, b, bg) {
  if (!a || !b || a.length !== b.length) return 0;
  const [br, bgc, bb, ba] = bg || [0, 0, 0, 0];
  let num = 0;
  let den = 0;
  for (let i = 0; i < a.length; i += 4) {
    const matched =
      Math.abs(a[i] - b[i]) +
        Math.abs(a[i + 1] - b[i + 1]) +
        Math.abs(a[i + 2] - b[i + 2]) +
        Math.abs(a[i + 3] - b[i + 3]) <
      COLOR_TOLERANCE;

    const aIsBg =
      Math.abs(a[i] - br) + Math.abs(a[i + 1] - bgc) + Math.abs(a[i + 2] - bb) + Math.abs(a[i + 3] - ba) <
      COLOR_TOLERANCE;
    const bIsBg =
      Math.abs(b[i] - br) + Math.abs(b[i + 1] - bgc) + Math.abs(b[i + 2] - bb) + Math.abs(b[i + 3] - ba) <
      COLOR_TOLERANCE;

    const w = aIsBg && bIsBg ? BG_WEIGHT : 1;
    den += w;
    if (matched) num += w;
  }
  return den ? (num / den) * 100 : 0;
}

// ----------------------------------------------------------------------------
// Small DOM helpers
// ----------------------------------------------------------------------------
const app = document.getElementById("app");

// textContent->innerHTML escapes & < >, but NOT quotes — which is only safe
// while every interpolation lands in text. Escaping quotes too means dropping a
// value into an attribute later cannot silently become an injection point.
function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function toast(message, kind = "info") {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

// A short burst of falling squares. Purely decorative, self-cleaning.
function celebrate() {
  const host = document.createElement("div");
  host.className = "confetti-host";
  const colors = ["#ff5470", "#f5a623", "#5eead4", "#a5b4fc", "#ffd23f"];
  for (let i = 0; i < 40; i++) {
    const bit = document.createElement("span");
    bit.style.left = Math.random() * 100 + "vw";
    bit.style.background = colors[i % colors.length];
    bit.style.animationDelay = Math.random() * 0.4 + "s";
    bit.style.transform = `rotate(${Math.random() * 360}deg)`;
    host.appendChild(bit);
  }
  document.body.appendChild(host);
  setTimeout(() => host.remove(), 2600);
}

function difficultyDots(level) {
  return Array.from({ length: 5 }, (_, i) =>
    `<span class="${i < level.difficulty ? "on" : ""}"></span>`
  ).join("");
}

// ----------------------------------------------------------------------------
// Session state — the player's best score per level, cached between renders so
// every card does not trigger its own round trip.
// ----------------------------------------------------------------------------
let myScores = {};

async function refreshMyScores() {
  try {
    myScores = Store.getUser() ? await Store.getMyScores() : {};
  } catch (err) {
    console.warn("[jsbattle] could not load scores:", err.message);
    myScores = {};
  }
}

function totalXp() {
  return Object.values(myScores).reduce((sum, s) => sum + (s.score || 0), 0);
}

// ----------------------------------------------------------------------------
// Header / footer chrome
//
// The dismiss handlers below are bound ONCE, at module scope. renderChrome runs
// on every route and rebuilds the menu markup, so binding them there added a
// fresh pair of document listeners on each navigation and never removed them —
// they looked up the element by id at call time, so hoisting them out is safe.
// ----------------------------------------------------------------------------
function closeAccountMenu() {
  const menu = document.getElementById("account-menu");
  const btn = document.getElementById("account-btn");
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}
document.addEventListener("click", closeAccountMenu);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAccountMenu();
});

function renderChrome() {
  const user = Store.getUser();
  const nav = document.getElementById("nav-actions");
  const xp = totalXp();
  const { tier } = tierProgress(xp, ALL_LEVELS.length);

  nav.innerHTML = user
    ? `
      <span class="nav-xp" title="Total XP across all levels">
        <b style="color:${tier.color}">${tier.icon}</b> ${xp.toLocaleString()} XP
      </span>
      <div class="account">
        <button class="account-trigger" id="account-btn" aria-haspopup="true" aria-expanded="false">
          <span class="avatar" style="background:${tier.color}">${escapeHtml(
            user.username.slice(0, 1).toUpperCase()
          )}</span>
          <span class="account-name">${escapeHtml(user.username)}</span>
          <span class="chevron">▾</span>
        </button>
        <div class="account-menu" id="account-menu" hidden>
          <div class="account-head">
            <div class="account-name-lg">${escapeHtml(user.username)}</div>
            <div class="account-sub">${escapeHtml(
              user.email || (Store.isRemote ? "" : "Local play — this browser only")
            )}</div>
          </div>
          <a href="#/profile">Your profile</a>
          <a href="#/ranks">Global rankings</a>
          <button id="signout-btn">Sign out</button>
        </div>
      </div>`
    : `<button class="btn accent sm" id="signin-btn">${
        Store.isRemote ? "Sign in" : "Set display name"
      }</button>`;

  const accountBtn = document.getElementById("account-btn");
  if (accountBtn) {
    const menu = document.getElementById("account-menu");
    accountBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      accountBtn.setAttribute("aria-expanded", String(!menu.hidden));
    });
    menu.addEventListener("click", (e) => e.stopPropagation());
    menu.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeAccountMenu));
  }

  const signout = document.getElementById("signout-btn");
  if (signout) {
    signout.addEventListener("click", async () => {
      await Store.signOut();
      toast("Signed out.");
    });
  }
  const signin = document.getElementById("signin-btn");
  if (signin) signin.addEventListener("click", openAuthModal);

  document.querySelectorAll(".topbar nav a[href^='#/']").forEach((a) => {
    const target = a.getAttribute("href");
    a.classList.toggle("active", (location.hash || "#/levels").startsWith(target));
  });
}

// ----------------------------------------------------------------------------
// Auth modal
// ----------------------------------------------------------------------------
function openAuthModal() {
  const remote = Store.isRemote;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="Sign in">
      <button class="modal-close" aria-label="Close">&times;</button>
      ${
        remote
          ? `
        <div class="modal-tabs">
          <button class="tab active" data-mode="signin">Sign in</button>
          <button class="tab" data-mode="signup">Create account</button>
        </div>
        <form id="auth-form">
          <label>Email<input type="email" name="email" required autocomplete="email" /></label>
          <label class="password-field">Password<input type="password" name="password" required minlength="6" autocomplete="current-password" /></label>
          <label class="username-field" hidden>Display name<input type="text" name="username" maxlength="24" /></label>
          <div class="form-error" id="auth-error" hidden></div>
          <div class="form-note" id="auth-note" hidden></div>
          <button class="btn accent block" type="submit">Sign in</button>
        </form>
        <button class="link-btn center" id="forgot-link">Forgot your password?</button>
        <p class="modal-note">Your score history and global rank follow this account across devices.</p>`
          : `
        <h3>Pick a display name</h3>
        <p class="modal-note" style="margin-top:6px">
          No backend is configured, so scores are saved in this browser only.
          Add your Supabase keys to <code>config.js</code> for real accounts and a global leaderboard.
        </p>
        <form id="auth-form">
          <label>Display name<input type="text" name="username" maxlength="24" required /></label>
          <div class="form-error" id="auth-error" hidden></div>
          <button class="btn accent block" type="submit">Start playing</button>
        </form>`
      }
    </div>`;
  document.body.appendChild(backdrop);

  // Unbind on every close path, not just the Escape one — closing via the X or
  // the backdrop used to leave the key handler attached to document forever.
  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };
  const close = () => {
    document.removeEventListener("keydown", onKeydown);
    backdrop.remove();
  };
  document.addEventListener("keydown", onKeydown);

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  backdrop.querySelector(".modal-close").addEventListener("click", close);

  const form = backdrop.querySelector("#auth-form");
  const errorEl = backdrop.querySelector("#auth-error");
  const noteEl = backdrop.querySelector("#auth-note");
  let mode = "signin";

  // signin | signup | reset. Reset reuses the same form with the password and
  // username fields hidden, so there is only ever one submit path to reason about.
  function setMode(next) {
    mode = next;
    if (!remote) return;
    backdrop
      .querySelectorAll(".tab")
      .forEach((t) => t.classList.toggle("active", t.dataset.mode === (next === "reset" ? "signin" : next)));

    const nameField = form.querySelector(".username-field");
    const pwField = form.querySelector(".password-field");
    nameField.hidden = next !== "signup";
    nameField.querySelector("input").required = next === "signup";
    pwField.hidden = next === "reset";
    pwField.querySelector("input").required = next !== "reset";
    pwField.querySelector("input").autocomplete =
      next === "signup" ? "new-password" : "current-password";

    form.querySelector('[type="submit"]').textContent =
      next === "signup" ? "Create account" : next === "reset" ? "Send reset link" : "Sign in";

    const forgot = backdrop.querySelector("#forgot-link");
    forgot.textContent = next === "reset" ? "Back to sign in" : "Forgot your password?";
    errorEl.hidden = true;
    if (noteEl) {
      noteEl.hidden = next !== "reset";
      noteEl.textContent =
        next === "reset" ? "We'll email you a link to choose a new password." : "";
    }
  }

  backdrop.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
  });

  const forgotLink = backdrop.querySelector("#forgot-link");
  if (forgotLink) {
    forgotLink.addEventListener("click", () => setMode(mode === "reset" ? "signin" : "reset"));
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('[type="submit"]');
    const original = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Working…";
    errorEl.hidden = true;

    const fd = new FormData(form);
    try {
      if (!remote) {
        const username = String(fd.get("username") || "").trim().slice(0, 24);
        if (username.length < 2) throw new Error("Pick a name of at least 2 characters.");
        await Store.signUp(null, null, username);
        close();
        toast(`Welcome, ${username}.`, "success");
      } else if (mode === "reset") {
        await Store.requestPasswordReset(fd.get("email"));
        close();
        toast("Reset link sent. Check your email.", "success");
      } else if (mode === "signup") {
        const username = String(fd.get("username") || "").trim().slice(0, 24);
        const res = await Store.signUp(fd.get("email"), fd.get("password"), username);
        if (res.needsConfirmation) {
          errorEl.hidden = false;
          errorEl.textContent = "Check your email to confirm the account, then sign in.";
          return;
        }
        close();
        toast("Account created. Go win something.", "success");
      } else {
        await Store.signIn(fd.get("email"), fd.get("password"));
        close();
        toast("Signed in.", "success");
      }
    } catch (err) {
      errorEl.hidden = false;
      errorEl.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = original;
    }
  });

  const firstInput = form.querySelector("input");
  if (firstInput) firstInput.focus();
}

// ----------------------------------------------------------------------------
// Router
// ----------------------------------------------------------------------------
let currentRunner = null;

// Animation levels drive a requestAnimationFrame loop. Without an explicit
// teardown it would keep running against a canvas the router has replaced,
// burning a frame callback per navigation for the rest of the session.
let pageCleanups = [];
function onPageTeardown(fn) {
  pageCleanups.push(fn);
}

async function route() {
  pageCleanups.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      /* teardown must never block navigation */
    }
  });
  pageCleanups = [];

  if (currentRunner) {
    currentRunner.destroy();
    currentRunner = null;
  }
  await storeReady;
  await refreshMyScores();
  renderChrome();

  const hash = location.hash || "#/levels";
  const playMatch = hash.match(/^#\/play\/(.+)$/);

  if (hash.startsWith("#/reset-password")) {
    renderResetPassword();
  } else if (playMatch) {
    const level = LEVELS_BY_SLUG[playMatch[1]];
    if (level) renderPlay(level);
    else renderNotFound(`No level called "${playMatch[1]}".`);
  } else if (hash.startsWith("#/ranks")) {
    renderRanks();
  } else if (hash.startsWith("#/profile")) {
    renderProfile();
  } else if (hash.startsWith("#/about")) {
    renderAbout();
  } else if (hash === "#/levels" || hash === "#/" || hash === "#" || hash === "") {
    renderLevelSelect();
  } else {
    renderNotFound();
  }
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);

// ----------------------------------------------------------------------------
// Level select
// ----------------------------------------------------------------------------
let activeFilter = "all";

function levelCard(level) {
  const best = myScores[level.slug];
  const medal = best ? medalFor(best.score) : null;
  return `
    <a class="level-card ${best ? "played" : ""}" href="#/play/${level.slug}">
      <span class="type-tag ${level.type}">${TYPE_META[level.type].tag}</span>
      ${medal ? `<span class="medal ${medal.key}" title="${medal.label} — ${best.score} XP"></span>` : ""}
      <h3>${escapeHtml(level.title)}</h3>
      <p>${escapeHtml(level.description)}</p>
      <div class="difficulty">${difficultyDots(level)}</div>
      <div class="best-score">
        ${best ? `Your best: <b>${best.score}</b> XP` : "Not attempted yet"}
      </div>
    </a>`;
}

function renderLevelSelect() {
  const user = Store.getUser();
  const xp = totalXp();
  const played = Object.keys(myScores).length;
  const prog = tierProgress(xp, ALL_LEVELS.length);

  const matches = (l) =>
    activeFilter === "all" ||
    (activeFilter === "todo" ? !myScores[l.slug] : l.type === activeFilter);

  // Sections are derived from the registry, so adding a category to levels.js
  // puts it on this page and in the filter bar with no change here.
  const sections = LEVEL_GROUPS.map((g) => ({ ...g, shown: g.levels.filter(matches) })).filter(
    (g) => g.shown.length
  );

  app.innerHTML = `
    <section class="hero">
      <div class="hero-inner">
        <h1>Write less. <span class="hl">Match more.</span></h1>
        <p>
          ${ALL_LEVELS.length} levels of canvas recreation and code golf, judged pixel by pixel
          and character by character. Every submission runs in a locked-down sandbox.
        </p>
        <div class="hero-actions">
          <a class="btn accent" href="#/play/${(ALL_LEVELS.find((l) => !myScores[l.slug]) || ALL_LEVELS[0]).slug}">
            ${played ? "Continue" : "Start playing"}
          </a>
          <a class="btn ghost" href="#/ranks">View rankings</a>
        </div>
      </div>
      <div class="rank-card">
        <div class="rank-card-head">
          <span class="tier-icon" style="color:${prog.tier.color}">${prog.tier.icon}</span>
          <div>
            <div class="tier-name" style="color:${prog.tier.color}">${prog.tier.label}</div>
            <div class="tier-sub">${user ? escapeHtml(user.username) : "Not signed in"}</div>
          </div>
        </div>
        <div class="stat-row">
          <div><span class="stat-value">${xp.toLocaleString()}</span><span class="stat-label">Total XP</span></div>
          <div><span class="stat-value">${played}/${ALL_LEVELS.length}</span><span class="stat-label">Levels</span></div>
        </div>
        <div class="progress"><div class="progress-fill" style="width:${prog.pctToNext}%;background:${prog.tier.color}"></div></div>
        <div class="tier-next">
          ${
            prog.next
              ? `${prog.xpForNextTier.toLocaleString()} XP to <b style="color:${prog.next.color}">${prog.next.label}</b>`
              : "Top tier reached. Now go beat everyone else's char counts."
          }
        </div>
      </div>
    </section>

    <div class="container">
      <div class="filter-bar">
        ${[
          ["all", `All ${ALL_LEVELS.length}`],
          ...LEVEL_GROUPS.map((g) => [g.key, `${g.tag} ${g.levels.length}`]),
          ["todo", "Unplayed"]
        ]
          .map(
            ([key, label]) =>
              `<button class="filter ${activeFilter === key ? "active" : ""}" data-filter="${key}">${label}</button>`
          )
          .join("")}
      </div>

      ${sections
        .map(
          (g) => `
        <div class="section-label">${g.label} — ${g.blurb}</div>
        <div class="level-grid">${g.shown.map(levelCard).join("")}</div>`
        )
        .join("")}
      ${
        sections.length
          ? ""
          : `<p class="empty">Nothing here — every level in this filter is done.</p>`
      }
    </div>`;

  app.querySelectorAll(".filter").forEach((b) =>
    b.addEventListener("click", () => {
      activeFilter = b.dataset.filter;
      renderLevelSelect();
    })
  );
}

// ----------------------------------------------------------------------------
// About
//
// Every fact here comes from karan26.vercel.app and the linked GitHub profile.
// ----------------------------------------------------------------------------
const AUTHOR = {
  name: "Karan Kumar",
  role: "Game Developer &amp; Web Developer",
  current: "GameDev at Convegenius",
  school: "IIT Madras",
  location: "Noida, India",
  portfolio: "https://karan26.vercel.app/",
  github: "https://github.com/Karan26-web",
  linkedin: "https://www.linkedin.com/in/karan-kumar-4360a82b4/",
  email: "karankumarofficial66@gmail.com"
};

function renderAbout() {
  const focus = [
    {
      title: "Product Analytics",
      body: "Tracking KPIs, mapping user funnels, and using engagement data to drive product decisions and feature prioritisation."
    },
    {
      title: "Data Analysis",
      body: "Python, SQL and Pandas — turning raw data into dashboards, insights, and business intelligence that teams can act on."
    },
    {
      title: "AI &amp; LLM Integration",
      body: "Prompt engineering, LLM API integration, and AI-powered product design — building experiences that are natively intelligent."
    }
  ];

  app.innerHTML = `
    <div class="container">
      <div class="about-hero">
        <div class="about-avatar">K</div>
        <div>
          <div class="section-label" style="margin-bottom:8px">About the author</div>
          <h2>${AUTHOR.name}</h2>
          <p class="about-role">${AUTHOR.role} · ${escapeHtml(AUTHOR.school)}</p>
          <p class="about-meta">${AUTHOR.current} · ${AUTHOR.location}</p>
          <div class="about-links">
            <a class="btn ghost sm" href="${AUTHOR.portfolio}" target="_blank" rel="noopener noreferrer">Portfolio</a>
            <a class="btn ghost sm" href="${AUTHOR.github}" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a class="btn ghost sm" href="${AUTHOR.linkedin}" target="_blank" rel="noopener noreferrer">LinkedIn</a>
            <a class="btn ghost sm" href="mailto:${AUTHOR.email}">Email</a>
          </div>
        </div>
      </div>

      <p class="about-bio">
        IIT Madras. Game developer and web developer building AI-powered learning experiences at
        Convegenius — where analytical rigor meets product intuition. Previously a Product
        Designer at Cosmic Sole, and Secretary of the Nebula Pioneers Space Club at IIT Madras.
      </p>

      <div class="section-label">What I work on</div>
      <div class="about-grid">
        ${focus
          .map((f) => `<div class="about-card"><h3>${f.title}</h3><p>${f.body}</p></div>`)
          .join("")}
      </div>

      <div class="section-label">About this project</div>
      <div class="about-panel">
        <p>
          JSBattle is a browser game about writing <em>less</em> code, not more. Every level is
          scored by a machine — pixel-by-pixel against a reference canvas, or character-by-character
          against a par — so there is no room to argue with the result.
        </p>
        <p>
          It runs entirely in the browser with no build step. Player code executes inside a Worker
          nested in a sandboxed iframe with network access revoked, which keeps submitted code away
          from the page and makes runaway loops genuinely killable. Scores from both level types are
          normalised onto one 0–1000 XP scale so a single global ranking actually means something.
        </p>
        <p class="about-stack">
          <span>Vanilla JS</span><span>Canvas 2D</span><span>Web Workers</span>
          <span>CodeMirror</span><span>Supabase</span><span>Postgres RLS</span>
        </p>
      </div>
    </div>`;
}

// ----------------------------------------------------------------------------
// Not found
// ----------------------------------------------------------------------------
function renderNotFound(detail) {
  app.innerHTML = `
    <div class="container narrow center-page">
      <div class="big-code">404</div>
      <h2>Nothing here</h2>
      <p class="muted-text">${escapeHtml(detail || "That page does not exist.")}</p>
      <a class="btn accent" href="#/levels">Back to levels</a>
    </div>`;
}

// ----------------------------------------------------------------------------
// Reset password
//
// Reached only by following the emailed recovery link. Supabase has already
// exchanged the token for a session by the time we render, so updateUser() is
// authorised — but we still guard, because someone can navigate here directly.
// ----------------------------------------------------------------------------
function renderResetPassword() {
  const authorised = Store.isRecovering() || !!Store.getUser();

  app.innerHTML = `
    <div class="container narrow center-page">
      <div class="auth-panel">
        <h2>Choose a new password</h2>
        ${
          authorised
            ? `
          <p class="muted-text">Pick something at least 6 characters long.</p>
          <form id="reset-form">
            <label>New password<input type="password" name="password" required minlength="6" autocomplete="new-password" /></label>
            <label>Confirm password<input type="password" name="confirm" required minlength="6" autocomplete="new-password" /></label>
            <div class="form-error" id="reset-error" hidden></div>
            <button class="btn accent block" type="submit">Update password</button>
          </form>`
            : `
          <p class="muted-text">
            This page opens from the link in your password reset email. That link
            has expired or was never used on this device.
          </p>
          <a class="btn accent" href="#/levels">Back to levels</a>`
        }
      </div>
    </div>`;

  const form = document.getElementById("reset-form");
  if (!form) return;
  const errorEl = document.getElementById("reset-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const password = String(fd.get("password"));
    errorEl.hidden = true;

    if (password !== String(fd.get("confirm"))) {
      errorEl.hidden = false;
      errorEl.textContent = "Those two passwords do not match.";
      return;
    }

    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Updating…";
    try {
      await Store.updatePassword(password);
      Store.clearRecovery();
      toast("Password updated.", "success");
      location.hash = "#/levels";
    } catch (err) {
      errorEl.hidden = false;
      errorEl.textContent = err.message;
      btn.disabled = false;
      btn.textContent = "Update password";
    }
  });
}

// ----------------------------------------------------------------------------
// Global rankings
// ----------------------------------------------------------------------------
async function renderRanks() {
  app.innerHTML = `
    <div class="container">
      <div class="page-head">
        <h2>Global Rankings</h2>
        <p>Total XP is the sum of your best score on every level. Max ${(
          ALL_LEVELS.length * 1000
        ).toLocaleString()}.</p>
      </div>
      <div class="tier-legend">
        ${TIERS.slice()
          .reverse()
          .map(
            (t) =>
              `<div class="tier-chip"><span style="color:${t.color}">${t.icon}</span> ${t.label}
                 <em>${Math.round(t.min * ALL_LEVELS.length * 1000).toLocaleString()}+</em></div>`
          )
          .join("")}
      </div>
      <div class="leaderboard" id="global-board"><p class="empty">Loading…</p></div>
    </div>`;

  const board = document.getElementById("global-board");
  try {
    const rows = await Store.getGlobalLeaderboard(50);
    if (!rows.length) {
      board.innerHTML = `<p class="empty">No ranked players yet. ${
        Store.isRemote ? "Be the first." : "Play a level to put yourself on the local board."
      }</p>`;
      return;
    }
    board.innerHTML = `
      <table>
        <thead><tr><th>#</th><th>Player</th><th>Tier</th><th>Levels</th><th class="num">Total XP</th></tr></thead>
        <tbody>
          ${rows
            .map((r) => {
              const t = tierFor(r.total_xp, ALL_LEVELS.length);
              return `<tr class="${r.isMe ? "you" : ""}">
                <td class="rank-cell">${r.rank}</td>
                <td>${escapeHtml(r.username)}${r.isMe ? " <span class='you-tag'>you</span>" : ""}</td>
                <td style="color:${t.color}">${t.icon} ${t.label}</td>
                <td>${r.levels_played}</td>
                <td class="num mono">${r.total_xp.toLocaleString()}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;
  } catch (err) {
    board.innerHTML = `<p class="empty">Could not load rankings: ${escapeHtml(err.message)}</p>`;
  }
}

// ----------------------------------------------------------------------------
// Profile
// ----------------------------------------------------------------------------
async function renderProfile() {
  const user = Store.getUser();
  if (!user) {
    app.innerHTML = `
      <div class="container">
        <div class="page-head"><h2>Profile</h2><p>Sign in to track your progress and rank.</p></div>
        <button class="btn accent" id="profile-signin">${
          Store.isRemote ? "Sign in" : "Set display name"
        }</button>
      </div>`;
    document.getElementById("profile-signin").addEventListener("click", openAuthModal);
    return;
  }

  const xp = totalXp();
  const prog = tierProgress(xp, ALL_LEVELS.length);
  let globalRank = null;
  try {
    globalRank = await Store.getMyGlobalRank();
  } catch (e) {
    /* rank is a nice-to-have; the rest of the page still renders */
  }

  const medalCounts = MEDALS.reduce((acc, m) => ({ ...acc, [m.key]: 0 }), {});
  Object.values(myScores).forEach((s) => {
    const m = medalFor(s.score);
    if (m) medalCounts[m.key]++;
  });

  app.innerHTML = `
    <div class="container">
      <div class="profile-head">
        <div class="tier-badge" style="border-color:${prog.tier.color};color:${prog.tier.color}">
          ${prog.tier.icon}
        </div>
        <div>
          <h2>${escapeHtml(user.username)}</h2>
          <p class="tier-sub">
            <b style="color:${prog.tier.color}">${prog.tier.label}</b>
            ${globalRank ? ` · Global rank #${globalRank.rank}` : ""}
            ${Store.isRemote ? "" : " · local play"}
          </p>
          <button class="link-btn" id="rename-btn">Change display name</button>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-box"><span class="stat-value">${xp.toLocaleString()}</span><span class="stat-label">Total XP</span></div>
        <div class="stat-box"><span class="stat-value">${Object.keys(myScores).length}/${ALL_LEVELS.length}</span><span class="stat-label">Levels played</span></div>
        <div class="stat-box"><span class="stat-value gold">${medalCounts.gold}</span><span class="stat-label">Gold medals</span></div>
        <div class="stat-box"><span class="stat-value silver">${medalCounts.silver}</span><span class="stat-label">Silver medals</span></div>
      </div>

      <div class="progress big"><div class="progress-fill" style="width:${prog.pctToNext}%;background:${prog.tier.color}"></div></div>
      <div class="tier-next" style="margin-bottom:32px">
        ${
          prog.next
            ? `${prog.xpForNextTier.toLocaleString()} XP to <b style="color:${prog.next.color}">${prog.next.label}</b>`
            : "Master tier. There is nothing above this."
        }
      </div>

      <div class="section-label">Level breakdown</div>
      <div class="leaderboard">
        <table>
          <thead><tr><th>Level</th><th>Type</th><th>Medal</th><th class="num">Chars</th><th class="num">XP</th></tr></thead>
          <tbody>
            ${ALL_LEVELS.map((l) => {
              const s = myScores[l.slug];
              const m = s ? medalFor(s.score) : null;
              return `<tr class="${s ? "" : "dim"}">
                <td><a href="#/play/${l.slug}">${escapeHtml(l.title)}</a></td>
                <td>${TYPE_META[l.type].tag}</td>
                <td>${m ? `<span class="medal inline ${m.key}"></span> ${m.label}` : "—"}</td>
                <td class="num mono">${s ? s.char_count : "—"}</td>
                <td class="num mono">${s ? s.score : "—"}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>`;

  document.getElementById("rename-btn").addEventListener("click", async () => {
    const next = window.prompt("New display name:", user.username);
    if (next === null) return;
    const trimmed = next.trim().slice(0, 24);
    if (trimmed.length < 2) {
      toast("Display names need at least 2 characters.", "error");
      return;
    }
    if (trimmed === user.username) return;
    try {
      await Store.updateUsername(trimmed);
      toast("Display name updated.", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ----------------------------------------------------------------------------
// Play view
// ----------------------------------------------------------------------------
function renderPlay(level) {
  // Three engines: a single canvas frame, a sampled animation loop, or tests.
  const engine = level.type === "golf" ? "golf" : level.type === "anim" ? "anim" : "static";
  const isCanvas = engine !== "golf";
  const best = myScores[level.slug];
  const idx = ALL_LEVELS.indexOf(level);
  const prev = ALL_LEVELS[idx - 1];
  const next = ALL_LEVELS[idx + 1];
  const draftKey = LS.draft(level.slug);

  app.innerHTML = `
    <div class="play-header">
      <div class="play-nav">
        <a class="back-link" href="#/levels">&larr; All levels</a>
        <div class="level-stepper">
          ${prev ? `<a href="#/play/${prev.slug}" title="${escapeHtml(prev.title)}">&larr; Prev</a>` : `<span class="disabled">&larr; Prev</span>`}
          <span class="counter">${idx + 1} / ${ALL_LEVELS.length}</span>
          ${next ? `<a href="#/play/${next.slug}" title="${escapeHtml(next.title)}">Next &rarr;</a>` : `<span class="disabled">Next &rarr;</span>`}
        </div>
      </div>
      <div class="play-title">
        <h2>${escapeHtml(level.title)}</h2>
        <span class="type-tag ${level.type}">${TYPE_META[level.type].tag}</span>
        <span class="difficulty inline">${difficultyDots(level)}</span>
        ${best ? `<span class="pb">PB <b>${best.score}</b> XP</span>` : ""}
      </div>
      <p class="desc">${escapeHtml(level.description)}</p>
      <div class="hint-wrap">
        <button class="hint-toggle" id="hint-toggle">Show hint</button>
        <div class="hint" id="hint" hidden>${escapeHtml(level.hint)}</div>
      </div>
    </div>

    <div class="arena">
      <section class="pane left">
        <div class="pane-header">${
          isCanvas ? (engine === "anim" ? "Target — looping" : "Target") : "Test cases"
        }</div>
        <div class="pane-body" id="left-pane-body"></div>
      </section>
      <section class="pane right">
        <div class="pane-header">
          <span>${isCanvas ? "Your output" : "Your solve()"}</span>
          <button class="link-btn" id="reset-btn">Reset code</button>
        </div>
        <div class="pane-body" id="right-pane-body"></div>
        <div class="editor-wrap" id="editor-mount"></div>
      </section>
      <div class="hud">
        <div class="metrics">
          <div class="metric">
            <span class="label">Characters</span>
            <span class="value char-count" id="char-count">0</span>
          </div>
          <div class="metric">
            <span class="label">Par</span>
            <span class="value muted" id="par">${level.par}</span>
          </div>
          <div class="metric">
            <span class="label">${
              engine === "anim" ? "Frame match" : engine === "static" ? "Pixel match" : "Tests"
            }</span>
            <span class="value" id="secondary">—</span>
          </div>
          <div class="metric">
            <span class="label">XP</span>
            <span class="value score" id="live-score">—</span>
          </div>
        </div>
        <div class="actions">
          <button class="btn ghost" id="run-btn">Run <kbd>${
            navigator.platform.includes("Mac") ? "⌘" : "Ctrl"
          }↵</kbd></button>
          <button class="btn accent" id="submit-btn" disabled>Submit score</button>
        </div>
      </div>
      <div id="error-slot"></div>
    </div>

    <div class="container" style="padding-top:0">
      <div class="leaderboard">
        <div class="section-label">Leaderboard — ${escapeHtml(level.title)}</div>
        <table>
          <thead><tr><th>#</th><th>Player</th><th class="num">Chars</th><th class="num">XP</th></tr></thead>
          <tbody id="leaderboard-body"><tr><td colspan="4" class="empty-cell">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>
    <div id="sandbox-mount"></div>`;

  const runner = new SandboxRunner(document.getElementById("sandbox-mount"));
  currentRunner = runner;

  const draft = localStorage.getItem(draftKey);
  const editor = CodeMirror(document.getElementById("editor-mount"), {
    value: draft || level.starterCode,
    mode: "javascript",
    theme: "dracula",
    lineNumbers: true,
    tabSize: 2,
    // Golfed answers are frequently one very long line; without wrapping the
    // player is typing off the right edge of a pane they cannot widen.
    lineWrapping: true,
    viewportMargin: Infinity,
    extraKeys: {
      "Cmd-Enter": () => execute(),
      "Ctrl-Enter": () => execute()
    }
  });

  const charCountEl = document.getElementById("char-count");
  const secondaryEl = document.getElementById("secondary");
  const liveScoreEl = document.getElementById("live-score");
  const submitBtn = document.getElementById("submit-btn");
  const errorSlot = document.getElementById("error-slot");

  let lastResult = null; // { score, charCount, meta } — only set by a clean run

  document.getElementById("hint-toggle").addEventListener("click", (e) => {
    const hint = document.getElementById("hint");
    hint.hidden = !hint.hidden;
    e.target.textContent = hint.hidden ? "Show hint" : "Hide hint";
  });

  document.getElementById("reset-btn").addEventListener("click", () => {
    editor.setValue(level.starterCode);
    localStorage.removeItem(draftKey);
  });

  function setError(msg) {
    errorSlot.innerHTML = msg ? `<div class="error-banner">${escapeHtml(msg)}</div>` : "";
  }

  function setResult(res, secondaryText) {
    lastResult = res;
    liveScoreEl.textContent = res ? res.score : "—";
    liveScoreEl.classList.toggle("perfect", !!res && res.score >= 900);
    secondaryEl.textContent = secondaryText || "—";
    submitBtn.disabled = !res || res.score <= 0;
  }

  function onChange() {
    charCountEl.textContent = editor.getValue().length;
    charCountEl.classList.toggle("over-par", editor.getValue().length > level.par);
    localStorage.setItem(draftKey, editor.getValue());
  }
  editor.on("change", onChange);
  onChange();

  const wiring = { setError, setResult, editor, runner, level };
  const execute =
    engine === "anim"
      ? makeAnimExecutor(wiring)
      : engine === "static"
        ? makeVisualExecutor(wiring)
        : makeGolfExecutor(wiring);

  document.getElementById("run-btn").addEventListener("click", execute);

  let submitting = false;
  submitBtn.addEventListener("click", async () => {
    // The disabled flag below is set inside an async handler, so a fast
    // double-click can queue two submissions before it takes effect.
    if (submitting) return;
    if (!lastResult || lastResult.score <= 0) return;
    if (!Store.getUser()) {
      openAuthModal();
      return;
    }
    submitting = true;
    submitBtn.disabled = true;
    try {
      const { best: newBest } = await Store.submitScore(
        level.slug,
        lastResult.score,
        lastResult.charCount,
        lastResult.meta
      );
      const prev = myScores[level.slug];
      const wasBest = !prev || newBest > prev.score;
      // Only adopt this run's char count when it actually became the new best.
      // Otherwise the backend kept a better score and pairing it with this
      // submission's length would show a record that never existed.
      myScores[level.slug] = wasBest
        ? { score: newBest, char_count: lastResult.charCount }
        : { score: newBest, char_count: prev.char_count };
      renderChrome();
      await loadLevelBoard(level);

      if (wasBest) {
        celebrate();
        toast(`New personal best — ${newBest} XP.`, "success");
      } else {
        toast(`Submitted. Your best on this level is still ${newBest} XP.`);
      }
    } catch (err) {
      toast(err.message, "error");
    } finally {
      submitting = false;
      submitBtn.disabled = false;
    }
  });

  loadLevelBoard(level);

  // Canvas levels auto-run so the preview is live from the first keystroke.
  // Golf levels do not — running the empty starter would greet the player
  // with a wall of failing tests before they have typed anything.
  if (isCanvas) execute();
}

async function loadLevelBoard(level) {
  const body = document.getElementById("leaderboard-body");
  if (!body) return;
  try {
    const rows = await Store.getLevelLeaderboard(level.slug, 10);
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="4" class="empty-cell">No submissions yet — be the first.</td></tr>`;
      return;
    }
    body.innerHTML = rows
      .map(
        (r) => `
        <tr class="${r.isMe ? "you" : ""}">
          <td class="rank-cell">${r.rank}</td>
          <td>${escapeHtml(r.username)}${r.isMe ? " <span class='you-tag'>you</span>" : ""}</td>
          <td class="num mono">${r.char_count}</td>
          <td class="num mono">${r.score}</td>
        </tr>`
      )
      .join("");
  } catch (err) {
    body.innerHTML = `<tr><td colspan="4" class="empty-cell">Could not load: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// ----------------------------------------------------------------------------
// Visual level wiring
// ----------------------------------------------------------------------------
function makeVisualExecutor({ level, editor, runner, setError, setResult }) {
  document.getElementById("left-pane-body").innerHTML = `
    <div class="target-canvas-wrap">
      <canvas id="target-canvas" width="${CANVAS_SIZE.w}" height="${CANVAS_SIZE.h}"></canvas>
    </div>`;
  document.getElementById("right-pane-body").innerHTML = `
    <div class="preview-canvas-wrap">
      <canvas id="preview-canvas" width="${CANVAS_SIZE.w}" height="${CANVAS_SIZE.h}"></canvas>
    </div>`;

  const targetCtx = document.getElementById("target-canvas").getContext("2d");
  level.drawTarget(targetCtx);
  const targetPixels = targetCtx.getImageData(0, 0, CANVAS_SIZE.w, CANVAS_SIZE.h).data;
  const targetBg = modalColor(targetPixels);

  const previewCtx = document.getElementById("preview-canvas").getContext("2d");

  async function execute() {
    setError(null);
    const code = editor.getValue();
    const res = await runner.runVisual(code, CANVAS_SIZE);

    if (res.type === "superseded") return; // a newer run owns the UI now
    if (res.type === "timeout" || res.type === "fatal-error" || !res.ok) {
      setError(res.error || "Unknown error.");
      setResult(null);
      return;
    }

    const pixels = new Uint8ClampedArray(res.pixels);
    previewCtx.putImageData(new ImageData(pixels, res.width, res.height), 0, 0);

    const pct = comparePixels(targetPixels, pixels, targetBg);
    const charCount = code.length;
    const score = scoreVisual(pct, charCount, level.par);
    setResult({ score, charCount, meta: { pixelMatchPct: Math.round(pct * 10) / 10 } }, `${pct.toFixed(1)}%`);
  }

  // Live preview while typing, but scoring only settles once you pause. The
  // score is cleared the instant the code changes: during the debounce window
  // it described the previous code, and Submit stayed enabled against it.
  let debounce = null;
  editor.on("change", () => {
    setResult(null);
    clearTimeout(debounce);
    debounce = setTimeout(execute, 350);
  });

  return execute;
}

// ----------------------------------------------------------------------------
// Animation level wiring
//
// Scoring samples ANIM_FRAMES fixed values of t and averages the pixel match
// across all of them, so a correct shape in the wrong phase does not pass.
// Playback is cosmetic: the target is redrawn live from trusted code, and the
// player's canvas cycles the frames their run actually produced.
// ----------------------------------------------------------------------------
const ANIM_LOOP_MS = 2400;

function makeAnimExecutor({ level, editor, runner, setError, setResult }) {
  document.getElementById("left-pane-body").innerHTML = `
    <div class="target-canvas-wrap">
      <canvas id="target-canvas" width="${CANVAS_SIZE.w}" height="${CANVAS_SIZE.h}"></canvas>
    </div>`;
  document.getElementById("right-pane-body").innerHTML = `
    <div class="preview-canvas-wrap">
      <canvas id="preview-canvas" width="${CANVAS_SIZE.w}" height="${CANVAS_SIZE.h}"></canvas>
    </div>`;

  const targetCtx = document.getElementById("target-canvas").getContext("2d");
  const previewCtx = document.getElementById("preview-canvas").getContext("2d");

  // Reference pixels for the sampled instants, drawn by trusted level code.
  const scratch = document.createElement("canvas");
  scratch.width = CANVAS_SIZE.w;
  scratch.height = CANVAS_SIZE.h;
  const scratchCtx = scratch.getContext("2d");
  const targetFrames = ANIM_FRAMES.map((t) => {
    scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    scratchCtx.clearRect(0, 0, CANVAS_SIZE.w, CANVAS_SIZE.h);
    level.drawTarget(scratchCtx, t);
    return scratchCtx.getImageData(0, 0, CANVAS_SIZE.w, CANVAS_SIZE.h).data;
  });
  // Per frame, since a level is free to animate its background too.
  const targetBgs = targetFrames.map(modalColor);

  let playerFrames = null; // ImageData[] from the most recent successful run
  let rafId = null;

  function tick(now) {
    const t = (now % ANIM_LOOP_MS) / ANIM_LOOP_MS;

    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.clearRect(0, 0, CANVAS_SIZE.w, CANVAS_SIZE.h);
    level.drawTarget(targetCtx, t);

    if (playerFrames) {
      const i = Math.min(playerFrames.length - 1, Math.floor(t * playerFrames.length));
      previewCtx.putImageData(playerFrames[i], 0, 0);
    }
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
  onPageTeardown(() => cancelAnimationFrame(rafId));

  async function execute() {
    setError(null);
    const code = editor.getValue();
    const res = await runner.runAnim(code, CANVAS_SIZE, ANIM_FRAMES);

    if (res.type === "superseded") return;
    if (res.type === "timeout" || res.type === "fatal-error" || !res.ok) {
      setError(res.error || "Unknown error.");
      setResult(null);
      return;
    }

    const frames = res.frames.map((buf) => new Uint8ClampedArray(buf));
    const pcts = frames.map((f, i) => comparePixels(targetFrames[i], f, targetBgs[i]));
    const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length;

    playerFrames = frames.map((f) => new ImageData(f, res.width, res.height));

    const charCount = code.length;
    setResult(
      {
        score: scoreVisual(mean, charCount, level.par),
        charCount,
        meta: {
          meanMatchPct: Math.round(mean * 10) / 10,
          worstFramePct: Math.round(Math.min(...pcts) * 10) / 10
        }
      },
      `${mean.toFixed(1)}%`
    );
  }

  let debounce = null;
  editor.on("change", () => {
    setResult(null);
    clearTimeout(debounce);
    debounce = setTimeout(execute, 400);
  });

  return execute;
}

// ----------------------------------------------------------------------------
// Golf level wiring
// ----------------------------------------------------------------------------
function makeGolfExecutor({ level, editor, runner, setError, setResult }) {
  document.getElementById("left-pane-body").innerHTML = `
    <div class="golf-tests" id="test-list">
      ${level.visibleTests
        .map(
          (t, i) => `
        <div class="test-row">
          <span class="mono">solve(${t.input
            .map((x) => escapeHtml(JSON.stringify(x)))
            .join(", ")}) &rarr; ${escapeHtml(JSON.stringify(t.expected))}</span>
          <span class="status pending" id="test-status-${i}">•</span>
        </div>`
        )
        .join("")}
      <div class="test-row hidden-tests">
        <span>+ ${level.hiddenTests.length} hidden tests</span>
        <span class="status pending" id="hidden-status">•</span>
      </div>
    </div>`;
  document.getElementById("right-pane-body").innerHTML = "";

  function resetTestStatuses() {
    const cells = [...level.visibleTests.map((_, i) => `test-status-${i}`), "hidden-status"];
    cells.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.className = "status pending";
        el.textContent = "•";
      }
    });
  }

  // Golf levels run on demand, not on every keystroke. So the moment the code
  // changes, the displayed score describes code that is no longer in the
  // editor — clear it rather than let someone submit against a stale run.
  editor.on("change", () => {
    setResult(null);
    resetTestStatuses();
  });

  async function execute() {
    setError(null);
    const code = editor.getValue();
    const allTests = [...level.visibleTests, ...level.hiddenTests];
    const res = await runner.runGolf(code, allTests);

    if (res.type === "superseded") return; // a newer run owns the UI now
    if (res.type === "timeout" || res.type === "fatal-error" || !res.ok) {
      setError(res.error || "Unknown error.");
      setResult(null);
      return;
    }

    level.visibleTests.forEach((_, i) => {
      const el = document.getElementById(`test-status-${i}`);
      const r = res.results[i];
      el.className = "status " + (r.pass ? "pass" : "fail");
      el.textContent = r.pass ? "✓" : "✗";
    });

    const hiddenResults = res.results.slice(level.visibleTests.length);
    const hiddenPassed = hiddenResults.filter((r) => r.pass).length;
    const hiddenEl = document.getElementById("hidden-status");
    hiddenEl.className =
      "status " + (hiddenPassed === hiddenResults.length ? "pass" : hiddenPassed ? "partial" : "fail");
    hiddenEl.textContent = `${hiddenPassed}/${hiddenResults.length}`;

    const passed = res.results.filter((r) => r.pass).length;
    const allPassed = passed === res.results.length;
    const charCount = code.length;
    setResult(
      { score: scoreGolf(allPassed, charCount, level.par), charCount, meta: { allPassed } },
      `${passed}/${res.results.length}`
    );

    if (!allPassed) {
      // Only ever surface a *visible* test's actual value — leaking a hidden
      // test's expectation would hand the answer over.
      const firstVisibleFail = res.results
        .slice(0, level.visibleTests.length)
        .find((r) => !r.pass);
      if (firstVisibleFail) {
        setError(
          firstVisibleFail.error
            ? "Error: " + firstVisibleFail.error
            : "Got " + firstVisibleFail.actual + " — check the failing case above."
        );
      } else {
        setError("Visible tests pass, but a hidden test does not. Think about edge cases.");
      }
    }
  }

  return execute;
}

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------
storeReady.then(() => {
  Store.onChange(() => {
    route();
  });
  if (window.JSBATTLE_STORE_ERROR) {
    toast("Backend unreachable — playing locally.", "error");
  }
  route();
});
