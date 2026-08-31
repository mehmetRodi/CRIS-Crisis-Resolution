#!/usr/bin/env bash
# 10 — Team identity. Stands up IAM Identity Center (SSO) so the 5 developers get
# individual logins instead of shared/root keys (ADR-0017). Idempotent.
#
# Flow: Organizations → Identity Center instance (console step if absent) →
# CrisisMapDeveloper permission set → CrisisMapDevelopers group → users → assign
# the group to this account with the permission set.
#
# Developers are read from scripts/aws/developers.txt (git-ignored). Format, one
# per line:  email[,GivenName,FamilyName]      e.g.  ada@oplog.io,Ada,Lovelace
cd "$(dirname "$0")" && source ./lib.sh
refuse_root

ACCOUNT_ID="$(account_id)"

# --- 1. AWS Organizations -----------------------------------------------------
step "AWS Organizations"
if aws organizations describe-organization >/dev/null 2>&1; then
  ok "Organization already exists"
else
  warn "No organization. Identity Center requires one; this account becomes the management account."
  confirm "Create an organization (feature set ALL)?" || die "Aborted."
  aws organizations create-organization --feature-set ALL >/dev/null
  ok "Organization created"
fi

# --- 2. Identity Center instance ---------------------------------------------
step "IAM Identity Center instance"
INSTANCE_ARN="$(aws sso-admin list-instances --query 'Instances[0].InstanceArn' --output text 2>/dev/null || true)"
if [[ -z "$INSTANCE_ARN" || "$INSTANCE_ARN" == "None" ]]; then
  warn "Identity Center is not enabled yet — this one step is console-only:"
  warn "  1. Open  https://console.aws.amazon.com/singlesignon/  (region $AWS_REGION)"
  warn "  2. Click 'Enable'. Choose the Identity Center directory (default)."
  warn "  3. Re-run this script."
  die "Enable Identity Center, then re-run ./10-identity-center.sh"
fi
IDENTITY_STORE_ID="$(aws sso-admin list-instances --query 'Instances[0].IdentityStoreId' --output text)"
ok "Instance $INSTANCE_ARN (identity store $IDENTITY_STORE_ID)"

# --- 3. Permission set --------------------------------------------------------
step "Permission set: $SSO_PERMISSION_SET"
PS_ARN="$(aws sso-admin list-permission-sets --instance-arn "$INSTANCE_ARN" \
  --query 'PermissionSets' --output text | tr '\t' '\n' | while read -r ps; do
    name="$(aws sso-admin describe-permission-set --instance-arn "$INSTANCE_ARN" \
             --permission-set-arn "$ps" --query 'PermissionSet.Name' --output text)"
    [[ "$name" == "$SSO_PERMISSION_SET" ]] && echo "$ps"
  done | head -1)"

if [[ -z "$PS_ARN" ]]; then
  PS_ARN="$(aws sso-admin create-permission-set --instance-arn "$INSTANCE_ARN" \
    --name "$SSO_PERMISSION_SET" \
    --description "CRIS developer: run 'ampx sandbox' + read the console" \
    --session-duration PT8H --query 'PermissionSet.PermissionSetArn' --output text)"
  ok "Created $PS_ARN"
else
  ok "Exists: $PS_ARN"
fi

# PowerUserAccess = full service access EXCEPT IAM/Organizations. Sandbox needs
# to create its own roles, so we add a scoped IAM inline policy on top (limited
# to amplify-*/cdk-* names) — NOT full admin, so devs can't touch prod IAM.
aws sso-admin attach-managed-policy-to-permission-set --instance-arn "$INSTANCE_ARN" \
  --permission-set-arn "$PS_ARN" \
  --managed-policy-arn arn:aws:iam::aws:policy/PowerUserAccess >/dev/null 2>&1 || true
ok "Attached PowerUserAccess"

