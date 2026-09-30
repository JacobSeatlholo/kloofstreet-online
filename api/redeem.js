import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { member_id, reward_id } = req.body;

  if (!member_id || !reward_id) {
    return res.status(400).json({ error: 'member_id and reward_id required' });
  }

  try {
    // 1. Get member profile
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id, status, points, display_name')
      .eq('id', member_id)
      .single();

    if (profileErr || !profile) {
      return res.status(404).json({ error: 'Member not found' });
    }
    if (profile.status !== 'active') {
      return res.status(403).json({ error: 'Membership not active' });
    }

    // 2. Get reward details
    const { data: reward, error: rewardErr } = await supabase
      .from('rewards')
      .select('id, name, description, points_required, partner_id, max_per_month')
      .eq('id', reward_id)
      .eq('active', true)
      .single();

    if (rewardErr || !reward) {
      return res.status(404).json({ error: 'Reward not found or inactive' });
    }

    // 3. Check points balance
    if (profile.points < reward.points_required) {
      return res.status(400).json({
        error: 'Insufficient points',
        current_points: profile.points,
        required_points: reward.points_required,
        shortfall: reward.points_required - profile.points
      });
    }

    // 4. Check monthly cap
    if (reward.max_per_month > 0) {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const { count } = await supabase
        .from('redemptions')
        .select('id', { count: 'exact', head: true })
        .eq('member_id', member_id)
        .eq('reward_id', reward_id)
        .gte('created_at', monthStart.toISOString())
        .in('status', ['pending', 'confirmed']);

      if (count >= reward.max_per_month) {
        return res.status(400).json({
          error: 'Monthly limit reached',
          message: `You can redeem this reward ${reward.max_per_month} time(s) per month. Try again next month.`,
          max_per_month: reward.max_per_month,
          used_this_month: count
        });
      }
    }

    // 5. Create redemption in a transaction-like flow
    // Deduct points
    const { error: deductErr } = await supabase
      .from('profiles')
      .update({ points: profile.points - reward.points_required })
      .eq('id', member_id);

    if (deductErr) throw deductErr;

    // Insert redemption
    const { data: redemption, error: redempErr } = await supabase
      .from('redemptions')
      .insert({
        member_id,
        reward_id,
        points_used: reward.points_required
      })
      .select(`
        id,
        code,
        status,
        expires_at,
        reward:rewards(name, description, partner_id)
      `)
      .single();

    if (redempErr) {
      // Rollback: restore points
      await supabase
        .from('profiles')
        .update({ points: profile.points })
        .eq('id', member_id);
      throw redempErr;
    }

    return res.status(200).json({
      success: true,
      redemption: {
        id: redemption.id,
        code: redemption.code,
        reward_name: redemption.reward.name,
        reward_description: redemption.reward.description,
        partner_id: redemption.reward.partner_id,
        expires_at: redemption.expires_at,
        points_used: reward.points_required,
        remaining_points: profile.points - reward.points_required
      }
    });

  } catch (err) {
    console.error('Redeem error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
