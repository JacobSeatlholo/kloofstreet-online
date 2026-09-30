// Apple Wallet Pass - POST-MVP (requires paid Apple Developer Account)
// Returns 501 until implemented

export default async function handler(req, res) {
  return res.status(501).json({
    error: 'Not implemented',
    message: 'Apple Wallet passes require a paid Apple Developer Account ($99/year). Coming in Phase 2.'
  });
}
