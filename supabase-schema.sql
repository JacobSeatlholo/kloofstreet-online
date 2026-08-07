-- KloofStreet Street Pass - Supabase Schema
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- CLEAN SLATE (drop everything if re-running after a failed attempt)
DROP VIEW IF EXISTS partner_scan_stats CASCADE;
DROP VIEW IF EXISTS member_leaderboard CASCADE;
DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS update_updated_at() CASCADE;
DROP FUNCTION IF EXISTS handle_new_user() CASCADE;
DROP TABLE IF EXISTS referrals CASCADE;
DROP TABLE IF EXISTS weekly_activity CASCADE;
DROP TABLE IF EXISTS redemptions CASCADE;
DROP TABLE IF EXISTS rewards CASCADE;
DROP TABLE IF EXISTS scans CASCADE;
DROP TABLE IF EXISTS partners CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TYPE IF EXISTS scan_source CASCADE;
DROP TYPE IF EXISTS redemption_status CASCADE;
DROP TYPE IF EXISTS membership_status CASCADE;

-- ═══════════════════════════════════════════════════════════════════
-- ENUMS
-- ═══════════════════════════════════════════════════════════════════
CREATE TYPE membership_status AS ENUM ('pending', 'active', 'expired', 'cancelled');
CREATE TYPE redemption_status AS ENUM ('pending', 'confirmed', 'used', 'expired');
CREATE TYPE scan_source AS ENUM ('member_app', 'partner_scan', 'staff_verify');

-- ═══════════════════════════════════════════════════════════════════
-- PROFILES (extends Supabase auth.users)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  phone         TEXT,
  status        membership_status NOT NULL DEFAULT 'pending',
  points        INTEGER NOT NULL DEFAULT 0,
  total_scans   INTEGER NOT NULL DEFAULT 0,
  month_streak  INTEGER NOT NULL DEFAULT 0,
  referred_by   UUID REFERENCES profiles(id),
  referral_code TEXT UNIQUE NOT NULL DEFAULT gen_random_slug(8),
  wallet_serial TEXT UNIQUE,
  invoice_url   TEXT,
  paid_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════
