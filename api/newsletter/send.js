/**
 * Newsletter drafts, history and batch sending via Gmail API.
 *
 * GET    /api/newsletter/send                → {newsletters[]} (history)
 * GET    /api/newsletter/send?id=            → {newsletter} (single, includes body_html)
 * POST   /api/newsletter/send                → create draft → {newsletter, total_contacts}
 * POST   /api/newsletter/send?step=publish   → {id} → create pending send rows, status=queued
 * POST   /api/newsletter/send?step=send-batch→ {id} → send next ≤200 (10 parallel) →
 *            {totalSent,totalFailed,stillPending,done,rateLimited?,retryAfter?}
 * PATCH  /api/newsletter/send?id=            → update draft
 * DELETE /api/newsletter/send?id=            → delete (cascades sends)
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL (optional)
 */

import { createClient } from '@supabase/supabase-js';
import { getValidAccessToken } from './google-auth.js';
import { requireMerchant, jsonError } from './_merchant.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const SITE_URL = (process.env.SITE_URL || 'https://www.kloofstreet.online').replace(/\/$/, '');
const BATCH_SIZE = 200;   // max emails per send-batch request
const PARALLEL = 10;      // concurrent Gmail API calls

// ── Recipient matching ───────────────────────────────────────────────
function matchQuery(source, tags) {
  let q = supabase.from('newsletter_contacts').select('id,email').eq('unsubscribed', false);
  if (source) q = q.eq('source', source);
  if (tags && tags.length) q = q.overlaps('tags', tags);
  return q;
}

async function countMatching(source, tags) {
  const { count, error } = await matchQuery(source, tags).select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count || 0;
}

// ── MIME / Gmail helpers ─────────────────────────────────────────────
function encodeHeaderWord(s) {
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  return '=?UTF-8?B?' + Buffer.from(String(s), 'utf8').toString('base64') + '?=';
}

