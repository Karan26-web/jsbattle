# JSBattle

41 levels across four categories, with a unified XP economy, six ranked tiers,
per-level medals, and an optional Supabase backend for real accounts and a
global leaderboard.

| Category | Levels | You write | Scored by |
| --- | --- | --- | --- |
| **Visual Match** | 11 | `render(ctx)` | pixels against a reference canvas |
| **UI Components** | 8 | `render(ctx)` | pixels against a reference canvas |
| **Animation** | 10 | `render(ctx, t)` | pixels across six sampled frames |
| **Code-Golf** | 12 | `solve(...)` | tests passed, then character count |

Zero build step — plain HTML/CSS/JS, CodeMirror and supabase-js from a CDN.

## Run it

```bash
cd jsbattle
python3 -m http.server 8080
# open http://localhost:8080
```

A plain `file://` open will not work — the iframe/postMessage sandbox needs a
real origin.

## Files

| File | Role |
| --- | --- |
| `index.html` | Shell: header, `#app` mount, footer, script load order |
| `config.js` | Supabase URL + anon key. Placeholders = offline mode |
| `levels.js` | All 23 level definitions, each with a `par` char count |
| `ranks.js` | Scoring curves, medals, tier thresholds |
| `store.js` | Data layer: `SupabaseBackend` and `LocalBackend` behind one async API |
| `app.js` | Router, views, sandbox runner. All trusted code |
| `sandbox.html` | Where player code actually executes |
| `supabase-schema.sql` | Tables, RLS, ranking views, `submit_score` RPC |

## How code execution is isolated

Player code never runs in the app's page. It runs in a **Worker, inside a
sandboxed iframe** — both layers matter:

- The iframe is `sandbox="allow-scripts"` with **no** `allow-same-origin`, which
  puts it on a unique opaque origin. It cannot reach the app's cookies,
  localStorage, or DOM regardless of what runs inside.
- A strict CSP (`default-src 'none'`) blocks every outbound request, and
  `fetch`/`XHR`/`WebSocket`/`EventSource`/`importScripts` are additionally
  deleted so calls fail loudly rather than hanging on a blocked request.
- The code runs in a Worker spawned from a `blob:` URL, which **inherits that
  opaque origin and CSP** — so isolation is preserved.

The Worker is the part that makes hang protection real. An infinite loop burns
the *worker's* thread, so the watchdog `setTimeout` in the page still fires and
`worker.terminate()` actually kills it. Verified end to end: `while(1){}` is
killed in ~2.5s, the main thread stays responsive throughout, and the level is
immediately playable again.

> Player code is concatenated into the worker's own source rather than `eval`'d,
> so the CSP never needs `unsafe-eval`. Syntax errors surface through the
> worker's `onerror`.

If a browser lacks `OffscreenCanvas`, visual levels fall back to running on the
iframe's thread — correct, but without the kill switch. Golf levels always use
the Worker.

## Scoring

Both level types emit **0–1000 XP** so a Visual win and a Golf win are worth the
same, which is what makes a single global ranking meaningful. Every level
carries a `par`: the character count of a competent golfed solution.

**Visual / UI** — pixel match against a reference drawn by trusted code, with a
small tolerance for anti-aliasing. From 60→100% the curve is convex, so the
fiddly last few percent is where the points are. A brevity bonus unlocks only at
≥97% match, so a tiny-but-wrong answer can never win.

Pixels are **weighted**, which matters more than it sounds. A flat "fraction of
pixels that match" is dominated by background: on the orbit level the moving
moon is ~0.5% of 120,000 pixels, so a submission that painted the background and
drew nothing else measured 97% and scored **903 of 1000**, and code that ignored
`t` entirely came within 13 points of a correct animation. Now a pixel counts
fully whenever the target *or* the player's output has something other than the
background colour there, and background-on-background agreement is worth 0.05.
The same submissions now score **12** and **559** against 958 for a correct one.
Weighting both sides also penalises painting extra ink where the target has none.

**Animation** — `render(ctx, t)` is called with `t` running 0→1. The harness
owns the clock and calls the function once per frame, so player code needs no
`requestAnimationFrame` and no timing logic of its own; that is what makes a run
reproducible. Scoring samples six fixed values of `t` and averages the match
across all of them, so the whole motion has to be right rather than one
convenient pose: a correct shape at the wrong phase, at half speed, or orbiting
backwards all fail.

Preview and scoring run at deliberately different cadences. Six frames is plenty
to score but far too few to *watch* — replaying those six was a 2.5fps slideshow
sitting next to a 60fps target, which reads as "my code is broken" when it is
not. The worker now renders **36 frames** for playback and measures every sixth,
which works out to exactly the same six values of `t` as before, so difficulty
is unchanged. Playback frames come back as `ImageBitmap`s — GPU-backed and
transferable, so 36 of them cost far less than 36 `ImageData` buffers, and they
are explicitly `close()`d when replaced.

Both canvases step through the same quantised frame index at 24fps. Rendering
the target live at 60fps beside a stepped preview made a *correct* answer look
worse than it was; in lockstep they are directly comparable.

