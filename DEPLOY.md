# Street Pass Deployment Guide

## Prerequisites

1. Supabase project created at supabase.com
2. Vercel project linked to the kloofstreet-online repo
3. Partner QR codes printed and placed at counters

## Step 1: Supabase Setup

1. Create a new Supabase project (or use existing)
2. Go to SQL Editor and run the full contents of `supabase-schema.sql`
3. This creates: profiles, partners, scans, rewards, redemptions, referrals, weekly_activity tables + RLS + triggers
4. Go to Authentication > Providers > Enable Email/Password
5. Go to Settings > API. Copy:
   - Project URL (e.g. `https://xyz.supabase.co`)
   - Anon/public key (starts with `eyJ...`)
   - Service role key (starts with `eyJ...`)

## Step 2: Configure Vercel Environment Variables

In Vercel project dashboard > Settings > Environment Variables, add:

```
SUPABASE_URL = https://xyz.supabase.co
SUPABASE_SERVICE_ROLE_KEY = eyJ...service-role-key
```

## Step 3: Replace Supabase Placeholders in index.html

Search for `SUPABASE_URL_PLACEHOLDER` and `SUPABASE_ANON_KEY_PLACEHOLDER` in index.html (around the `spClient()` function). Replace with your actual values:

```javascript
// Before (line ~4304):
_spClient = supabase.createClient(
  'SUPABASE_URL_PLACEHOLDER',
  'SUPABASE_ANON_KEY_PLACEHOLDER'
);

// After:
_spClient = supabase.createClient(
  'https://xyz.supabase.co',
  'eyJ...your-anon-key'
);
```

The anon key is safe in client-side code. Supabase RLS policies restrict what authenticated users can do.

## Step 4: Configure Supabase Auth Settings

In Supabase > Authentication > URL Configuration:
- Site URL: `https://kloofstreet.online`
- Redirect URLs: `https://kloofstreet.online/streetpass`

## Step 5: Activate First Member (Manual)

For now, activation is manual:
1. Member signs up and pays via EFT
2. You receive payment confirmation
3. In Supabase Table Editor > profiles: find the member, set `status` to `active`, set `paid_at` to current timestamp
4. Member can now scan and redeem

## Step 6: Print QR Codes

The `qrcodes/` folder contains 12 PNG files, one per partner. Each encodes `kloof://partner/{slug}`.

Print each QR code and place it at the partner's counter. Members scan these with the Street Pass scan page.

## Step 7: Update vercel.json (if needed)

The existing rewrite (`/(.*) -> /index.html`) already handles all paths. The API functions in `/api/` are automatically served by Vercel as serverless functions.

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/scan` | POST | None (member_id in body) | Record a QR scan, award points |
| `/api/redeem` | POST | None (member_id in body) | Redeem points for a reward |
| `/api/member` | GET | Bearer token | Get member profile + stats |
| `/api/member` | PATCH | Bearer token | Update member name/phone |

## Payment Flow (MVP)

1. Member signs up at kloofstreet.online/streetpass/join
2. Shown EFT bank details with unique reference (SP-XXXXXXXX)
3. Member pays R199 via EFT
4. Jacob verifies payment in bank statement
5. Jacob sets profile status to 'active' in Supabase
6. Member gets access to scan and redeem

## Future: Automated Payments

For automated payment verification, integrate:
- **PayFast**: SA's most popular payment gateway. Webhook notifies your API on payment.
- **Yoco**: Good for card payments. Has a JS SDK for embedded checkout.

The API functions already have the structure to support this. Add a `/api/webhook` endpoint that receives payment confirmation and automatically sets `status = 'active'` and `paid_at = now()`.