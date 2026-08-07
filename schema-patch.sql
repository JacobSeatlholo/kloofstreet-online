-- ═══════════════════════════════════════════════════════════════════
-- STREET PASS SCHEMA PATCH — Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════
-- This patches your existing database. It does NOT drop tables.
-- Run this AFTER you have already run the main schema successfully.
-- ═══════════════════════════════════════════════════════════════════

-- 1. ADD INSERT policy so members can create their own profile via frontend upsert
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- 2. DROP the old trigger that was causing "Database error saving new user"
--    (profile creation is now handled by the frontend, not the DB trigger)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user() CASCADE;

-- 3. Verify your profile exists (replace the UUID with your actual auth user ID)
--    If you know your user ID, uncomment and run:
-- INSERT INTO profiles (id, display_name, status, referral_code)
-- VALUES (
--   'YOUR_USER_UUID_HERE',
--   'Your Name',
--   'active',
--   upper(substring(md5(random()::text), 1, 8))
-- )
-- ON CONFLICT (id) DO NOTHING;

-- 4. Quick verification: list all profiles
SELECT id, display_name, status, points, referral_code, created_at FROM profiles;