```
100% at par     950      97%  at par   851      75% at par   207
100% at par/1.4 977      90%  at par   585      60% at par     0
```

**Golf** — every test must pass or the score is 0; correctness is a gate, not a
score. Past that it is pure brevity against par. Hitting par is a perfect 1000
and beating par cannot exceed it, so there is no runaway.

```
par 175:   140ch = 1000    175ch = 1000    220ch = 877    300ch = 750
```

**Tiers** are a fraction of the theoretical maximum rather than absolute
numbers, so adding levels does not silently promote everyone: Bronze → Silver
(20%) → Gold (38%) → Platinum (56%) → Diamond (72%) → Master (88%). Per-level
medals are Gold ≥900, Silver ≥750, Bronze ≥500.

## Connecting Supabase

Without it the app runs fine — scores go to localStorage, single player, no
sign-in. To turn on real accounts and a global leaderboard:

1. Create a Supabase project (**Postgres 15+** — the ranking views use
   `security_invoker`, which older versions reject).
2. Paste `supabase-schema.sql` into the SQL Editor and run it. It is idempotent.
3. Copy Project URL + `anon public` key from **Project Settings → API** into
   `config.js`.
4. **Authentication → Providers → Email**: turn *Confirm email* off if you want
   players to sign up and play immediately. The app handles both settings.

That is the whole integration — `store.js` swaps backends automatically based on
whether `config.js` holds real values, and if Supabase is configured but
unreachable the app degrades to local play instead of showing a dead page.

### Accounts

The full email/password flow is implemented against Supabase Auth:

| Flow | Where |
| --- | --- |
| Create account (email, password, display name) | Header → Sign in → Create account |
| Sign in / sign out | Header → account menu |
| Forgot password → email link → set new password | Auth modal → *Forgot your password?* → `#/reset-password` |
| Change display name | Profile → *Change display name* |
| Session persistence across reloads/devices | Handled by supabase-js |

One integration detail worth knowing if you modify routing: **Supabase delivers
recovery and confirmation tokens in the URL hash** — the same place this app
keeps its router state. supabase-js consumes and strips those params before the
router ever runs, so you cannot detect a recovery by reading `location.hash`.
`store.js` listens for the `PASSWORD_RECOVERY` auth event instead and redirects
to `#/reset-password` from there. For the same reason, the `redirectTo` passed
to `resetPasswordForEmail` deliberately carries **no hash of its own** — two
hashes cannot coexist in one URL.

Without Supabase configured, the same UI collapses to a single "pick a display
name" step and everything stays in localStorage.

What the schema gives you:

- `profiles` — created automatically by a trigger on signup, with username
  collision handling (`karan`, `karan1`, …) so a taken name never fails a signup.
- `scores` — one row per (player, level): a personal best, not a history.
- `submit_score()` — an upsert that **refuses to go backwards**. A replayed or
  out-of-order lower score leaves your best untouched, and it always returns the
  true current best so the client renders truth rather than hope.
- `global_rankings` / `level_rankings` — views with the rank window function
  computed in Postgres. Readable anonymously, so visitors can browse
  leaderboards without an account.
- RLS: everything world-readable, only ever writable by its owner.

> The schema is **verified against real PostgreSQL 18**: it applies cleanly and
> is re-runnable; the signup trigger resolves username collisions
> (`karan`, `karan1`, `karan2`) and sanitises empty or symbol-only names to
> `player`; `submit_score` improves a best but refuses to lower one (submitting
> 400 over a stored 950 leaves 950 intact) and always keeps exactly one row per
> player+level; out-of-range and unauthenticated writes are rejected; both
> ranking views order correctly with `security_invoker` on; and RLS is enabled
> with all five policies plus the CHECK and UNIQUE constraints holding.

## Known limitations

- **Scores are computed client-side, so they are forgeable.** Someone with
  devtools can call the RPC with any score up to 1000. Fine for a personal or
  friends-group build; not fine for a public competitive board. The fix is to
  move scoring into an Edge Function that re-runs the submitted code server-side
  and writes the score itself — `submit_score` is already the single write path,
  so that change is localised.

  The *easy* version of this is closed. Player code shares the worker's global
  scope and runs before the harness, so it used to be able to simply call
  `self.postMessage({ok:true, results:[…all pass]})` and score 1000 without
  solving anything. Now a prelude captures the real `postMessage` before player
  code runs and replaces it with a thrower, and the harness tags every result
  with a per-run token that the iframe verifies. Forging a result would require
  recovering that token from the harness at runtime — not a one-liner any more,
  but still not impossible. Untrusted code sharing a realm can never be fully
  contained; only server-side execution actually settles it.
- **Hidden tests are not really hidden.** They ship in `levels.js`. Same fix as
  above: move test cases server-side.
- Anonymous/local play uses one display name per browser; clearing storage
  clears progress. Supabase accounts are the durable path.

## Adding a level

