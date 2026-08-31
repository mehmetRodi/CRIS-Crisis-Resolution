#!/usr/bin/env bash
# Build artifacts are produced by deploy.yml after `ampx pipeline-deploy` has
# emitted production amplify_outputs.json. This helper publishes those static
# files to the SAME Amplify app/branch, waits for the atomic Hosting release,
# and probes the SPA root + a deep route (ADR-0059).
cd "$(dirname "$0")" && source ./lib.sh
refuse_root

need_cmd aws "Install AWS CLI v2."
need_cmd curl "Install curl."
need_cmd jq "Install jq."
need_cmd zip "Install zip."

APP_ID="${AMPLIFY_APP_ID:-}"
BRANCH="${AMPLIFY_BRANCH:-$GH_BRANCH}"
DIST_DIR="${FRONTEND_DIST_DIR:-$REPO_ROOT/apps/web/dist}"

[[ -n "$APP_ID" ]] || die "Set AMPLIFY_APP_ID to the existing Amplify Gen 2 app id."
[[ "$APP_ID" =~ ^d[a-z0-9]+$ ]] || die "AMPLIFY_APP_ID is not a valid Amplify app id."
[[ "$BRANCH" == "$GH_BRANCH" ]] || die "Refusing to publish '$BRANCH'; production Hosting is pinned to '$GH_BRANCH'."
[[ -d "$DIST_DIR" ]] || die "Frontend output missing: $DIST_DIR (run the web build first)."
[[ -f "$DIST_DIR/index.html" ]] || die "Frontend output has no index.html: $DIST_DIR"

REPOSITORY="$(aws amplify get-app --region "$AWS_REGION" --app-id "$APP_ID" \
  --query 'app.repository' --output text)"
[[ -z "$REPOSITORY" || "$REPOSITORY" == "None" ]] || \
  die "Amplify app is source-connected; manual artifact deploys require an app without a repository."

# React Router needs a 200 rewrite for extensionless deep links. The regex is
# AWS's SPA rule and deliberately excludes static asset extensions so a missing
# JS/image request remains a real 404 instead of receiving HTML.
SPA_RULES='[{"source":"</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>","target":"/index.html","status":"200"}]'

step "Configure Amplify Hosting for the Vite SPA"
aws amplify update-app --region "$AWS_REGION" --app-id "$APP_ID" \
  --custom-rules "$SPA_RULES" >/dev/null
aws amplify update-branch --region "$AWS_REGION" --app-id "$APP_ID" \
  --branch-name "$BRANCH" --stage PRODUCTION --framework "React - Vite" \
  --no-enable-auto-build >/dev/null
ok "Production branch and SPA rewrite are configured"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cris-amplify-hosting.XXXXXX")"
ARCHIVE="$TEMP_DIR/frontend.zip"
cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

step "Package frontend artifacts"
(
  cd "$DIST_DIR"
  zip -q -r "$ARCHIVE" .
)
[[ -s "$ARCHIVE" ]] || die "Frontend archive is empty."
ok "Packaged $(du -h "$ARCHIVE" | awk '{print $1}')"

step "Create and upload Amplify Hosting deployment"
DEPLOYMENT="$(aws amplify create-deployment --region "$AWS_REGION" \
  --app-id "$APP_ID" --branch-name "$BRANCH" --output json)"
JOB_ID="$(jq -r '.jobId // empty' <<<"$DEPLOYMENT")"
UPLOAD_URL="$(jq -r '.zipUploadUrl // empty' <<<"$DEPLOYMENT")"
[[ -n "$JOB_ID" && -n "$UPLOAD_URL" ]] || die "Amplify did not return a deployment job and upload URL."

# Do not log the presigned upload URL. It is short-lived but still a bearer URL.
curl --fail --silent --show-error --request PUT \
  --header "Content-Type: application/zip" \
  --data-binary "@$ARCHIVE" "$UPLOAD_URL" >/dev/null
aws amplify start-deployment --region "$AWS_REGION" --app-id "$APP_ID" \
  --branch-name "$BRANCH" --job-id "$JOB_ID" >/dev/null
ok "Hosting job $JOB_ID started"

step "Wait for Amplify Hosting job"
STATUS="PENDING"
for _ in {1..60}; do
  STATUS="$(aws amplify get-job --region "$AWS_REGION" --app-id "$APP_ID" \
    --branch-name "$BRANCH" --job-id "$JOB_ID" \
    --query 'job.summary.status' --output text)"
  case "$STATUS" in
    SUCCEED)
      break
      ;;
    FAILED | CANCELLED)
      die "Amplify Hosting job $JOB_ID ended with $STATUS."
      ;;
    PENDING | PROVISIONING | RUNNING | CANCELLING)
      sleep 10
      ;;
    *)
      die "Amplify Hosting job $JOB_ID returned unknown status '$STATUS'."
      ;;
  esac
done
[[ "$STATUS" == "SUCCEED" ]] || die "Amplify Hosting job $JOB_ID timed out with status $STATUS."
ok "Hosting job $JOB_ID succeeded"

DEFAULT_DOMAIN="$(aws amplify get-app --region "$AWS_REGION" --app-id "$APP_ID" \
  --query 'app.defaultDomain' --output text)"
APP_URL="https://${BRANCH}.${DEFAULT_DOMAIN}"

step "Probe hosted SPA"
PROBE_FILE="$TEMP_DIR/probe.html"
for route in / /report; do
  curl --fail --silent --show-error --location --retry 5 --retry-delay 2 --retry-all-errors \
    "$APP_URL$route" --output "$PROBE_FILE"
  grep -F 'id="root"' "$PROBE_FILE" >/dev/null || die "Hosted route $route did not return the SPA shell."
done
ok "Frontend is live at $APP_URL"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '### Amplify Hosting\n\n- URL: %s\n- Job: `%s`\n' "$APP_URL" "$JOB_ID" >>"$GITHUB_STEP_SUMMARY"
fi
