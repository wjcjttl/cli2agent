#!/usr/bin/env bash
# Run this AFTER making the repo public to enable security features
# and branch protection that require a public repo (or GitHub Pro).
#
# Usage: bash scripts/setup-github-public.sh

set -euo pipefail

REPO="wjcjttl/cli2agent"

echo "=== Enabling secret scanning + push protection ==="
gh api "repos/$REPO" -X PATCH --input - <<'EOF'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
EOF

echo "=== Enabling branch protection on main ==="
gh api "repos/$REPO/branches/main/protection" -X PUT --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Typecheck & Build"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF

echo ""
echo "Done! Verify at:"
echo "  https://github.com/$REPO/settings/security_analysis"
echo "  https://github.com/$REPO/settings/branches"
