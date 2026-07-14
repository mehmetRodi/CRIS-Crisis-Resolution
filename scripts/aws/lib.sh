#!/usr/bin/env bash
# Shared config + helpers for the CrisisMap AWS wiring scripts.
# Sourced by every 00-..70- script; never run directly.
#
# Override any value inline, e.g.:
#   AWS_REGION=eu-west-1 ./30-deploy-role.sh
set -euo pipefail

# ---------------------------------------------------------------------------
# Config (all overridable via env)
# ---------------------------------------------------------------------------
AWS_REGION="${AWS_REGION:-eu-central-1}"        # Frankfurt — EU Bedrock inference profile (ADR-0017)
GH_OWNER="${GH_OWNER:-mehmetRodi}"
GH_REPO_NAME="${GH_REPO_NAME:-CRIS-Crisis-Resolution}"
GH_REPO="${GH_REPO:-$GH_OWNER/$GH_REPO_NAME}"
GH_BRANCH="${GH_BRANCH:-main}"
CDK_QUALIFIER="${CDK_QUALIFIER:-hnb659fds}"
AMPLIFY_APP_NAME="${AMPLIFY_APP_NAME:-crisismap}"
DEPLOY_ROLE_STACK="${DEPLOY_ROLE_STACK:-crisismap-github-oidc-deploy-role}"
BEDROCK_MODEL_ID="${BEDROCK_MODEL_ID:-eu.anthropic.claude-haiku-4-5-20251001-v1:0}"

# Identity Center / team
SSO_GROUP_NAME="${SSO_GROUP_NAME:-CrisisMapDevelopers}"
SSO_PERMISSION_SET="${SSO_PERMISSION_SET:-CrisisMapDeveloper}"

# Repo root (two levels up from scripts/aws/)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

export AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION"

# ---------------------------------------------------------------------------
# Pretty output
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  _B=$'\033[1m'; _G=$'\033[32m'; _Y=$'\033[33m'; _R=$'\033[31m'; _C=$'\033[36m'; _N=$'\033[0m'
else
  _B=""; _G=""; _Y=""; _R=""; _C=""; _N=""
fi
step() { printf "\n%s==> %s%s\n" "$_B$_C" "$*" "$_N"; }
ok()   { printf "%s  ✓ %s%s\n" "$_G" "$*" "$_N"; }
warn() { printf "%s  ! %s%s\n" "$_Y" "$*" "$_N"; }
die()  { printf "%s  ✗ %s%s\n" "$_R" "$*" "$_N" >&2; exit 1; }

confirm() {
  # confirm "prompt" — returns 0 on y/Y. Auto-yes when ASSUME_YES=1.
  [[ "${ASSUME_YES:-0}" == "1" ]] && return 0
  local reply
  read -r -p "$_Y  ? $1 [y/N] $_N" reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "'$1' not found on PATH. $2"; }

# ---------------------------------------------------------------------------
# Safety: never operate as the account root user.
# ---------------------------------------------------------------------------
account_id() { aws sts get-caller-identity --query Account --output text; }
caller_arn() { aws sts get-caller-identity --query Arn --output text; }

refuse_root() {
  local arn; arn="$(caller_arn)" || die "Can't reach AWS — run 'aws configure sso' first."
  if [[ "$arn" == *":root" ]]; then
    die "You are authenticated as the account ROOT user ($arn).
     Root must never be used for setup. Enable IAM Identity Center, sign in as an
     admin user/permission set, then re-run. See docs/runbooks/team-onboarding.md."
  fi
}
