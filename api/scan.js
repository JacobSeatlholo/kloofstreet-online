import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BASE_POINTS = 10;
const FIRST_VISIT_BONUS = 40; // 50 total (10 base + 40 bonus)
const COOLDOWN_HOURS = 4;
const MULTIPLIER_PARTNER_THRESHOLD = 3; // 3 different partners in a week = 2x

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { member_id, partner_id } = req.body;

  if (!member_id || !partner_id) {
    return res.status(400).json({ error: 'member_id and partner_id required' });
  }

  try {
    // 1. Verify member is active
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id, status, points, total_scans')
      .eq('id', member_id)
      .single();

    if (profileErr || !profile) {
      return res.status(404).json({ error: 'Member not found' });
    }
    if (profile.status !== 'active') {
      return res.status(403).json({ error: 'Membership not active', status: profile.status });
    }

    // 2. Check cooldown (has this member scanned this partner in last COOLDOWN_HOURS?)
    const cooldownCutoff = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
    const { data: recentScan } = await supabase
      .from('scans')
      .select('id')
      .eq('member_id', member_id)
      .eq('partner_id', partner_id)
      .gte('created_at', cooldownCutoff)
      .maybeSingle();

    if (recentScan) {
      const minsLeft = Math.ceil(
        (new Date(recentScan.created_at).getTime() + COOLDOWN_HOURS * 60 * 60 * 1000 - Date.now()) / 60000
      );
      return res.status(429).json({
        error: 'Cooldown active',
        message: `Scan again in ${minsLeft} minutes`,
        retry_after_minutes: minsLeft
      });
    }

    // 3. Check if first visit to this partner
    const { count: prevVisitCount } = await supabase
      .from('scans')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', member_id)
      .eq('partner_id', partner_id);

    const isFirstVisit = prevVisitCount === 0;
    let pointsEarned = BASE_POINTS;
    if (isFirstVisit) pointsEarned += FIRST_VISIT_BONUS;

    // 4. Check weekly multiplier (3+ unique partners this week = 2x)
    const weekStart = getMonday(new Date()).toISOString().split('T')[0];
    const { data: weeklyPartners } = await supabase
      .from('weekly_activity')
      .select('partner_id')
      .eq('member_id', member_id)
      .eq('week_start', weekStart);

    const uniquePartnersThisWeek = new Set((weeklyPartners || []).map(w => w.partner_id));
    // Include current scan partner in the count
    uniquePartnersThisWeek.add(partner_id);
    const hasMultiplier = uniquePartnersThisWeek.size >= MULTIPLIER_PARTNER_THRESHOLD;
    if (hasMultiplier) pointsEarned *= 2;

    // 5. Insert the scan
    const { data: scan, error: scanErr } = await supabase
      .from('scans')
      .insert({
        member_id,
        partner_id,
        points_earned: pointsEarned,
        is_first_visit: isFirstVisit
      })
      .select()
      .single();

    if (scanErr) {
      throw scanErr;
    }

    // 6. Upsert weekly activity
    await supabase
      .from('weekly_activity')
      .upsert(
        { member_id, week_start, partner_id, scan_count: 1 },
        { onConflict: 'member_id,week_start,partner_id' }
      );

    // 7. Update profile points and total_scans
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({
        points: profile.points + pointsEarned,
        total_scans: profile.total_scans + 1
      })
      .eq('id', member_id);

    if (updateErr) throw updateErr;

    // 8. Return result
    return res.status(200).json({
      success: true,
      points_earned: pointsEarned,
      is_first_visit: isFirstVisit,
      has_multiplier: hasMultiplier,
      new_total_points: profile.points + pointsEarned,
      unique_partners_this_week: uniquePartnersThisWeek.size,
      scan_id: scan.id
    });

  } catch (err) {
    console.error('Scan error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
