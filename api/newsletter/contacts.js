/**
 * Newsletter contact management.
 *
 * GET    /api/newsletter/contacts?page&limit&search&source&tags&active_only → {total,page,pages,contacts[]}
 * POST   /api/newsletter/contacts                    → add/upsert single contact {email,name,tags,source}
 * POST   /api/newsletter/contacts?import=bulk        → {contacts:[{email,name,tags}]} → {imported}
 * POST   /api/newsletter/contacts?import=sheets      → {spreadsheetId,range} → {imported}  (Google Sheets API)
 * PATCH  /api/newsletter/contacts?id=                → edit {name,tags,unsubscribed}
 * DELETE /api/newsletter/contacts?id=  or ?source=   → {success}
 */

import { createClient } from '@supabase/supabase-js';
import { getValidAccessToken } from './google-auth.js';
import { requireMerchant, jsonError } from './_merchant.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BULK_CHUNK = 500;

function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map(t => String(t).trim()).filter(Boolean).slice(0, 20);
}

function validContact(c) {
  return c && typeof c.email === 'string' && EMAIL_RE.test(c.email.trim());
}

async function upsertContacts(rows) {
  // rows: validated [{email,name,tags,source}] — merge on unique email
  let imported = 0;
  for (let i = 0; i < rows.length; i += BULK_CHUNK) {
    const chunk = rows.slice(i, i + BULK_CHUNK).map(c => ({
      email: c.email.trim().toLowerCase(),
      name: c.name || null,
      tags: cleanTags(c.tags),
      source: c.source || 'manual',
      unsubscribed: false
    }));
    const { error } = await supabase
      .from('newsletter_contacts')
      .upsert(chunk, { onConflict: 'email', ignoreDuplicates: false });
    if (error) throw new Error('Contact upsert failed: ' + error.message);
    imported += chunk.length;
  }
  return imported;
}

