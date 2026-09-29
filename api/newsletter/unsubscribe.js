/**
 * Newsletter unsubscribe.
 *
 * GET  /api/newsletter/unsubscribe?e=email  → self-contained HTML confirmation page
 * POST /api/newsletter/unsubscribe          → {email} JSON  (page confirm button)
 *                                            or Gmail One-Click (form-encoded List-Unsubscribe)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function setUnsubscribed(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(clean)) return { ok: false, error: 'Invalid email address' };
  const { error } = await supabase
    .from('newsletter_contacts')
    .update({ unsubscribed: true })
    .eq('email', clean);
  if (error) return { ok: false, error: error.message };
  return { ok: true, email: clean };
}

function page(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} — KloofStreet.online</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0b;color:#e8e8e6;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.card{max-width:440px;width:100%;background:#151517;border:1px solid #2a2a2e;border-radius:16px;padding:40px 32px;text-align:center}
.logo{color:#d4af6a;font-weight:700;font-size:14px;letter-spacing:2px;text-transform:uppercase;margin-bottom:20px}
h1{font-size:20px;margin:0 0 12px;font-weight:600}
p{color:#a8a8a4;font-size:14px;line-height:1.6;margin:0 0 24px}
button{background:#d4af6a;color:#0a0a0b;border:none;border-radius:10px;padding:12px 28px;font-size:14px;font-weight:600;cursor:pointer}
button:hover{background:#e5c582}
button[disabled]{opacity:.6;cursor:default}
.done{color:#d4af6a;font-size:36px;margin-bottom:8px}
a.back{color:#8a8a86;font-size:12px;text-decoration:none;display:inline-block;margin-top:20px}
a.back:hover{color:#d4af6a}
</style></head><body><div class="card">${bodyHtml}</div></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── POST: perform unsubscribe (JSON from page, or Gmail One-Click form post) ──
  if (req.method === 'POST') {
    let email = req.body?.email;
    // Gmail List-Unsubscribe=One-Click posts form-urlencoded with no email body — take it from ?e=
    if (!email && typeof req.body === 'string' && /List-Unsubscribe/i.test(req.body)) {
      email = req.query.e;
    }
    if (!email && req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
      email = req.query.e;
    }
    const result = await setUnsubscribed(email);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.status(200).json({ success: true, email: result.email });
  }

  // ── GET: confirmation page ──
  if (req.method === 'GET') {
    const email = req.query.e;
    if (!email || !EMAIL_RE.test(String(email))) {
      return res.status(400).setHeader('Content-Type', 'text/html').send(
        page('Unsubscribe', '<h1>Invalid link</h1><p>This unsubscribe link is not valid. Please contact hello@kloofstreet.online if you keep receiving our emails.</p>')
      );
    }
    const safe = String(email).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const body = `
<div class="logo">KloofStreet.online</div>
<h1>Unsubscribe from our newsletter?</h1>
<p>You will stop receiving newsletters for<br><b style="color:#e8e8e6;">${safe}</b>.<br>Street Pass account emails are not affected.</p>
<div id="nlUnsubDone" style="display:none"><div class="done">&#10003;</div><h1>You're unsubscribed</h1><p>Sorry to see you go — you won't hear from us again.</p></div>
<button id="nlUnsubBtn" onclick="nlDoUnsub()">Confirm unsubscribe</button>
<a class="back" href="/">Back to KloofStreet.online</a>
<script>
function nlDoUnsub(){
  var b=document.getElementById('nlUnsubBtn');
  b.disabled=true;b.textContent='Unsubscribing...';
  fetch('/api/newsletter/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(String(email))}})})
  .then(function(r){return r.json();})
  .then(function(d){
    if(d.error){b.textContent='Something went wrong';b.disabled=false;return;}
    b.style.display='none';
    document.getElementById('nlUnsubDone').style.display='block';
  }).catch(function(){b.textContent='Connection error — try again';b.disabled=false;});
}
</script>`;
    return res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(body);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
