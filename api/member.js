import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET /api/member?id=UUID  (admin: get any member)
// GET /api/member          (self: get own profile from authorization header)
// PATCH /api/member        (update own profile)

export default async function handler(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (req.method === 'GET') {
    return handleGet(req, res, token);
  } else if (req.method === 'PATCH') {
    return handlePatch(req, res, token);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handleGet(req, res, token) {
  try {
    // If specific ID passed (admin use), look up by ID
    const { id } = req.query;

    let memberId;
    if (id) {
      memberId = id;
    } else if (token) {
      // Verify JWT and get user
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      memberId = user.id;
    } else {
      return res.status(401).json({ error: 'Authorization required' });
    }

    // Get profile with recent scans and active redemptions
    const { data: profile, error } = await supabase
      .from('profiles')
      .select(`
        id, display_name, phone, status, points, total_scans, month_streak,
        referral_code, wallet_serial, invoice_url, paid_at, created_at,
        scans:scans(
          id, points_earned, is_first_visit, created_at,
          partner:partners(name, short_name)
        )
      `)
      .eq('id', memberId)
      .single();

    if (error || !profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Get active redemptions
    const { data: redemptions } = await supabase
      .from('redemptions')
      .select(`
        id, code, status, expires_at, points_used, created_at,
        reward:rewards(name, description, partner_id)
      `)
      .eq('member_id', memberId)
      .in('status', ['pending', 'confirmed'])
      .order('created_at', { ascending: false });

    // Get unique partners visited
    const { data: uniquePartners } = await supabase
      .from('scans')
      .select('partner_id')
      .eq('member_id', memberId);

    const visitedPartnerIds = [...new Set((uniquePartners || []).map(s => s.partner_id))];

    // Get this week's activity for multiplier status
    const weekStart = getMonday(new Date()).toISOString().split('T')[0];
    const { data: weeklyActivity } = await supabase
      .from('weekly_activity')
      .select('partner_id')
      .eq('member_id', memberId)
      .eq('week_start', weekStart);

    const partnersThisWeek = new Set((weeklyActivity || []).map(w => w.partner_id));

    return res.status(200).json({
      profile,
      active_redemptions: redemptions || [],
      stats: {
        unique_partners_visited: visitedPartnerIds.length,
        partners_this_week: partnersThisWeek.size,
        week_multiplier_active: partnersThisWeek.size >= 3
      }
    });

  } catch (err) {
    console.error('Member GET error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handlePatch(req, res, token) {
  if (!token) {
    return res.status(401).json({ error: 'Authorization required' });
  }

  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { display_name, phone } = req.body;
    const updates = {};
    if (display_name !== undefined) updates.display_name = display_name;
    if (phone !== undefined) updates.phone = phone;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select('id, display_name, phone, updated_at')
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, profile: data });

  } catch (err) {
    console.error('Member PATCH error:', err);
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