aws sso-admin put-inline-policy-to-permission-set --instance-arn "$INSTANCE_ARN" \
  --permission-set-arn "$PS_ARN" --inline-policy '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SandboxRoleManagement",
      "Effect": "Allow",
      "Action": ["iam:CreateRole","iam:DeleteRole","iam:AttachRolePolicy","iam:DetachRolePolicy",
                 "iam:PutRolePolicy","iam:DeleteRolePolicy","iam:CreatePolicy","iam:DeletePolicy",
                 "iam:TagRole","iam:UntagRole","iam:UpdateAssumeRolePolicy","iam:PassRole",
                 "iam:GetRole","iam:GetRolePolicy","iam:ListRolePolicies","iam:ListAttachedRolePolicies"],
      "Resource": ["arn:aws:iam::*:role/amplify-*","arn:aws:iam::*:role/cdk-*","arn:aws:iam::*:policy/amplify-*"]
    }
  ]
}' >/dev/null
ok "Attached scoped IAM inline policy (amplify-*/cdk-* only)"

# --- 4. Group -----------------------------------------------------------------
step "Group: $SSO_GROUP_NAME"
GROUP_ID="$(aws identitystore list-groups --identity-store-id "$IDENTITY_STORE_ID" \
  --filters "AttributePath=DisplayName,AttributeValue=$SSO_GROUP_NAME" \
  --query 'Groups[0].GroupId' --output text 2>/dev/null || true)"
if [[ -z "$GROUP_ID" || "$GROUP_ID" == "None" ]]; then
  GROUP_ID="$(aws identitystore create-group --identity-store-id "$IDENTITY_STORE_ID" \
    --display-name "$SSO_GROUP_NAME" --description "CRIS developers" \
    --query 'GroupId' --output text)"
  ok "Created group $GROUP_ID"
else
  ok "Exists: group $GROUP_ID"
fi

# --- 5. Assign group → this account with the permission set -------------------
step "Account assignment ($ACCOUNT_ID)"
aws sso-admin create-account-assignment --instance-arn "$INSTANCE_ARN" \
  --target-id "$ACCOUNT_ID" --target-type AWS_ACCOUNT \
  --permission-set-arn "$PS_ARN" \
  --principal-type GROUP --principal-id "$GROUP_ID" >/dev/null 2>&1 || true
ok "Group $SSO_GROUP_NAME → account $ACCOUNT_ID via $SSO_PERMISSION_SET"

# --- 6. Developers ------------------------------------------------------------
step "Developers"
DEV_FILE="./developers.txt"
if [[ ! -f "$DEV_FILE" ]]; then
  warn "No $DEV_FILE. Create it (git-ignored), one per line: email[,Given,Family]"
  warn "Then re-run to create + invite the users."
  exit 0
fi

while IFS=',' read -r email given family || [[ -n "$email" ]]; do
  email="$(echo "$email" | xargs)"; [[ -z "$email" || "$email" == \#* ]] && continue
  given="${given:-${email%%@*}}"; family="${family:-User}"
  given="$(echo "$given" | xargs)"; family="$(echo "$family" | xargs)"

  uid="$(aws identitystore list-users --identity-store-id "$IDENTITY_STORE_ID" \
    --filters "AttributePath=UserName,AttributeValue=$email" \
    --query 'Users[0].UserId' --output text 2>/dev/null || true)"
  if [[ -z "$uid" || "$uid" == "None" ]]; then
    uid="$(aws identitystore create-user --identity-store-id "$IDENTITY_STORE_ID" \
      --user-name "$email" --display-name "$given $family" \
      --name "GivenName=$given,FamilyName=$family" \
      --emails "Value=$email,Type=work,Primary=true" \
      --query 'UserId' --output text)"
    ok "Created user $email (invitation email sent)"
  else
    ok "Exists: $email"
  fi

  # Idempotent group membership.
  aws identitystore create-group-membership --identity-store-id "$IDENTITY_STORE_ID" \
    --group-id "$GROUP_ID" --member-id "UserId=$uid" >/dev/null 2>&1 || true
done < "$DEV_FILE"

step "Identity Center wired"
ok "Devs get an 'Accept invitation' email → set password + register MFA."
ok "Give them the AWS access portal URL from the Identity Center console dashboard."
ok "Then each dev follows docs/runbooks/team-onboarding.md."
