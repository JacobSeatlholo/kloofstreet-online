# For Business page (`/merchant`) — plain English guide

## What this page is now
The old Merchant Workstation page has become a **HustlePortal gateway**. KloofStreet.online
is a pure directory — merchants run everything else (newsletters, contacts, business tools)
from their backoffice at **https://www.hustleportal.online/**.

The page now contains:
- **Login hero** — a "Sign in to HustlePortal" button (opens hustleportal.online in a new tab),
  plus a note that a free account comes with R99 in lead credits.
- **How the backoffice works** — 5 steps (sign in → set up profile → import customers →
  send newsletter → run the whole business).
- **What's inside the backoffice** — Newsletters, Contacts, Business OS, AI tools cards.
- **Street Pass check-in tools** (kept, hidden behind the "Open Street Pass tools" button) —
  store owners still sign in here with their store account to verify member check-ins
  and confirm reward redemptions for the KloofStreet loyalty programme.

## Street Pass merchant sign-in (still on this page)
- Sign-in uses the Supabase members auth (`streetpass` APIs on KloofStreet's own Supabase).
- `merchant-schema.sql` sets up the merchant tables — safe to run twice (idempotent).

## Step 1 — Run the SQL (Supabase → SQL Editor → Run)
Paste all of `merchant-schema.sql` and click Run. Safe to run twice.

## Step 2 — Register each store (Supabase → SQL Editor)
For every store that should get access, run (edit both quoted values):

```sql
UPDATE partners SET login_email = 'owner@storename.co.za'
  WHERE name ILIKE '%store name%';
```

The email must be the exact address the store owner will sign in with.
Check your work:

```sql
SELECT name, login_email FROM partners ORDER BY name;
```

## Notes
- The newsletter system no longer runs on KloofStreet. It was rebuilt as a Next.js module
  on HustlePortal (see the HustlePortal repo / NEWSLETTER-SETUP.md there). KloofStreet
  keeps a `/newsletter` → hustleportal.online redirect in `vercel.json` for old links.
- No Google/Gmail env vars are needed on KloofStreet anymore — only the Supabase ones
  (members auth, streetpass, tracking still use them).
- Old links still work: /newsletter redirects to HustlePortal; /dash opens this page.
- Members are unaffected: Street Pass scanning, rewards and sign-up work exactly as before.
