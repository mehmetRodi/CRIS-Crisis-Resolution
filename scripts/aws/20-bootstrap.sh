#!/usr/bin/env bash
# 20 — CDK bootstrap + Amplify app. One-time per account/region. Idempotent:
# re-bootstrapping is a no-op; the Amplify app is reused if it already exists.
cd "$(dirname "$0")" && source ./lib.sh
refuse_root

ACCOUNT_ID="$(account_id)"

step "CDK bootstrap ($ACCOUNT_ID / $AWS_REGION, qualifier $CDK_QUALIFIER)"
# `ampx pipeline-deploy` deploys through CDK, which needs its bootstrap stack
# (asset bucket + the file-publishing/deploy/lookup roles the deploy role assumes).
( cd "$REPO_ROOT/apps/web" && npx --yes cdk bootstrap "aws://$ACCOUNT_ID/$AWS_REGION" \
    --qualifier "$CDK_QUALIFIER" )
ok "Bootstrapped"

step "Amplify app: $AMPLIFY_APP_NAME"
APP_ID="$(aws amplify list-apps --region "$AWS_REGION" \
  --query "apps[?name=='$AMPLIFY_APP_NAME'].appId | [0]" --output text 2>/dev/null || true)"
if [[ -z "$APP_ID" || "$APP_ID" == "None" ]]; then
  APP_ID="$(aws amplify create-app --region "$AWS_REGION" --name "$AMPLIFY_APP_NAME" \
    --query 'app.appId' --output text)"
  ok "Created Amplify app $APP_ID"
else
  ok "Exists: Amplify app $APP_ID"
fi

step "Bootstrap complete"
ok "AMPLIFY_APP_ID=$APP_ID"
ok "Next: ./30-deploy-role.sh then ./40-configure-github.sh"
