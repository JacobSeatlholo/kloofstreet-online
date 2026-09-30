// Google Wallet Pass - POST-MVP (requires Google Wallet issuer account)
// Returns 501 until implemented

export default async function handler(req, res) {
  return res.status(501).json({
    error: 'Not implemented',
    message: 'Google Wallet passes require a Google Wallet Business Console issuer account. Coming in Phase 2.'
  });
}
