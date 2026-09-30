/**
 * Google OAuth2 for the KloofStreet newsletter system — PER-MERCHANT.
 * Each registered store connects its own Gmail account.
 *
 * GET    /api/newsletter/google-auth                  → start OAuth (returns {authUrl})
 * GET    /api/newsletter/google-auth?step=status      → {connected, email}
 * GET    /api/newsletter/google-auth?step=callback    → OAuth redirect target (browser popup)
 * POST   /api/newsletter/google-auth?step=refresh     → force token refresh
 * DELETE /api/newsletter/google-auth                  → disconnect (wipes this merchant's tokens)
 *
 * All endpoints (except the Google callback) require a merchant session
 * (Supabase Bearer token + partners.login_email match).
 *
 * Env vars:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI (optional —
 *   derived from request origin if unset)
 *
 * Exports getValidAccessToken(merchantEmail) used by send.js and contacts.js.
 */

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { requireMerchant, jsonError } from './_merchant.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const OAUTH_SCOPE = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

// In-memory token cache per merchant (5 min TTL) — survives warm lambdas
const tokenCache = new Map(); // merchantEmail -> { token, expiresAt }
const CACHE_TTL_MS = 5 * 60 * 1000;

function getClientId() { return process.env.GOOGLE_CLIENT_ID; }
function getClientSecret() { return process.env.GOOGLE_CLIENT_SECRET; }

function getRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const host = req?.headers?.host || 'www.kloofstreet.online';
  const proto = req?.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}/api/newsletter/google-auth?step=callback`;
}

// ── Signed state (proves the callback belongs to a merchant) ─────────
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function signState(merchantEmail) {
  const payload = b64url(merchantEmail);
  const sig = b64url(crypto.createHmac('sha256', getClientSecret() || 'dev').update(payload).digest());
  return `${payload}.${sig}`;
}
function readState(state) {
  try {
    const [payload, sig] = String(state).split('.');
    const expect = b64url(crypto.createHmac('sha256', getClientSecret() || 'dev').update(payload).digest());
    if (sig !== expect) return null;
    return Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch (e) { return null; }
}

// ── Token storage helpers (scoped to one merchant) ───────────────────
async function getTokenRow(merchantEmail) {
  const { data, error } = await supabase
    .from('google_oauth_tokens')
    .select('*')
    .eq('merchant_email', merchantEmail)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error('Token store unavailable: ' + error.message);
  return data && data[0] ? data[0] : null;
}

async function wipeTokenRows(merchantEmail) {
  await supabase.from('google_oauth_tokens').delete().eq('merchant_email', merchantEmail);
}

// ── Core: get a working access token (used by other routes) ──────────
export async function getValidAccessToken(merchantEmail) {
  const cached = tokenCache.get(merchantEmail);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const row = await getTokenRow(merchantEmail);
  if (!row) {
    throw new Error('Google account not connected. Connect Gmail in the Newsletter tab first.');
  }

  const expiryMs = row.expiry_date ? new Date(row.expiry_date).getTime() : 0;
  if (row.access_token && Date.now() < expiryMs - 60000) {
    tokenCache.set(merchantEmail, { token: row.access_token, expiresAt: expiryMs });
    return row.access_token;
  }

  // Access token expired (or close) → refresh it
  if (!getClientId() || !getClientSecret()) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured in Vercel env vars.');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    tokenCache.delete(merchantEmail);
    throw new Error('Google token refresh failed (' + res.status + '). Reconnect Gmail in the Newsletter tab. ' + detail.slice(0, 200));
  }
  const tok = await res.json();
  const expiresAt = Date.now() + (tok.expires_in || 3600) * 1000;
  await supabase
    .from('google_oauth_tokens')
    .update({ access_token: tok.access_token, expiry_date: new Date(expiresAt).toISOString() })
    .eq('id', row.id);
  tokenCache.set(merchantEmail, { token: tok.access_token, expiresAt });
  return tok.access_token;
}

// ── HTML responses for the popup window ──────────────────────────────
function popupHtml(title, body, notifyParent) {
  const notify = notifyParent
    ? `<script>try{window.opener&&window.opener.postMessage({type:'google-auth-success'},'*');}catch(e){}setTimeout(function(){window.close();},600);</script>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#0a0a0b;color:#e8e8e6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box}
