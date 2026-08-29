module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const event = req.body;
  console.log('Yoco webhook received:', event.type || 'unknown');

  // Only process successful payments
  if (event.type === 'payment.succeeded' || event.type === 'charge.succeeded') {
    const payment = event.data || event;
    const userId = (payment.metadata || {}).user_id;
    if (!userId) {
      console.warn('No user_id in payment metadata');
      return res.status(200).send('ok');
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      console.error('Supabase env vars not configured');
      return res.status(500).send('Server misconfigured');
    }

    try {
      const updateRes = await fetch(
        SUPABASE_URL + '/rest/v1/profiles?id=eq.' + userId,
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            status: 'active',
            activated_at: new Date().toISOString()
          })
        }
      );

      if (updateRes.ok) {
        console.log('Activated profile:', userId);
      } else {
        const errText = await updateRes.text();
        console.error('Profile update failed:', updateRes.status, errText);
      }
    } catch (e) {
      console.error('Supabase update error:', e.message);
    }
  }

  res.status(200).send('ok');
};
