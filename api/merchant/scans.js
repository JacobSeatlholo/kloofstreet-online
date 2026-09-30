/**
 * Merchant Workstation — check-ins (scans) for THIS store only.
 *
 * GET  /api/merchant/scans?page=1&limit=50  → paged check-in list + totals
 * POST /api/merchant/scans                  → manual check-in: { member_ref }
 *   member_ref = the member's referral code (from their Street Pass page).
 *   Runs the exact same rules as a QR scan: active check, 4h cooldown,
 *   first-visit bonus, weekly 2x multiplier, points update.
 */

import { createClient } from '@supabase/supabase-js';
import { requireMerchant, jsonError } from '../newsletter/_merchant.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const BASE_POINTS = 10;
const FIRST_VISIT_BONUS = 40; // 50 total (10 base + 40 bonus)
const COOLDOWN_HOURS = 4;
const MULTIPLIER_PARTNER_THRESHOLD = 3; // 3 different partners in a week = 2x

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = await requireMerchant(req);
  if (!auth.ok) return jsonError(res, auth);
  const pid = auth.merchant.partner.id;

  if (req.method === 'GET') return listScans(req, res, pid);
  if (req.method === 'POST') return manualCheckIn(req, res, pid);
  return res.status(405).json({ error: 'Method not allowed' });
}

// ── GET: paged check-in list ─────────────────────────────────────────
async function listScans(req, res, pid) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);

    const { data, error } = await supabase
      .from('scans')
      .select('id, points_earned, is_first_visit, created_at, member:profiles(display_name, referral_code)')
      .eq('partner_id', pid)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (error) throw new Error(error.message);

    const { count: total } = await supabase
      .from('scans')
      .select('id', { count: 'exact', head: true })
      .eq('partner_id', pid);

    return res.status(200).json({
      total: total || 0,
      page,
      pages: Math.max(Math.ceil((total || 0) / limit), 1),
      scans: (data || []).map(s => ({
        id: s.id,
        points_earned: s.points_earned,
        is_first_visit: s.is_first_visit,
        created_at: s.created_at,
        member_name: (s.member && s.member.display_name) || 'Member',
        referral_code: (s.member && s.member.referral_code) || null
      }))
    });
  } catch (err) {
    console.error('Merchant scans GET error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST: manual check-in by referral code ───────────────────────────
async function manualCheckIn(req, res, pid) {
  try {
    const memberRef = String(req.body?.member_ref || '').trim();
    if (!memberRef) return res.status(400).json({ error: 'Enter the member\'s referral code' });

    // 1. Resolve the member by referral code
    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('id, display_name, status, points, total_scans, referral_code')
      .eq('referral_code', memberRef.toUpperCase())
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!profile) return res.status(404).json({ error: 'No member found with that referral code' });
    if (profile.status !== 'active') {
      return res.status(403).json({ error: 'Membership not active', status: profile.status });
    }

    // 2. Cooldown (4h, same as QR scan)
    const cooldownCutoff = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
    const { data: recentScan } = await supabase
      .from('scans')
      .select('created_at')
      .eq('member_id', profile.id)
      .eq('partner_id', pid)
      .gte('created_at', cooldownCutoff)
      .maybeSingle();
    if (recentScan) {
      const minsLeft = Math.ceil(
        (new Date(recentScan.created_at).getTime() + COOLDOWN_HOURS * 60 * 60 * 1000 - Date.now()) / 60000
      );
      return res.status(429).json({
        error: 'Cooldown active',
        message: `${profile.display_name || 'This member'} checked in here already. Next scan in ${minsLeft} minutes.`,
        retry_after_minutes: minsLeft
      });
    }

    // 3. First visit?
    const { count: prevVisits } = await supabase
      .from('scans')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', profile.id)
      .eq('partner_id', pid);
    const isFirstVisit = (prevVisits || 0) === 0;
    let pointsEarned = BASE_POINTS;
    if (isFirstVisit) pointsEarned += FIRST_VISIT_BONUS;

    // 4. Weekly multiplier
    const weekStart = getMonday(new Date()).toISOString().split('T')[0];
    const { data: weeklyPartners } = await supabase
      .from('weekly_activity')
      .select('partner_id')
      .eq('member_id', profile.id)
      .eq('week_start', weekStart);
    const uniquePartnersThisWeek = new Set((weeklyPartners || []).map(w => w.partner_id));
    uniquePartnersThisWeek.add(pid);
    const hasMultiplier = uniquePartnersThisWeek.size >= MULTIPLIER_PARTNER_THRESHOLD;
    if (hasMultiplier) pointsEarned *= 2;

    // 5. Insert the scan
    const { data: scan, error: scanErr } = await supabase
      .from('scans')
      .insert({ member_id: profile.id, partner_id: pid, points_earned: pointsEarned, is_first_visit: isFirstVisit })
      .select('id, created_at')
      .single();
    if (scanErr) throw new Error(scanErr.message);

    // 6. Weekly activity upsert
    await supabase
      .from('weekly_activity')
      .upsert(
        { member_id: profile.id, week_start: weekStart, partner_id: pid, scan_count: 1 },
        { onConflict: 'member_id,week_start,partner_id' }
      );

    // 7. Update member points
    const { error: upErr } = await supabase
      .from('profiles')
      .update({ points: profile.points + pointsEarned, total_scans: profile.total_scans + 1 })
      .eq('id', profile.id);
    if (upErr) throw new Error(upErr.message);

    return res.status(200).json({
      success: true,
      member_name: profile.display_name || 'Member',
      points_earned: pointsEarned,
      is_first_visit: isFirstVisit,
      has_multiplier: hasMultiplier,
      new_total_points: profile.points + pointsEarned,
      scan_id: scan.id
    });
  } catch (err) {
    console.error('Merchant manual check-in error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
