#!/usr/bin/env bash
# 30 — Deploy the GitHub OIDC provider + repo/branch-scoped deploy role via
# CloudFormation (infra/bootstrap/github-oidc-deploy-role.yaml). Idempotent:
# `deploy` updates the stack in place. Detects a pre-existing OIDC provider and
# reuses it (only one per account is allowed).
cd "$(dirname "$0")" && source ./lib.sh
refuse_root

TEMPLATE="$REPO_ROOT/infra/bootstrap/github-oidc-deploy-role.yaml"
[[ -f "$TEMPLATE" ]] || die "Template missing: $TEMPLATE"

APP_ID="${AMPLIFY_APP_ID:-$(aws amplify list-apps --region "$AWS_REGION" \
  --query "apps[?name=='$AMPLIFY_APP_NAME'].appId | [0]" --output text 2>/dev/null || true)}"
[[ -n "$APP_ID" && "$APP_ID" != "None" ]] || die "No Amplify app id. Run ./20-bootstrap.sh first (or set AMPLIFY_APP_ID)."

PARAMS=(
  GitHubOrg="$GH_OWNER"
  GitHubRepo="$GH_REPO_NAME"
  GitHubBranch="$GH_BRANCH"
  CdkQualifier="$CDK_QUALIFIER"
  AmplifyAppId="$APP_ID"
)

# Idempotency: if THIS stack already exists, keep its provider decision. Re-deciding
# from scratch on a re-run is a trap — if the stack itself created the provider, a
# fresh `list-open-id-connect-providers` sees it, flips to CreateOIDCProvider=false,
# and CloudFormation then DELETES the stack-managed provider. So only decide fresh
# when the stack does not yet exist.
step "Existing GitHub OIDC provider?"
STACK_CREATE_PARAM="$(aws cloudformation describe-stacks --region "$AWS_REGION" \
  --stack-name "$DEPLOY_ROLE_STACK" \
  --query "Stacks[0].Parameters[?ParameterKey=='CreateOIDCProvider'].ParameterValue | [0]" \
  --output text 2>/dev/null || true)"

if [[ -n "$STACK_CREATE_PARAM" && "$STACK_CREATE_PARAM" != "None" ]]; then
  # Stack exists — reuse its previous parameter values (aws cloudformation deploy
  # keeps any param we don't override), so the provider is neither recreated nor deleted.
  ok "Stack exists; keeping its provider decision (CreateOIDCProvider=$STACK_CREATE_PARAM)"
else
  EXISTING="$(aws iam list-open-id-connect-providers \
    --query "OpenIDConnectProviderList[?contains(Arn, 'token.actions.githubusercontent.com')].Arn | [0]" \
    --output text 2>/dev/null || true)"
  if [[ -n "$EXISTING" && "$EXISTING" != "None" ]]; then
    ok "Reusing pre-existing provider $EXISTING"
    PARAMS+=(CreateOIDCProvider=false ExistingOIDCProviderArn="$EXISTING")
  else
    ok "None — the stack will create one"
    PARAMS+=(CreateOIDCProvider=true)
  fi
fi

step "Deploying stack: $DEPLOY_ROLE_STACK"
aws cloudformation deploy --region "$AWS_REGION" \
  --stack-name "$DEPLOY_ROLE_STACK" \
  --template-file "$TEMPLATE" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides "${PARAMS[@]}"

ROLE_ARN="$(aws cloudformation describe-stacks --region "$AWS_REGION" \
  --stack-name "$DEPLOY_ROLE_STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue | [0]" --output text)"

step "Deploy role ready"
ok "AWS_DEPLOY_ROLE_ARN=$ROLE_ARN"
ok "Next: ./40-configure-github.sh  (pass this ARN + the Amplify app id)"
