#!/usr/bin/env bash
# 40 — Configure the GitHub repo so the Deploy workflow can run: sets the
# variables + secrets consumed by .github/workflows/deploy.yml. Auto-discovers
# the deploy-role ARN (from the CFN stack) and the Amplify app id (by name);
# override with AWS_DEPLOY_ROLE_ARN / AMPLIFY_APP_ID env vars. Idempotent.
cd "$(dirname "$0")" && source ./lib.sh
refuse_root

step "Discover values"
ROLE_ARN="${AWS_DEPLOY_ROLE_ARN:-$(aws cloudformation describe-stacks --region "$AWS_REGION" \
  --stack-name "$DEPLOY_ROLE_STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue | [0]" --output text 2>/dev/null || true)}"
APP_ID="${AMPLIFY_APP_ID:-$(aws amplify list-apps --region "$AWS_REGION" \
  --query "apps[?name=='$AMPLIFY_APP_NAME'].appId | [0]" --output text 2>/dev/null || true)}"

[[ -n "$ROLE_ARN" && "$ROLE_ARN" != "None" ]] || die "No deploy-role ARN. Run ./30-deploy-role.sh first (or set AWS_DEPLOY_ROLE_ARN)."
[[ -n "$APP_ID"   && "$APP_ID"   != "None" ]] || die "No Amplify app id. Run ./20-bootstrap.sh first (or set AMPLIFY_APP_ID)."
ok "Role: $ROLE_ARN"
ok "App:  $APP_ID"
ok "Region: $AWS_REGION"

step "Set GitHub variables + secrets on $GH_REPO"
gh variable set AWS_REGION         --repo "$GH_REPO" --body "$AWS_REGION"
gh variable set AWS_DEPLOY_ENABLED  --repo "$GH_REPO" --body "true"
gh secret   set AWS_DEPLOY_ROLE_ARN --repo "$GH_REPO" --body "$ROLE_ARN"
gh secret   set AMPLIFY_APP_ID      --repo "$GH_REPO" --body "$APP_ID"
ok "AWS_REGION, AWS_DEPLOY_ENABLED (vars) + AWS_DEPLOY_ROLE_ARN, AMPLIFY_APP_ID (secrets) set"

warn "AWS_DEPLOY_ENABLED=true means merges to main now deploy. Optionally add a"
warn "'production' GitHub Environment with required reviewers (Settings → Environments)."
step "GitHub configured"
ok "Next: ./50-first-deploy.sh"