function buildRawMessage(nl, toEmail) {
  const unsubUrl = `${SITE_URL}/api/newsletter/unsubscribe?e=${encodeURIComponent(toEmail)}`;
  const footer =
    `<div style="margin-top:28px;padding-top:16px;border-top:1px solid #2a2a2e;text-align:center;">` +
    `<p style="color:#8a8a86;font-size:12px;margin:0 0 8px;">You are receiving this because you subscribed at KloofStreet.online</p>` +
    `<a href="${unsubUrl}" style="color:#d4af6a;font-size:12px;">Unsubscribe</a></div>`;
  const html = String(nl.body_html || '').replace(/<\/body>\s*<\/html>\s*$/i, '') + footer;

  const fromLine = nl.from_name
    ? `${encodeHeaderWord(nl.from_name)} <${nl.from_email}>`
    : nl.from_email;
  const lines = [
    `From: ${fromLine}`,
    `To: ${toEmail}`,
    `Subject: ${encodeHeaderWord(nl.subject || '')}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    `List-Unsubscribe: <${unsubUrl}>`,
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
  ];
  if (nl.reply_to) lines.push(`Reply-To: ${nl.reply_to}`);
  return lines.join('\r\n') + '\r\n\r\n' + html;
}

async function gmailSend(token, raw) {
  const res = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'message/rfc822' },
    body: raw
  });
  if (res.status === 429) return { rateLimited: true, retryAfter: parseInt(res.headers.get('retry-after'), 10) || 2 };
  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: true, messageId: data.id || null };
  }
  const detail = await res.text().catch(() => '');
  return { ok: false, status: res.status, err: detail.slice(0, 300) };
}

// ── Batch sending ────────────────────────────────────────────────────
async function sendBatch(req, res, merchantEmail) {
  const id = req.body?.id;
  if (!id) return res.status(400).json({ error: 'Newsletter id required' });

  const { data: nl, error: nlErr } = await supabase.from('newsletters').select('*').eq('id', id).single();
  if (nlErr || !nl) return res.status(404).json({ error: 'Newsletter not found' });
  if (nl.status === 'draft') return res.status(400).json({ error: 'Newsletter is still a draft — publish it first' });
  if (nl.status === 'sent') {
    return res.status(200).json({ totalSent: nl.sent_count, totalFailed: nl.fail_count, stillPending: 0, done: true });
  }

  // Next pending recipients
  const { data: pending, error: pErr } = await supabase
    .from('newsletter_sends')
    .select('id, contact:newsletter_contacts(email)')
    .eq('newsletter_id', id)
    .eq('status', 'pending')
    .limit(BATCH_SIZE);
  if (pErr) throw new Error(pErr.message);

  let token;
  try {
    token = await getValidAccessToken(merchantEmail);
  } catch (e) {
    return res.status(200).json({ error: String(e.message || e) });
  }

  let rateLimited = false, retryAfter = 2;

  for (let i = 0; i < pending.length && !rateLimited; i += PARALLEL) {
    const slice = pending.slice(i, i + PARALLEL);
    const results = await Promise.all(slice.map(async row => {
      const email = row.contact && row.contact.email;
      if (!email) return { row, res: { ok: false, err: 'Contact deleted' } };
      try {
        const raw = buildRawMessage(nl, email);
        return { row, res: await gmailSend(token, raw) };
      } catch (e) {
        return { row, res: { ok: false, err: String(e.message || e).slice(0, 300) } };
      }
    }));

    for (const { row, res: r } of results) {
      if (r.rateLimited) { rateLimited = true; retryAfter = r.retryAfter || 2; continue; }
      if (r.ok) {
        await supabase.from('newsletter_sends').update({
          status: 'sent', gmail_message_id: r.messageId, sent_at: new Date().toISOString(), error_message: null
        }).eq('id', row.id);
      } else {
        await supabase.from('newsletter_sends').update({
          status: 'failed', error_message: r.err || 'Unknown error'
        }).eq('id', row.id);
      }
    }
  }

  // Recompute true counters from the send rows (O(1) via newsletter_progress view equivalent)
  const { count: sentN } = await supabase.from('newsletter_sends').select('id', { count: 'exact', head: true }).eq('newsletter_id', id).eq('status', 'sent');
  const { count: failN } = await supabase.from('newsletter_sends').select('id', { count: 'exact', head: true }).eq('newsletter_id', id).eq('status', 'failed');
  const { count: pendN } = await supabase.from('newsletter_sends').select('id', { count: 'exact', head: true }).eq('newsletter_id', id).eq('status', 'pending');

  const patch = { sent_count: sentN || 0, fail_count: failN || 0 };
  const done = !rateLimited && (pendN || 0) === 0;
  if (done) { patch.status = 'sent'; patch.sent_at = new Date().toISOString(); }
  await supabase.from('newsletters').update(patch).eq('id', id);

  if (rateLimited) {
    return res.status(200).json({
      rateLimited: true, retryAfter,
      totalSent: sentN || 0, totalFailed: failN || 0, stillPending: pendN || 0,
      done: false
    });
  }
  return res.status(200).json({
    totalSent: sentN || 0, totalFailed: failN || 0, stillPending: pendN || 0, done
  });
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
    // ── GET: history list or single ──
    if (req.method === 'GET') {
      if (req.query.id) {
        const { data, error } = await supabase.from('newsletters').select('*').eq('id', req.query.id).single();
        if (error || !data) return res.status(404).json({ error: 'Newsletter not found' });
        return res.status(200).json({ newsletter: data });
      }
      const { data, error } = await supabase
        .from('newsletters')
        .select('id,subject,status,total_recipients,sent_count,fail_count,created_at,sent_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return res.status(200).json({ newsletters: data || [] });
    }

    // ── POST: create draft / publish / send-batch ──
    if (req.method === 'POST') {
      if (req.query.step === 'publish') {
        const id = req.body?.id;
        if (!id) return res.status(400).json({ error: 'Newsletter id required' });
        const { data: nl, error: nlErr } = await supabase.from('newsletters').select('*').eq('id', id).single();
        if (nlErr || !nl) return res.status(404).json({ error: 'Newsletter not found' });
        if (nl.status === 'sent') return res.status(400).json({ error: 'Newsletter was already sent' });

        const { data: recipients, error: rErr } = await matchQuery(nl.contact_source, nl.tags);
        if (rErr) throw new Error(rErr.message);
        if (!recipients || recipients.length === 0) {
          return res.status(400).json({ error: 'No active subscribers match the selected filters' });
        }

        // Create pending send rows (resume-safe: skip existing pairs)
        for (let i = 0; i < recipients.length; i += 900) {
          const chunk = recipients.slice(i, i + 900).map(c => ({ newsletter_id: id, contact_id: c.id, status: 'pending' }));
          const { error } = await supabase
            .from('newsletter_sends')
            .upsert(chunk, { onConflict: 'newsletter_id,contact_id', ignoreDuplicates: true });
          if (error) throw new Error('Failed to queue recipients: ' + error.message);
        }
        const { error: uErr } = await supabase.from('newsletters')
          .update({ status: 'queued', total_recipients: recipients.length })
          .eq('id', id);
        if (uErr) throw new Error(uErr.message);
        return res.status(200).json({ success: true, total_recipients: recipients.length });
      }

      if (req.query.step === 'send-batch') {
        return await sendBatch(req, res, merchantEmail);
      }

      // Create draft
      const b = req.body || {};
      if (!b.subject || !String(b.subject).trim()) return res.status(400).json({ error: 'Subject is required' });
      if (!b.body_html || !String(b.body_html).trim()) return res.status(400).json({ error: 'Newsletter content is required' });
      const source = typeof b.contact_source === 'string' && b.contact_source.trim() ? b.contact_source.trim() : null;
      const tags = Array.isArray(b.contact_tags) ? b.contact_tags.map(t => String(t).trim()).filter(Boolean) : [];
      const total = await countMatching(source, tags);

      const { data: nl, error: insErr } = await supabase
        .from('newsletters')
        .insert({
          subject: String(b.subject).trim(),
          body_html: b.body_html,
          body_text: b.body_text || null,
          from_name: b.from_name || 'KloofStreet.online',
          from_email: b.from_email || 'hello@kloofstreet.online',
          reply_to: b.reply_to || null,
          contact_source: source,
          tags,
          total_recipients: total,
          status: 'draft'
        })
        .select()
        .single();
      if (insErr) throw new Error(insErr.message);
      return res.status(200).json({ newsletter: nl, total_contacts: total });
    }

    // ── PATCH: update draft ──
    if (req.method === 'PATCH') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      const { data: nl, error: nlErr } = await supabase.from('newsletters').select('status').eq('id', id).single();
      if (nlErr || !nl) return res.status(404).json({ error: 'Newsletter not found' });
      if (nl.status !== 'draft') return res.status(400).json({ error: 'Only drafts can be edited' });

      const b = req.body || {};
      const patch = {};
      if (typeof b.subject === 'string') patch.subject = b.subject.trim();
      if (typeof b.body_html === 'string') patch.body_html = b.body_html;
      if (typeof b.body_text === 'string') patch.body_text = b.body_text;
      if (typeof b.from_name === 'string') patch.from_name = b.from_name;
      if (typeof b.from_email === 'string') patch.from_email = b.from_email;
      if (typeof b.reply_to === 'string') patch.reply_to = b.reply_to || null;
      if (typeof b.contact_source === 'string') patch.contact_source = b.contact_source.trim() || null;
      if (Array.isArray(b.contact_tags)) patch.tags = b.contact_tags.map(t => String(t).trim()).filter(Boolean);
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update' });
      patch.total_recipients = await countMatching(patch.contact_source, patch.tags);

      const { data, error } = await supabase.from('newsletters').update(patch).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return res.status(200).json({ newsletter: data });
    }

    // ── DELETE ──
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      const { error } = await supabase.from('newsletters').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