**Visual / UI** — add to `VISUAL_LEVELS` or `UI_LEVELS` with a `drawTarget(ctx)`.
That function is the answer key, drawn with trusted code on the main thread and
compared pixel-by-pixel against the player's `render(ctx)`. Set `par` to the
character count of a solution you would be happy with.

**Animation** — add to `ANIM_LEVELS` with `drawTarget(ctx, t)`. Make it a pure
function of `t` — no clock, no `Math.random()` — or the level cannot be matched.

**Golf** — add to `GOLF_LEVELS` with `visibleTests` and `hiddenTests` arrays of
`{ input: [...], expected: ... }`. `input` is spread as arguments, and
comparison is `JSON.stringify` deep equality. Set `par` the same way.

All take a `hint`, shown behind a toggle. Sections and filters are generated
from `LEVEL_GROUPS`, so a new category appears on the level select and in the
filter bar without touching `app.js`.

> **Never use `fillText` in a target.** Font rasterisation differs between
> machines and browsers, so a target containing real text can never be matched
> reliably. The UI levels represent labels as bars, the way a wireframe does.

You do not list the colours anywhere. Every canvas level shows a **spec strip**
under the target with the canvas size and the palette, and that palette is read
back out of the *rendered* target rather than declared on the level — so it
cannot drift out of sync with `drawTarget`. Anti-aliased shades are merged into
the dominant colour they came from, swatches copy on click, and the top swatch
is only labelled `bg` when one colour actually dominates the canvas. Targets
that blend (a gradient, or shapes drawn with alpha) say so instead of implying
the handful of swatches is the whole story.

## Deploying to your own domain

JSBattle is **pure static files** — no Node runtime, no build step, no server.
It also routes on the URL *hash* (`#/levels`), which never reaches the server,
so you do **not** need SPA rewrite rules anywhere. Upload the folder and it
works. That makes it deployable on effectively any host, including cheap shared
hosting for a `.in` or `.com` domain.

### Before you upload (2 minutes)

1. **Set your domain in `index.html`.** Replace all four occurrences of
   `https://jsbattle.example` with your real URL. These are the canonical and
   Open Graph tags — link previews on WhatsApp, Slack, X and iMessage need
   absolute URLs, and a wrong value shows a blank card instead of an error.
2. **Add your domain to Supabase** (if using it): **Authentication → URL
   Configuration** → set *Site URL* to `https://yourdomain.com` and add it under
   *Redirect URLs*. Password reset and email confirmation links will not work
   until you do — Supabase refuses to redirect to an unlisted origin.
3. Fill in `config.js` with your Supabase URL and anon key.

### Option A — Shared hosting / cPanel (Hostinger, GoDaddy, Bluehost)

The usual path when you have bought a `.in` or `.com` with hosting attached.

1. Control panel → **File Manager** → open `public_html/`.
2. Upload everything in `jsbattle/` — including the dotfile **`.htaccess`**
   (enable "show hidden files" in the file manager, or it silently won't upload).
3. Control panel → **SSL** → issue the free Let's Encrypt certificate.
4. Once the certificate is live, uncomment the HTTPS redirect block at the top
   of `.htaccess`.

The included `.htaccess` sets security headers, gzip, and cache rules —
`index.html` is deliberately never cached so deploys reach players immediately.

### Option B — Cloudflare Pages (free, fast, keeps your registrar)

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build command: *(leave empty)*. Build output directory: `jsbattle`.
4. **Custom domains → Set up a domain** → enter your domain and follow the DNS
   prompts. If your domain is registered elsewhere, point its nameservers at
   Cloudflare; if it is registered with Cloudflare, this is one click.

The included `_headers` file is picked up automatically.

### Option C — Your own VPS (nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    root /var/www/jsbattle;
    index index.html;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    # SAMEORIGIN, not DENY — the app frames its own sandbox.html.
    add_header X-Frame-Options SAMEORIGIN always;

    location = /index.html { add_header Cache-Control "no-cache, must-revalidate"; }
    location ~* \.(png|svg|webmanifest)$ { expires 30d; }
}

server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}
```

Then `rsync -av jsbattle/ user@server:/var/www/jsbattle/` and
`sudo certbot --nginx -d yourdomain.com`.

### Pointing the domain (any registrar — GoDaddy, Namecheap, BigRock, Hostinger)

In your registrar's DNS panel:

| Host provides | Record | Name | Value |
| --- | --- | --- | --- |
| An IP address | `A` | `@` | `203.0.113.10` |
| A hostname | `CNAME` | `www` | `your-site.pages.dev` |

Add both `@` (the bare domain) and `www` so either form works. DNS changes
usually apply in minutes but can take up to 24–48 hours to propagate fully.

### One warning that will save you an hour

If you set a frame-blocking header anywhere, it must be **`SAMEORIGIN`, never
`DENY`**. JSBattle frames its own `sandbox.html` to execute player code; `DENY`
blocks that iframe and every level silently stops working. The same applies to
`Content-Security-Policy: frame-ancestors` — use `'self'`, not `'none'`.

---

Made by **Karan**.
