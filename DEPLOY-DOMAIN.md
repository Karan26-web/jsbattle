# Deploying jsbattle.in — Vercel + Cloudflare + GoDaddy

The repo is already configured for this: `vercel.json` sets the headers and the
`www` → apex redirect, and every absolute URL in `index.html` now points at
`https://jsbattle.in`.

You have to do these steps yourself — they need your Vercel, Cloudflare and
GoDaddy logins, which I have no access to.

---

## 1. Deploy to Vercel (3 clicks, no CLI)

1. Go to **https://vercel.com/new**, sign in with GitHub.
2. **Import** the `Karan26-web/jsbattle` repository.
3. Framework Preset: **Other**. Leave Build Command and Output Directory empty —
   `vercel.json` already declares them. Click **Deploy**.

You will get a `*.vercel.app` URL. Confirm the game loads there before touching
DNS, so that if something breaks later you know it is DNS and not the app.

Every push to `main` redeploys automatically from here on.

## 2. Point GoDaddy at Cloudflare

1. **https://dash.cloudflare.com** → **Add a site** → `jsbattle.in` → **Free**.
2. Cloudflare scans existing records and shows you **two nameservers**, like
   `hank.ns.cloudflare.com` and `zara.ns.cloudflare.com`. Copy both.
3. GoDaddy → **My Products** → `jsbattle.in` → **DNS** → **Nameservers** →
   **Change** → **I'll use my own nameservers** → paste both → **Save**.

GoDaddy usually switches within 30 minutes, but it can take a few hours.
Cloudflare emails you when the domain is active.

## 3. Add the domain in Vercel

Vercel project → **Settings** → **Domains** → add `jsbattle.in`, then add
`www.jsbattle.in`.

Vercel will show you the exact DNS records it wants. **Use the values Vercel
shows you**, not the ones below — they occasionally differ per project. At the
time of writing they are:

| Type | Name | Value |
| --- | --- | --- |
| `A` | `@` | `76.76.21.21` |
| `CNAME` | `www` | `cname.vercel-dns.com` |

Add those in **Cloudflare → DNS → Records**.

> **Set the proxy status to "DNS only" (grey cloud) for now.** Vercel has to
> reach your domain directly to issue its TLS certificate, and a proxied record
> can stop that from completing. Once Vercel shows the domain as **Valid** with
> a certificate issued, you can switch it to Proxied in step 4.

## 4. Turn on HTTPS in Cloudflare

Once Vercel shows the domain as valid:

1. Cloudflare → **SSL/TLS** → **Overview** → set encryption mode to
   **Full (strict)**.
2. Cloudflare → **SSL/TLS** → **Edge Certificates** → turn on
   **Always Use HTTPS**. This is the `http://` → `https://` redirect you wanted.
3. Same page → turn on **Automatic HTTPS Rewrites**.
4. Optional: Cloudflare → **DNS** → switch the `@` and `www` records to
   **Proxied** (orange cloud) if you want Cloudflare's CDN, analytics and WAF in
   front of Vercel.

### ⚠️ The one setting that will break this

**Never set SSL/TLS mode to "Flexible".** Flexible makes Cloudflare talk plain
HTTP to Vercel, but Vercel always redirects HTTP to HTTPS — so Cloudflare gets a
redirect, follows it, arrives over HTTP again, and you get
`ERR_TOO_MANY_REDIRECTS` on a site that was working a minute earlier. It is the
single most common Cloudflare + Vercel failure. **Full (strict)** is correct.

Note that HTTPS already works without Cloudflare: Vercel issues its own
certificate and forces HTTPS on every domain. Cloudflare here is giving you DNS
management, caching and the edge redirect — not the certificate.

## 5. Update Supabase (if connected)

Supabase → **Authentication** → **URL Configuration**:

- Site URL → `https://jsbattle.in/`
- Redirect URLs → add `https://jsbattle.in/`

Password reset and email confirmation links break until this matches the live
origin exactly.

## 6. Re-check the social preview

Once the domain resolves, paste `https://jsbattle.in` into
**https://www.opengraph.xyz** to confirm the preview card renders. The OG tags
are already absolute and pointing at the right domain.

---

## Verifying it worked

```bash
# should return 301 to https
curl -sI http://jsbattle.in | head -3

# should return 200 and the security headers from vercel.json
curl -sI https://jsbattle.in | grep -iE "^(HTTP|x-frame|strict-transport|x-content)"

# www should redirect to the apex
curl -sI https://www.jsbattle.in | head -3
```

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `ERR_TOO_MANY_REDIRECTS` | Cloudflare SSL mode is **Flexible**. Set **Full (strict)**. |
| Vercel domain stuck "Invalid Configuration" | Record is Proxied. Set it to **DNS only** until the certificate issues. |
| Site loads but every level is broken | A frame-blocking header got set to `DENY`. It must be `SAMEORIGIN` — the app frames its own `sandbox.html` to run player code. |
| Still shows the old GitHub Pages site | Browser or Cloudflare cache. Purge in Cloudflare → **Caching** → **Purge Everything**. |
| `jsbattle.in` works, `www` does not | The `CNAME www` record is missing in Cloudflare. |

## Keeping GitHub Pages as a fallback

The Pages deploy at `https://karan26-web.github.io/jsbattle/` keeps working from
the same repo and costs nothing. It is a useful fallback while DNS propagates.
If you would rather retire it, disable Pages in the repo settings.
