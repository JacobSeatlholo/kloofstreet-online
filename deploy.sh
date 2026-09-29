#!/bin/bash
set -e

BRANCH=${1:-main}
MSG=${2:-"newsletter: optimized Gmail sending + Sheets import + subscriber management"}

echo "╔════════════════════════════════════════════════╗"
echo "║  KloofStreet.online → GitHub Deploy            ║"
echo "╚════════════════════════════════════════════════╝"

if [ ! -d .git ]; then
  echo "→ Initializing git repo..."
  git init
  git branch -M $BRANCH
fi

echo "→ Staging files..."
git add -A

echo "→ Committing: $MSG"
git commit -m "$MSG" --allow-empty

if git remote | grep -q origin; then
  echo "→ Pushing to origin/$BRANCH..."
  git push -u origin $BRANCH --force
  echo ""
  echo "  Pushed! Vercel will auto-deploy if connected."
else
  echo ""
  echo "  No remote 'origin' set. Run:"
  echo "    git remote add origin git@github.com:YOUR_USERNAME/kloofstreet-online.git"
  echo "    bash deploy.sh"
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  POST-DEPLOY CHECKLIST"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  1. Run newsletter-schema.sql in Supabase SQL Editor"
echo "  2. Google Cloud Console → Enable APIs:"
echo "     - Gmail API"
echo "     - Google Sheets API"
echo "  3. Create OAuth2 credentials (Web application)"
echo "     - Redirect: https://kloofstreet.online/api/newsletter/google-auth?step=callback"
echo "  4. Add to Vercel env vars:"
echo "     GOOGLE_CLIENT_ID=your_id"
echo "     GOOGLE_CLIENT_SECRET=your_secret"
echo "     GOOGLE_REDIRECT_URI=https://kloofstreet.online/api/newsletter/google-auth?step=callback"
echo "  5. Visit https://kloofstreet.online → Newsletter page"
echo "  6. Click 'Connect Gmail' → Import contacts → Send!"
echo ""
echo "  Gmail limits: 500/day (free) | 2,000/day (Workspace)"
echo "  Optimized: 200/batch × 10 parallel = ~20 emails/sec"
echo "═══════════════════════════════════════════════════"
