# KloofStreet Newsletter — Deployment Fix Package

## What happened

The four `api/newsletter/*.js` files were **never pushed to GitHub** — they only
existed in a temporary workspace that was later wiped, so the live Vercel
deployment has no newsletter API. Every `/api/newsletter/*` request currently
falls through the SPA rewrite and returns `index.html`.

A second bug was found in `index.html`: the entire newsletter JavaScript block
was inside a `<script src="...">` tag (line 4955), so browsers **ignore it
completely** — all `nl*` functions were dead code. This package fixes that too.

Both fixes were rebuilt from the deployed frontend's exact API contract and
passed a 30-test smoke suite (draft → publish → batch send, rate-limit retry,
token refresh, Sheets import, unsubscribe, disconnect).

## Files in this package

| File | Where it goes |
|------|---------------|
| `api/newsletter/google-auth.js` | `~/kloofstreet-online/api/newsletter/google-auth.js` |
| `api/newsletter/contacts.js`    | `~/kloofstreet-online/api/newsletter/contacts.js` |
| `api/newsletter/send.js`        | `~/kloofstreet-online/api/newsletter/send.js` |
| `api/newsletter/unsubscribe.js` | `~/kloofstreet-online/api/newsletter/unsubscribe.js` |
| `index.html` (patched)          | `~/kloofstreet-online/index.html` (overwrite) |
| `newsletter-schema.sql`         | Run in Supabase SQL Editor (updated: adds `email` + `contact_source` columns) |

No `package.json` change needed — the API routes use `@supabase/supabase-js`
(already present) plus native `fetch` for all Google API calls.

## STEP 1 — Run the SQL schema (Supabase Dashboard)

Supabase Dashboard → SQL Editor → paste **all** of `newsletter-schema.sql` → Run.
(It is safe to run even if you already ran the older dpaste version — the new
`ALTER TABLE ... IF NOT EXISTS` lines at the bottom patch existing installs.)

## STEP 2 — Copy the files on your MacBook

```bash
cd ~/kloofstreet-online
# from wherever you unzipped this package:
unzip kloofstreet-newsletter-fix.zip -d /tmp/nlfix
mkdir -p api/newsletter
cp /tmp/nlfix/api/newsletter/*.js api/newsletter/
cp /tmp/nlfix/index.html index.html
```

If you have uncommitted local edits to index.html you want to keep, instead of
overwriting apply the two tiny changes manually:
1. Line 4955: change
   `<script src="https://translate.google.com/...async defer>` to end with
   `</script>` and open a NEW plain `<script>` tag right after it (before the
   NEWSLETTER SYSTEM comment).
2. In `nlCountRecipients()`: add `params.set('active_only', 'true');` after the
   `params.set('limit','1');` line.

## STEP 3 — Push (auto-deploys to Vercel)

```bash
git add api/newsletter index.html
git commit -m "feat: newsletter API routes + fix newsletter JS script tag"
git push
```

## STEP 4 — Vercel environment variables (verify all exist)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` → **`https://www.kloofstreet.online/api/newsletter/google-auth?step=callback`**
  (use **www** — the apex domain 307-redirects to www)

If you changed env vars, redeploy (any `git push`, or Vercel dashboard →
Redeploy) so they take effect.

## STEP 5 — Google Cloud Console (once)

1. APIs & Services → Library → enable **Gmail API** and **Google Sheets API**.
2. APIs & Services → OAuth consent screen → External → add yourself as a test
   user (or publish the app).
3. Credentials → OAuth client ID (Web application) → Authorized redirect URIs,
   add BOTH:
   - `https://www.kloofstreet.online/api/newsletter/google-auth?step=callback`
   - `https://kloofstreet.online/api/newsletter/google-auth?step=callback`

## STEP 6 — Verify

```bash
# should return {"connected":false}
curl https://www.kloofstreet.online/api/newsletter/google-auth?step=status

# should return {"total":0,"page":1,"pages":1,"contacts":[]}
curl https://www.kloofstreet.online/api/newsletter/contacts
```

Then in the browser: open kloofstreet.online → Newsletter → Connect Gmail →
add a test contact → compose → send. Every email includes a working
unsubscribe link (supports Gmail One-Click).
