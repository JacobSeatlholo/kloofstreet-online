# Merchant Workstation — Setup Guide (plain English)

## What you got
- **Newsletter removed from the public menu.** It now lives inside the new merchant workstation.
- **New "For Business" page** (`/merchant`) — only logged-in merchants can use it.
- **Merchant workstation** with 4 tabs:
  - **Overview** — your store info + live numbers (check-ins, members, points)
  - **Check-ins** — every Street Pass scan at your store + manual check-in by referral code
  - **Redemptions** — confirm the codes members show you
  - **Newsletter** — full newsletter tool (compose / contacts / history), each store uses its OWN Gmail
- **Gmail connects automatically** right after the merchant signs in.
- All newsletter APIs now require a merchant sign-in (they were open to the whole internet before — fixed).

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

## Step 3 — Put the files on your Mac and push
```bash
cd ~/kloofstreet-online
```
(then the download/unzip/push commands from the chat)

## Step 4 — Wait 2 minutes, then test
1. Hard-refresh the site (Cmd + Shift + R)
2. Menu → **For Business**
3. Sign in with a registered store email + password
   (password = create it first at /streetpass/join with that same email, or sign in if it exists)
4. Gmail popup opens automatically on first sign-in — approve it
5. Try the tabs

## Notes
- No new Vercel env vars needed. The Google redirect URI from the newsletter setup stays the same.
- Each store connects its own Gmail. Tokens are stored per store and never shared.
- Old links still work: /newsletter and /dashboard now open the workstation.
- Members are unaffected: Street Pass scanning, rewards and sign-up work exactly as before.
