# Connecting Supabase — 5 minute setup

The live site works right now without this: scores save to localStorage, one
player per browser. Doing this adds real accounts, a global leaderboard, and
progress that follows you across devices.

You need to do steps 1–5 (they need your account). Send me the two values from
step 4 and I'll do the rest.

---

## 1. Create the project

Go to **https://supabase.com/dashboard** → sign in with GitHub → **New project**.

| Field | What to put |
| --- | --- |
| Name | `jsbattle` |
| Database Password | Click **Generate**, then save it in your password manager |
| Region | **South Asia (Mumbai)** — closest to you, lowest latency |
| Plan | Free |

Provisioning takes ~2 minutes. Wait for the green "Project is ready".

> The database password is *not* what the app uses. You will never paste it into
> this project. It is only for connecting to Postgres directly.

## 2. Create the tables

Left sidebar → **SQL Editor** → **New query**.

Open `supabase-schema.sql` from this repo, copy the **entire file**, paste it in,
and press **Run** (or Ctrl/Cmd + Enter).

You should see **"Success. No rows returned"**. That is the correct result — the
script creates tables and functions rather than selecting anything.

This script is safe to run more than once, so if you are unsure whether it
worked, just run it again.

## 3. Turn off email confirmation

Left sidebar → **Authentication** → **Sign In / Providers** → **Email**.

Turn **Confirm email** *off*, then **Save**.

With it on, a new player cannot play until they click a link in their inbox, and
Supabase's built-in mailer is rate-limited to a handful of messages per hour on
the free plan. Off is the right choice for a game. (The app handles both, so if
you would rather leave it on, everything still works — new players just get a
"check your email" message instead of being signed straight in.)

## 4. Copy the two values I need

Left sidebar → **Project Settings** (gear icon) → **API**.

Copy these two:

1. **Project URL** — looks like `https://abcdefghijklm.supabase.co`
2. **anon** / **public** key — a long string starting `eyJ...`

Send me both and I will wire them in, redeploy, and verify signup, login,
password reset, and the leaderboard against the live site.

> **Is the anon key a secret?** No. It is designed to ship in client-side code
> and identifies the project, not you. Every table is protected by Row Level
> Security, so this key alone cannot read or write anything the policies do not
> already allow anonymously. The key you must *never* share is the
> **`service_role`** key on that same page — it bypasses RLS entirely. Do not
> copy that one.

## 5. Allow the site to receive auth redirects

Left sidebar → **Authentication** → **URL Configuration**.

| Field | Value |
| --- | --- |
| Site URL | `https://jsbattle.in/` |
| Redirect URLs | add `https://jsbattle.in/` |

Password reset and confirmation links will not work until this is set —
Supabase refuses to redirect to an origin that is not on this list.

If you later move to your own domain, add that URL here too.

---

## What I do once you send the values

1. Put them in `config.js` and push — GitHub Pages redeploys automatically.
2. Verify against the live site: create an account, sign out, sign back in,
   submit a score, confirm it appears on the global leaderboard, and confirm a
   worse resubmission does not overwrite a better score.
3. Confirm the app still degrades to localStorage if Supabase is ever
   unreachable, so a backend outage cannot take the game down.

## If something goes wrong

| Symptom | Cause |
| --- | --- |
| "Invalid API key" | The `service_role` key or the JWT secret was copied instead of **anon public**. |
| Sign-up succeeds but nothing happens | Email confirmation is still on (step 3). |
| Reset link opens the site but not the form | Step 5 was skipped, or the URL does not match exactly — trailing slash included. |
| "relation does not exist" | The schema in step 2 did not run. Re-run it; it is idempotent. |
| Leaderboard is empty but you have scores | Expected — the board hides accounts with 0 XP until they score. |
