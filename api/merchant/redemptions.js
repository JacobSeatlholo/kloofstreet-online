/**
 * Merchant Workstation — reward redemptions for THIS store only.
 *
 * GET  /api/merchant/redemptions?status=all|pending|confirmed  → list (latest 100)
 * POST /api/merchant/redemptions   { code }                    → confirm a pending code
 *
 * A member redeems on their phone (creates a code with status "pending"),
 * then shows the code in-store. The store confirms it here.
 */

import { createClient } from '@supabase/supabase-js';
import { requireMerchant, jsonError } from '../newsletter/_merchant.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

async function partnerRewardIds(pid) {
  const { data, error } = await supabase.from('rewards').select('id').eq('partner_id', pid);
  if (error) throw new Error(error.message);
  return (data || []).map(r => r.id);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = await requireMerchant(req);
  if (!auth.ok) return jsonError(res, auth);
  const pid = auth.merchant.partner.id;

  if (req.method === 'GET') return listRedemptions(req, res, pid);
  if (req.method === 'POST') return confirmRedemption(req, res, pid);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function listRedemptions(req, res, pid) {
  try {
    const status = String(req.query.status || 'all');
    const ids = await partnerRewardIds(pid);
    if (!ids.length) return res.status(200).json({ redemptions: [] });

    let q = supabase
      .from('redemptions')
      .select('id, code, status, points_used, created_at, confirmed_at, expires_at, member:profiles(display_name), reward:rewards(name)')
      .in('reward_id', ids)
      .order('created_at', { ascending: false })
      .limit(100);
    if (status === 'pending' || status === 'confirmed') q = q.eq('status', status);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    return res.status(200).json({
      redemptions: (data || []).map(r => ({
        id: r.id,
        code: r.code,
        status: r.status,
        points_used: r.points_used,
        created_at: r.created_at,
        confirmed_at: r.confirmed_at || null,
        expires_at: r.expires_at,
        member_name: (r.member && r.member.display_name) || 'Member',
        reward_name: (r.reward && r.reward.name) || 'Reward'
      }))
    });
  } catch (err) {
    console.error('Merchant redemptions GET error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function confirmRedemption(req, res, pid) {
  try {
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Enter a redemption code' });

    const { data: redemption, error: rErr } = await supabase
      .from('redemptions')
      .select('id, code, status, points_used, created_at, expires_at, reward:rewards(id, name, partner_id), member:profiles(display_name)')
      .eq('code', code)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!redemption || !redemption.reward || redemption.reward.partner_id !== pid) {
      // Same message for wrong store and wrong code — never leak codes
      return res.status(404).json({ error: 'Code not found for your store. Check the code and try again.' });
    }
    if (redemption.status === 'confirmed') {
      return res.status(400).json({ error: 'This code was already confirmed', confirmed_at: redemption.confirmed_at });
    }
    if (redemption.status !== 'pending') {
      return res.status(400).json({ error: 'This code is ' + redemption.status + ' and cannot be confirmed' });
    }
    if (redemption.expires_at && new Date(redemption.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'This code has expired. Ask the member to redeem again.' });
    }

    const now = new Date().toISOString();
    const { error: upErr } = await supabase
      .from('redemptions')
      .update({ status: 'confirmed', confirmed_at: now })
      .eq('id', redemption.id);
    if (upErr) throw new Error(upErr.message);

    return res.status(200).json({
      success: true,
      confirmed_at: now,
      member_name: (redemption.member && redemption.member.display_name) || 'Member',
      reward_name: (redemption.reward && redemption.reward.name) || 'Reward',
      points_used: redemption.points_used
    });
  } catch (err) {
    console.error('Merchant redemption confirm error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
