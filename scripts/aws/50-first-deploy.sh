#!/usr/bin/env bash
# 50 — Trigger the first backend deploy manually (workflow_dispatch) and watch
# it, so wiring is validated before relying on push-to-main auto-deploy.
cd "$(dirname "$0")" && source ./lib.sh

step "Dispatch Deploy workflow on $GH_BRANCH"
gh workflow run deploy.yml --repo "$GH_REPO" --ref "$GH_BRANCH"
ok "Dispatched. Waiting for the run to register…"
sleep 4

RUN_ID="$(gh run list --repo "$GH_REPO" --workflow deploy.yml --branch "$GH_BRANCH" \
  --limit 1 --json databaseId --jq '.[0].databaseId')"
[[ -n "$RUN_ID" ]] || die "Couldn't find the dispatched run — check GitHub → Actions."

step "Watching run $RUN_ID"
gh run watch "$RUN_ID" --repo "$GH_REPO" --exit-status || die "Deploy failed — see the run logs. Common cause: deploy-role perms or missing Bedrock access (ADR-0017)."

step "First deploy succeeded"
ok "Backend is live. Next: ./60-subscribe-alarms.sh to route ops alarms."
ok "Thereafter merges to $GH_BRANCH deploy automatically."
