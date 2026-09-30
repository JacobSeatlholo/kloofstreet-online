/**
 * Shared merchant authentication for KloofStreet.online
 *
 * A "merchant" is a logged-in Supabase Auth user whose email matches
 * the `login_email` column of a row in the `partners` table.
 *
 * Usage inside an API route:
 *   const auth = await requireMerchant(req);
 *   if (!auth.ok) return jsonError(res, auth);
 *   // auth.merchant = { email, userId, partner }
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

export async function requireMerchant(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    return { ok: false, status: 401, error: 'Sign in required' };
  }

  const { data: userData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !userData || !userData.user || !userData.user.email) {
    return { ok: false, status: 401, error: 'Invalid or expired session. Sign in again.' };
  }

  const user = userData.user;

  const { data: partner, error: pErr } = await supabase
    .from('partners')
    .select('*')
    .eq('login_email', user.email)
    .maybeSingle();

  if (pErr) {
    return { ok: false, status: 500, error: 'Merchant lookup failed: ' + pErr.message };
  }

  if (!partner) {
    return {
      ok: false,
      status: 403,
      error: 'This account is not a registered Kloof Street store. Ask the KloofStreet team to link your email to your store listing.'
    };
  }

  return { ok: true, merchant: { email: user.email, userId: user.id, partner } };
}

export function jsonError(res, auth) {
  return res.status(auth.status).json({ error: auth.error });
}
