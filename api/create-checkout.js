module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  const { userId, email, displayName } = req.body;
  if (!userId || !email) return res.status(400).json({ error: 'Missing userId or email' });
  const YOCO_KEY = process.env.YOCO_SECRET_KEY;
  if (!YOCO_KEY) return res.status(500).json({ error: 'YOCO_SECRET_KEY not configured' });
  try {
    const yocoRes = await fetch('https://payments.yoco.com/api/checkouts', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + YOCO_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 19900, currency: 'ZAR',
        success_url: 'https://kloofstreet.online/streetpass?paid=1',
        cancel_url: 'https://kloofstreet.online/streetpass/join',
        metadata: { user_id: userId, email: email, name: displayName || '' }
      })
    });
    const text = await yocoRes.text();
    if (!yocoRes.ok) return res.status(502).json({ error: 'Yoco API error', status: yocoRes.status, body: text.substring(0, 500) });
    let data;
    try { data = JSON.parse(text); } catch(e) {
      return res.status(502).json({ error: 'Yoco returned non-JSON', body: text.substring(0, 500) });
    }
    res.status(200).json({ checkoutUrl: data.redirect_url });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