// ── Google Sheets import ─────────────────────────────────────────────
async function importFromSheets(req, res, merchantEmail) {
  const { spreadsheetId, range } = req.body || {};
  if (!spreadsheetId) return res.status(400).json({ error: 'Spreadsheet ID required' });

  let token;
  try {
    token = await getValidAccessToken(merchantEmail);
  } catch (e) {
    return res.status(401).json({ error: String(e.message || e) });
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range || 'A:Z')}`;
  const sRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!sRes.ok) {
    const detail = await sRes.text().catch(() => '');
    return res.status(400).json({ error: `Sheets API error (${sRes.status}). Check the spreadsheet ID, range and that it is shared with the connected Google account. ${detail.slice(0, 200)}` });
  }
  const payload = await sRes.json();
  const rows = payload.values || [];
  if (rows.length === 0) return res.status(400).json({ error: 'The selected range is empty' });

  // Auto-detect columns
  let headerRow = null, emailIdx = -1, nameIdx = -1, tagIdx = -1;
  const first = rows[0].map(c => String(c || '').toLowerCase());
  if (first.some(c => /e-?mail/.test(c))) {
    headerRow = first;
    emailIdx = headerRow.findIndex(c => /e-?mail/.test(c));
    nameIdx = headerRow.findIndex(c => /\bname\b/.test(c));
    tagIdx = headerRow.findIndex(c => /\btag/.test(c));
    rows.shift();
  } else {
    // Fall back: pick the column with the most '@' signs as the email column
    const width = Math.max(...rows.map(r => r.length));
    let best = -1, bestCount = 0;
    for (let col = 0; col < width; col++) {
      const count = rows.reduce((n, r) => n + (String(r[col] || '').includes('@') ? 1 : 0), 0);
      if (count > bestCount) { bestCount = count; best = col; }
    }
    emailIdx = best;
    if (width >= 2) nameIdx = emailIdx === 0 ? 1 : 0; // best-effort guess
  }
  if (emailIdx < 0) return res.status(400).json({ error: 'Could not find an email column in the sheet' });

  const contacts = [];
  const seen = new Set();
  for (const row of rows) {
    const email = String(row[emailIdx] || '').trim();
    if (!EMAIL_RE.test(email) || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    const tags = tagIdx >= 0 ? String(row[tagIdx] || '').split(/[,;]/).map(t => t.trim()).filter(Boolean) : [];
    contacts.push({ email, name: nameIdx >= 0 ? String(row[nameIdx] || '').trim() : null, tags, source: 'google-sheets' });
  }
  if (contacts.length === 0) return res.status(400).json({ error: 'No valid email addresses found in the sheet' });

  const imported = await upsertContacts(contacts);
  return res.status(200).json({ imported });
}

// ── Handler ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = await requireMerchant(req);
  if (!auth.ok) return jsonError(res, auth);
  const merchantEmail = auth.merchant.email;

  try {
    // ── GET: list / search / paginate / count ──
    if (req.method === 'GET') {
      const q = req.query;
      const page = Math.max(parseInt(q.page, 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
      const search = typeof q.search === 'string' ? q.search.replace(/[,()%]/g, '').trim() : '';
      const source = typeof q.source === 'string' ? q.source.trim() : '';
      const tags = typeof q.tags === 'string' && q.tags.trim() ? q.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
      const activeOnly = q.active_only === 'true' || q.active_only === '1';

      let base = supabase.from('newsletter_contacts').select('*', { count: 'exact', head: true });
      if (search) base = base.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
      if (source) base = base.eq('source', source);
      if (tags.length) base = base.overlaps('tags', tags);
      if (activeOnly) base = base.eq('unsubscribed', false);
      const { count, error: countErr } = await base;
      if (countErr) throw new Error(countErr.message);

      let list = supabase
        .from('newsletter_contacts')
        .select('id,email,name,source,tags,unsubscribed,created_at')
        .order('created_at', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);
      if (search) list = list.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
      if (source) list = list.eq('source', source);
      if (tags.length) list = list.overlaps('tags', tags);
      if (activeOnly) list = list.eq('unsubscribed', false);
      const { data, error: listErr } = await list;
      if (listErr) throw new Error(listErr.message);

      return res.status(200).json({
        total: count || 0,
        page,
        pages: Math.max(Math.ceil((count || 0) / limit), 1),
        contacts: data || []
      });
    }

    // ── POST: single add, bulk import, sheets import ──
    if (req.method === 'POST') {
      const body = req.body || {};

      if (req.query.import === 'bulk') {
        const incoming = Array.isArray(body.contacts) ? body.contacts : [];
        const valid = incoming.filter(validContact).map(c => ({ ...c, email: c.email.trim().toLowerCase(), source: c.source || 'manual' }));
        if (valid.length === 0) return res.status(400).json({ error: 'No valid email addresses found' });
        const imported = await upsertContacts(valid);
        return res.status(200).json({ imported, skipped: incoming.length - valid.length });
      }

      if (req.query.import === 'sheets') {
        return await importFromSheets(req, res, merchantEmail);
      }

      // Single contact add (manual add + footer website signup)
      if (!validContact(body)) return res.status(400).json({ error: 'A valid email address is required' });
      const row = {
        email: body.email.trim().toLowerCase(),
        name: body.name || null,
        tags: cleanTags(body.tags),
        source: body.source || 'manual',
        unsubscribed: false
      };
      const { data, error } = await supabase
        .from('newsletter_contacts')
        .upsert(row, { onConflict: 'email', ignoreDuplicates: false })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return res.status(200).json({ contact: data });
    }

    // ── PATCH: edit contact ──
    if (req.method === 'PATCH') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      const patch = {};
      if (typeof req.body?.name === 'string') patch.name = req.body.name.trim() || null;
      if (Array.isArray(req.body?.tags)) patch.tags = cleanTags(req.body.tags);
      if (typeof req.body?.unsubscribed === 'boolean') patch.unsubscribed = req.body.unsubscribed;
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update' });
      const { data, error } = await supabase
        .from('newsletter_contacts')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) return res.status(404).json({ error: 'Contact not found' });
      return res.status(200).json({ contact: data });
    }

    // ── DELETE: by id or by source ──
    if (req.method === 'DELETE') {
      const { id, source } = req.query;
      if (id) {
        const { error } = await supabase.from('newsletter_contacts').delete().eq('id', id);
        if (error) throw new Error(error.message);
        return res.status(200).json({ success: true });
      }
      if (source) {
        const { error } = await supabase.from('newsletter_contacts').delete().eq('source', source);
        if (error) throw new Error(error.message);
        return res.status(200).json({ success: true });
      }
      return res.status(400).json({ error: 'id or source required' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
