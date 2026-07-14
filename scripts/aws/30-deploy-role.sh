#!/usr/bin/env bash
# 30 — Deploy the GitHub OIDC provider + branch-scoped deploy role via
# CloudFormation (infra/bootstrap/github-oidc-deploy-role.yaml). Idempotent:
# `deploy` updates the stack in place. Detects a pre-existing OIDC provider and
# reuses it (only one per account is allowed).
cd "$(dirname "$0")" && source ./lib.sh
refuse_root

TEMPLATE="$REPO_ROOT/infra/bootstrap/github-oidc-deploy-role.yaml"
[[ -f "$TEMPLATE" ]] || die "Template missing: $TEMPLATE"

step "Existing GitHub OIDC provider?"
EXISTING="$(aws iam list-open-id-connect-providers \
  --query "OpenIDConnectProviderList[?contains(Arn, 'token.actions.githubusercontent.com')].Arn | [0]" \
  --output text 2>/dev/null || true)"
PARAMS=(GitHubOrg="$GH_OWNER" GitHubRepo="$GH_REPO_NAME" GitHubBranch="$GH_BRANCH" CdkQualifier="$CDK_QUALIFIER")
if [[ -n "$EXISTING" && "$EXISTING" != "None" ]]; then
  ok "Reusing $EXISTING"
  PARAMS+=(CreateOIDCProvider=false ExistingOIDCProviderArn="$EXISTING")
else
  ok "None — the stack will create one"
  PARAMS+=(CreateOIDCProvider=true)
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