-- PARTNERS (reference table for the 12 growth partners)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE partners (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  short_name  TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO partners (id, name, slug, short_name, sort_order) VALUES
  ('on-safari',       'On Safari',              'on-safari',       'On Safari',       1),
  ('ubuntu',          'Ubuntu Wellness Medi-Spa','ubuntu',          'Ubuntu',          2),
  ('dr-wendy',        'Dr Wendy Dicks',          'dr-wendy',        'Dr Wendy',        3),
  ('just-hearing',    'Just Hearing',            'just-hearing',    'Just Hearing',    4),
  ('dr-thomas',       'Dr Thomas Jahn',          'dr-thomas',       'Dr Thomas',       5),
  ('trudy',           'Trudy Christians',        'trudy',           'Trudy',           6),
  ('postnet',         'PostNet Gardens',         'postnet',         'PostNet',         7),
  ('revive',          'Revive Studio',           'revive',          'Revive',          8),
  ('dr-dale',         'Dr Dale Geoffreys',       'dr-dale',         'Dr Dale',         9),
  ('hayley',          'Hayley Schuter Physio',   'hayley',          'Hayley Physio',   10),
  ('edge-fitness',    'Edge Fitness Clubs',      'edge-fitness',    'Edge Fitness',    11),
  ('bodyvision',      'Body Vision Studio',      'bodyvision',      'Body Vision',     12);

-- ═══════════════════════════════════════════════════════════════════
-- SCANS (every QR scan at a partner counter)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE scans (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id      UUID NOT NULL REFERENCES profiles(id),
  partner_id     TEXT NOT NULL REFERENCES partners(id),
  points_earned  INTEGER NOT NULL DEFAULT 10,
  is_first_visit BOOLEAN NOT NULL DEFAULT false,
  source         scan_source NOT NULL DEFAULT 'member_app',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════
-- REWARDS (the redemption catalogue)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE rewards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  description      TEXT NOT NULL,
  points_required  INTEGER NOT NULL CHECK (points_required > 0),
  partner_id       TEXT REFERENCES partners(id),
  max_per_month    INTEGER DEFAULT 2,
  active           BOOLEAN NOT NULL DEFAULT true,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO rewards (name, description, points_required, partner_id, max_per_month, sort_order) VALUES
  ('10% Off Any Partner',        'Get 10% off your next purchase or treatment at any Street Pass partner.', 100,  NULL,          4, 1),
  ('Free Coffee at KSH',         'A complimentary filter coffee at Kloof Street House.',                                   300,  'on-safari',  2, 2),
  ('Complimentary Nail File',     'Free nail file with any treatment at Revive Studio.',                                 300,  'revive',     2, 3),
  ('R100 Off Treatment',          'R100 off any treatment at Trudy Christians Aesthetics.',                              500,  'trudy',      1, 4),
  ('R100 Off Consultation',       'R100 off your next consultation with Dr Wendy Dicks.',                                500,  'dr-wendy',   1, 5),
  ('Free Group Class',            'One complimentary group fitness class at Edge Fitness.',                               500,  'edge-fitness',1, 6),
  ('The Kloof Half-Day',          'Curated half-day experience across 3 partners. Valued at R500+. Limited to 4 per month.', 1000, NULL, 4, 7);

-- ═══════════════════════════════════════════════════════════════════
-- REDEMPTIONS (when a member cashes in points)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE redemptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   UUID NOT NULL REFERENCES profiles(id),
  reward_id   UUID NOT NULL REFERENCES rewards(id),
  points_used INTEGER NOT NULL,
  status      redemption_status NOT NULL DEFAULT 'pending',
  code        TEXT UNIQUE NOT NULL DEFAULT upper(substring(md5(random()::text), 1, 6)),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════
-- REFERRALS
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE referrals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id   UUID NOT NULL REFERENCES profiles(id),
  referred_id   UUID NOT NULL REFERENCES profiles(id),
  points_awarded INTEGER NOT NULL DEFAULT 200,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (referrer_id, referred_id)
);

-- ═══════════════════════════════════════════════════════════════════
-- WEEKLY MULTIPLIER TRACKING
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE weekly_activity (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   UUID NOT NULL REFERENCES profiles(id),
  week_start  DATE NOT NULL,
  partner_id  TEXT NOT NULL REFERENCES partners(id),
  scan_count  INTEGER NOT NULL DEFAULT 1,
  UNIQUE (member_id, week_start, partner_id)
);

-- ═══════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════
CREATE INDEX idx_scans_member       ON scans(member_id, created_at DESC);
CREATE INDEX idx_scans_partner      ON scans(partner_id, created_at DESC);
CREATE INDEX idx_scans_member_partner ON scans(member_id, partner_id, created_at DESC);
CREATE INDEX idx_redemptions_member ON redemptions(member_id, created_at DESC);
CREATE INDEX idx_profiles_referral  ON profiles(referral_code);
CREATE INDEX idx_weekly_activity_lookup ON weekly_activity(member_id, week_start);

-- ═══════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update their own, service role can do everything
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Service role full access profiles" ON profiles
  FOR ALL USING (auth.role() = 'service_role');

-- Scans: users can read their own, service role can insert (from API)
CREATE POLICY "Users can view own scans" ON scans
  FOR SELECT USING (auth.uid() = member_id);
CREATE POLICY "Service role can insert scans" ON scans
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role can read all scans" ON scans
  FOR SELECT USING (auth.role() = 'service_role');

-- Redemptions: users can read/redeem their own
CREATE POLICY "Users can view own redemptions" ON redemptions
  FOR SELECT USING (auth.uid() = member_id);
CREATE POLICY "Service role can insert redemptions" ON redemptions
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role can update redemptions" ON redemptions
  FOR UPDATE USING (auth.role() = 'service_role');

-- Weekly activity: users can read their own, service role upserts
CREATE POLICY "Users can view own weekly activity" ON weekly_activity
  FOR SELECT USING (auth.uid() = member_id);
CREATE POLICY "Service role can manage weekly activity" ON weekly_activity
  FOR ALL USING (auth.role() = 'service_role');

-- Referrals: users can view own, service role manages
CREATE POLICY "Users can view own referrals" ON referrals
  FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referred_id);
CREATE POLICY "Service role can manage referrals" ON referrals
  FOR ALL USING (auth.role() = 'service_role');

-- Rewards: public read (all authenticated users can see the catalogue)
ALTER TABLE rewards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view rewards" ON rewards
  FOR SELECT USING (auth.role() = 'authenticated');

-- Partners: public read
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view partners" ON partners
  FOR SELECT USING (true);

-- ═══════════════════════════════════════════════════════════════════
-- FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, display_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'phone'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Updated_at trigger for profiles
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════════
-- HELPFUL VIEWS
-- ═══════════════════════════════════════════════════════════════════

-- Member leaderboard (for admin/gamification)
CREATE VIEW member_leaderboard AS
SELECT
  p.id, p.display_name, p.points, p.total_scans, p.month_streak,
  p.created_at AS member_since,
  COUNT(DISTINCT s.partner_id) AS unique_partners_visited
FROM profiles p
LEFT JOIN scans s ON s.member_id = p.id
WHERE p.status = 'active'
GROUP BY p.id
ORDER BY p.points DESC;

-- Partner scan stats (for weekly partner reports)
CREATE VIEW partner_scan_stats AS
SELECT
  s.partner_id,
 p.name AS partner_name,
  date_trunc('week', s.created_at) AS week,
  COUNT(*) AS total_scans,
  COUNT(DISTINCT s.member_id) AS unique_members,
  SUM(s.points_earned) AS total_points_awarded
FROM scans s
JOIN partners p ON p.id = s.partner_id
GROUP BY s.partner_id, p.name, date_trunc('week', s.created_at)
ORDER BY week DESC, total_scans DESC;
