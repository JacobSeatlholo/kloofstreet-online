/**
 * Merchant Workstation — store profile + stats.
 * GET /api/merchant/me  (Authorization: Bearer <supabase session token>)
 *
 * Returns the store (partners row matched by login_email) plus live
 * StreetPass stats for that store, and its rewards.
 */

import { createClient } from '@supabase/supabase-js';
import { requireMerchant, jsonError } from '../newsletter/_merchant.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

function dayStart(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString();
}

function weekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireMerchant(req);
  if (!auth.ok) return jsonError(res, auth);
  const partner = auth.merchant.partner;
  const pid = partner.id;

  try {
    // ── Scan stats ──
    const countScans = async (gte) => {
      let q = supabase.from('scans').select('id', { count: 'exact', head: true }).eq('partner_id', pid);
      if (gte) q = q.gte('created_at', gte);
      const { count } = await q;
      return count || 0;
    };

    const [totalScans, todayScans, weekScans, monthScans] = await Promise.all([
      countScans(null), countScans(dayStart(0)), countScans(weekStart()), countScans(dayStart(29))
    ]);

    // Unique members + points awarded (capped at most recent 5000 scans)
    let uniqueMembers = 0;
    let pointsAwarded = 0;
    {
      const { data } = await supabase
        .from('scans')
        .select('member_id, points_earned')
        .eq('partner_id', pid)
        .order('created_at', { ascending: false })
        .limit(5000);
      if (data) {
        uniqueMembers = new Set(data.map(s => s.member_id)).size;
        pointsAwarded = data.reduce((sum, s) => sum + (s.points_earned || 0), 0);
      }
    }

    // ── Redemptions for this store's rewards ──
    const { data: rewards } = await supabase
      .from('rewards')
      .select('id, name, description, points_required, max_per_month, active')
      .eq('partner_id', pid)
      .order('points_required', { ascending: true });

    const rewardIds = (rewards || []).map(r => r.id);
    let pendingCount = 0;
    let confirmedCount = 0;
    if (rewardIds.length) {
      const cnt = async (status) => {
        const { count } = await supabase
          .from('redemptions')
          .select('id', { count: 'exact', head: true })
          .in('reward_id', rewardIds)
          .eq('status', status);
        return count || 0;
      };
      [pendingCount, confirmedCount] = await Promise.all([cnt('pending'), cnt('confirmed')]);
    }

    // ── Recent check-ins (20) with member names ──
    const { data: recentScans } = await supabase
      .from('scans')
      .select('id, points_earned, is_first_visit, created_at, member:profiles(display_name)')
      .eq('partner_id', pid)
      .order('created_at', { ascending: false })
      .limit(20);

    return res.status(200).json({
      merchant: { email: auth.merchant.email },
      store: partner,
      stats: {
        total_scans: totalScans,
        scans_today: todayScans,
        scans_this_week: weekScans,
        scans_this_month: monthScans,
        unique_members: uniqueMembers,
        points_awarded: pointsAwarded,
        pending_redemptions: pendingCount,
        confirmed_redemptions: confirmedCount
      },
      rewards: rewards || [],
      recent_scans: (recentScans || []).map(s => ({
        id: s.id,
        points_earned: s.points_earned,
        is_first_visit: s.is_first_visit,
        created_at: s.created_at,
        member_name: (s.member && s.member.display_name) || 'Member'
      }))
    });
  } catch (err) {
    console.error('Merchant me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
