-- ═══════════════════════════════════════════════════════════════════
-- KLOOFSTREET MERCHANT WORKSTATION — database migration
-- Paste ALL of this into Supabase → SQL Editor → Run.
-- Safe to run more than once (it will not duplicate anything).
-- ═══════════════════════════════════════════════════════════════════

-- 1. Merchants log in with an email. Link that email to their store.
ALTER TABLE partners ADD COLUMN IF NOT EXISTS login_email TEXT;

-- 2. Remember when a redemption code was confirmed by the store.
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

-- 3. Each store connects its OWN Gmail for newsletters.
ALTER TABLE google_oauth_tokens ADD COLUMN IF NOT EXISTS merchant_email TEXT;

-- 4. Speed up lookups.
CREATE INDEX IF NOT EXISTS idx_partners_login_email ON partners (login_email);
CREATE INDEX IF NOT EXISTS idx_scans_partner_created ON scans (partner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_redemptions_code ON redemptions (code);

-- ═══════════════════════════════════════════════════════════════════
-- REGISTER A MERCHANT (run once per store — edit the two quoted values)
-- The email must match the account the store owner will sign in with.
-- ═══════════════════════════════════════════════════════════════════
-- UPDATE partners SET login_email = 'owner@storename.co.za'
--   WHERE name ILIKE '%store name%';

-- To see all stores and which ones can already log in:
-- SELECT id, name, short_name, login_email FROM partners ORDER BY name;
