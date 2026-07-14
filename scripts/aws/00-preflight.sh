#!/usr/bin/env bash
# 00 — Preflight. Verifies tooling, identity, region, and Bedrock access before
# any change is made. Safe to run repeatedly; makes NO changes.
cd "$(dirname "$0")" && source ./lib.sh

step "Tooling"
need_cmd aws "Install the AWS CLI v2."
need_cmd gh  "Install the GitHub CLI (https://cli.github.com)."
need_cmd node "Install Node.js (see .nvmrc)."
need_cmd npx "Comes with Node.js."
ok "aws $(aws --version 2>&1 | awk '{print $1}' | cut -d/ -f2), gh $(gh --version | head -1 | awk '{print $3}'), node $(node --version)"

step "AWS identity (must NOT be root)"
refuse_root
ok "Account $(account_id) as $(caller_arn)"

step "GitHub auth (needs 'repo' scope to set secrets/variables)"
gh auth status >/dev/null 2>&1 || die "Run 'gh auth login' first."
gh repo view "$GH_REPO" >/dev/null 2>&1 || die "Can't see $GH_REPO — check gh auth + access."
ok "gh authenticated; $GH_REPO reachable"

step "Region + Bedrock inference profile ($AWS_REGION)"
if aws bedrock list-inference-profiles --region "$AWS_REGION" \
     --query "inferenceProfileSummaries[?inferenceProfileId=='$BEDROCK_MODEL_ID'].inferenceProfileId" \
     --output text 2>/dev/null | grep -q .; then
  ok "$BEDROCK_MODEL_ID is available in $AWS_REGION"
else
  warn "$BEDROCK_MODEL_ID not listed in $AWS_REGION."
  warn "Enable Claude model access: Bedrock console → Model access → request the"
  warn "Claude family in $AWS_REGION (and EU destination regions). See ADR-0017."
fi

step "Preflight complete"
ok "Ready. Next: ./10-identity-center.sh (team) then ./20-bootstrap.sh (CD path)."