.card{max-width:420px;text-align:center;background:#151517;border:1px solid #2a2a2e;border-radius:14px;padding:32px}
h1{font-size:18px;margin:0 0 12px}p{color:#a8a8a4;font-size:14px;line-height:1.5;margin:0}
.ok{color:#d4af6a;font-size:40px;margin-bottom:12px}</style></head>
<body><div class="card">${body}${notify}</div></body></html>`;
}

// ── Handler ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const step = req.query.step;

  // ── OAuth callback from Google (popup, no headers — state proves origin) ──
  if (step === 'callback') {
    const code = req.query.code;
    const err = req.query.error;
    if (err) {
      return res.status(200).setHeader('Content-Type', 'text/html').send(
        popupHtml('Google connection failed', `<h1>Connection failed</h1><p>${String(err)}</p>`, false)
      );
    }
    if (!code) {
      return res.status(400).setHeader('Content-Type', 'text/html').send(
        popupHtml('Google connection failed', '<h1>Missing code</h1><p>No authorization code was returned.</p>', false)
      );
    }
    const merchantEmail = readState(req.query.state);
    if (!merchantEmail) {
      return res.status(400).setHeader('Content-Type', 'text/html').send(
        popupHtml('Google connection failed', '<h1>Invalid session</h1><p>The connection request could not be matched to a store. Start again from the workstation.</p>', false)
      );
    }
    // The merchant must still exist in partners
    const { data: partnerRow } = await supabase
      .from('partners')
      .select('id, name')
      .eq('login_email', merchantEmail)
      .maybeSingle();
    if (!partnerRow) {
      return res.status(403).setHeader('Content-Type', 'text/html').send(
        popupHtml('Google connection failed', '<h1>Store not found</h1><p>This account is no longer a registered store.</p>', false)
      );
    }
    try {
      if (!getClientId() || !getClientSecret()) throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set in Vercel env vars');
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: getClientId(),
          client_secret: getClientSecret(),
          redirect_uri: getRedirectUri(req),
          grant_type: 'authorization_code'
        })
      });
      if (!tokenRes.ok) throw new Error('Token exchange failed: ' + (await tokenRes.text()).slice(0, 300));
      const tok = await tokenRes.json();
      if (!tok.refresh_token) throw new Error('No refresh token returned — reconnect and make sure to choose your Google account.');

      // Look up the connected Gmail address (for display)
      let gmail = null;
      try {
        const ui = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tok.access_token}` }
        });
        if (ui.ok) gmail = (await ui.json()).email || null;
      } catch (e) { /* non-fatal */ }

      const expiresAt = new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString();
      await wipeTokenRows(merchantEmail); // keep exactly one connection per store
      await supabase.from('google_oauth_tokens').insert({
        merchant_email: merchantEmail,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        token_type: tok.token_type || 'Bearer',
        scope: tok.scope || OAUTH_SCOPE,
        expiry_date: expiresAt,
        email: gmail
      });
      tokenCache.set(merchantEmail, { token: tok.access_token, expiresAt: Date.now() + (tok.expires_in || 3600) * 1000 });

      return res.status(200).setHeader('Content-Type', 'text/html').send(
        popupHtml('Google connected', `<div class="ok">&#10003;</div><h1>Gmail connected${gmail ? ': ' + gmail : ''}</h1><p>You can close this window.</p>`, true)
      );
    } catch (e) {
      return res.status(500).setHeader('Content-Type', 'text/html').send(
        popupHtml('Google connection failed', `<h1>Connection failed</h1><p>${String(e.message || e).slice(0, 300)}</p>`, false)
      );
    }
  }

  // ── Everything below requires a logged-in merchant ──
  const auth = await requireMerchant(req);
  if (!auth.ok) return jsonError(res, auth);
  const merchantEmail = auth.merchant.email;

  // ── Status check ──
  if (step === 'status' && req.method === 'GET') {
    try {
      const row = await getTokenRow(merchantEmail);
      if (!row) return res.status(200).json({ connected: false });
      return res.status(200).json({ connected: true, email: row.email || undefined, connectedAt: row.created_at });
    } catch (e) {
      return res.status(200).json({ connected: false, error: String(e.message || e) });
    }
  }

  // ── Start OAuth ──
  if (req.method === 'GET' && !step) {
    if (!getClientId() || !getClientSecret()) {
      return res.status(200).json({
        setup: true,
        message: 'Google OAuth is not configured yet.',
        needed: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI (optional)'],
        howto: 'Google Cloud Console → APIs & Services → Credentials → OAuth client (Web app). Authorised redirect URI: https://www.kloofstreet.online/api/newsletter/google-auth?step=callback. Enable Gmail API + Google Sheets API.'
      });
    }
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: getClientId(),
      redirect_uri: getRedirectUri(req),
      response_type: 'code',
      scope: OAUTH_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: signState(merchantEmail)
    });
    return res.status(200).json({ authUrl });
  }

  // ── Manual refresh ──
  if (step === 'refresh' && req.method === 'POST') {
    try {
      tokenCache.delete(merchantEmail);
      await getValidAccessToken(merchantEmail);
      const row = await getTokenRow(merchantEmail);
      return res.status(200).json({ success: true, expiry_date: row ? row.expiry_date : null });
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    }
  }

  // ── Disconnect ──
  if (req.method === 'DELETE') {
    try {
      await wipeTokenRows(merchantEmail);
      tokenCache.delete(merchantEmail);
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
