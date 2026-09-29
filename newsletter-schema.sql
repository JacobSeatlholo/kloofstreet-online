-- ═══════════════════════════════════════════════════════════════════
-- KloofStreet Newsletter System - Supabase Schema
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- NEWSLETTER CONTACTS (subscriber list)
CREATE TABLE IF NOT EXISTS newsletter_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  name        TEXT,
  source      TEXT NOT NULL DEFAULT 'manual',        -- 'manual', 'google-sheets', 'streetpass', 'website-signup'
  tags        TEXT[] DEFAULT '{}',                    -- e.g. ['streetpass', 'partner', 'visitor']
  unsubscribed BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(email)
);

-- NEWSLETTERS (drafts and sent newsletters)
CREATE TABLE IF NOT EXISTS newsletters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject     TEXT NOT NULL,
  body_html   TEXT NOT NULL,                          -- full HTML body
  body_text   TEXT,                                   -- plain text fallback
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','sending','sent','failed')),
  from_name   TEXT NOT NULL DEFAULT 'KloofStreet.online',
  from_email  TEXT NOT NULL DEFAULT 'hello@kloofstreet.online',
  reply_to    TEXT,
  contact_source TEXT,                                  -- recipient filter: contact source (null = all)
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count  INTEGER NOT NULL DEFAULT 0,
  fail_count  INTEGER NOT NULL DEFAULT 0,
  open_count  INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  tags        TEXT[] DEFAULT '{}',
  scheduled_at TIMESTAMPTZ,                           -- for future scheduling
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NEWSLETTER SENDS (individual send tracking - one row per recipient per newsletter)
CREATE TABLE IF NOT EXISTS newsletter_sends (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  newsletter_id   UUID NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES newsletter_contacts(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','bounced')),
  gmail_message_id TEXT,                              -- Gmail API message ID for tracking
  error_message   TEXT,
  sent_at         TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  clicked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(newsletter_id, contact_id)
);

-- GOOGLE OAUTH TOKENS (stores the admin's Google OAuth tokens)
CREATE TABLE IF NOT EXISTS google_oauth_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token    TEXT NOT NULL,
  refresh_token   TEXT NOT NULL,
  token_type      TEXT NOT NULL DEFAULT 'Bearer',
  scope           TEXT,
  email           TEXT,                                 -- connected Gmail account (for status display)
  expiry_date     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_nl_contacts_email ON newsletter_contacts(email);
CREATE INDEX IF NOT EXISTS idx_nl_contacts_source ON newsletter_contacts(source);
CREATE INDEX IF NOT EXISTS idx_nl_contacts_unsub ON newsletter_contacts(unsubscribed);
CREATE INDEX IF NOT EXISTS idx_newsletters_status ON newsletters(status);
CREATE INDEX IF NOT EXISTS idx_newsletters_created ON newsletters(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nl_sends_newsletter ON newsletter_sends(newsletter_id, status);
CREATE INDEX IF NOT EXISTS idx_nl_sends_contact ON newsletter_sends(contact_id);
CREATE INDEX IF NOT EXISTS idx_google_oauth_expiry ON google_oauth_tokens(expiry_date);

-- ═══════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE newsletter_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletters ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Service role full access (API routes use service role)
DROP POLICY IF EXISTS "Service role full access contacts" ON newsletter_contacts;
CREATE POLICY "Service role full access contacts" ON newsletter_contacts
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Service role full access newsletters" ON newsletters;
CREATE POLICY "Service role full access newsletters" ON newsletters
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Service role full access sends" ON newsletter_sends;
CREATE POLICY "Service role full access sends" ON newsletter_sends
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Service role full access oauth" ON google_oauth_tokens;
CREATE POLICY "Service role full access oauth" ON google_oauth_tokens
  FOR ALL USING (auth.role() = 'service_role');

-- Public: allow contact signup (INSERT only, no reading)
DROP POLICY IF EXISTS "Public can subscribe" ON newsletter_contacts;
CREATE POLICY "Public can subscribe" ON newsletter_contacts
  FOR INSERT WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════
-- FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════

-- Updated_at trigger for newsletter tables
CREATE OR REPLACE FUNCTION update_nl_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS nl_contacts_updated_at ON newsletter_contacts;
CREATE TRIGGER nl_contacts_updated_at
  BEFORE UPDATE ON newsletter_contacts
  FOR EACH ROW EXECUTE FUNCTION update_nl_updated_at();

DROP TRIGGER IF EXISTS newsletters_updated_at ON newsletters;
CREATE TRIGGER newsletters_updated_at
  BEFORE UPDATE ON newsletters
  FOR EACH ROW EXECUTE FUNCTION update_nl_updated_at();

-- ═══════════════════════════════════════════════════════════════════
-- HELPFUL VIEWS
-- ═══════════════════════════════════════════════════════════════════

-- Newsletter send progress
CREATE OR REPLACE VIEW newsletter_progress AS
SELECT
  n.id AS newsletter_id,
  n.subject,
  n.status,
  n.total_recipients,
  n.sent_count,
  n.fail_count,
  COUNT(CASE WHEN ns.status = 'pending' THEN 1 END) AS pending_count,
  COUNT(CASE WHEN ns.status = 'sent' THEN 1 END) AS actually_sent,
  COUNT(CASE WHEN ns.status = 'failed' THEN 1 END) AS actually_failed,
  ROUND(COUNT(CASE WHEN ns.status = 'sent' THEN 1 END)::numeric / NULLIF(n.total_recipients, 0) * 100, 1) AS percent_complete
FROM newsletters n
LEFT JOIN newsletter_sends ns ON ns.newsletter_id = n.id
GROUP BY n.id, n.subject, n.status, n.total_recipients, n.sent_count, n.fail_count;

-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION SAFETY NET (no-ops on fresh installs, patches existing ones)
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE google_oauth_tokens ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS contact_source TEXT;
