#!/usr/bin/env bash
# 60 — Subscribe an endpoint to the ops alarm SNS topic (post-deploy). The topic
# has no subscriber until you add one (the endpoint is environment-specific, so
# it's not in code — ADR-0015). Usage:
#   ALARM_EMAIL=oncall@oplog.io ./60-subscribe-alarms.sh
cd "$(dirname "$0")" && source ./lib.sh
refuse_root

EMAIL="${ALARM_EMAIL:-${1:-}}"
[[ -n "$EMAIL" ]] || die "Set an endpoint: ALARM_EMAIL=oncall@oplog.io ./60-subscribe-alarms.sh"

step "Find OpsAlarmTopic"
TOPIC_ARN="$(aws sns list-topics --region "$AWS_REGION" \
  --query "Topics[?contains(TopicArn, 'OpsAlarmTopic')].TopicArn | [0]" --output text 2>/dev/null || true)"
[[ -n "$TOPIC_ARN" && "$TOPIC_ARN" != "None" ]] || die "No OpsAlarmTopic found — has the backend deployed (./50-first-deploy.sh)?"
ok "$TOPIC_ARN"

step "Subscribe $EMAIL (email)"
aws sns subscribe --region "$AWS_REGION" --topic-arn "$TOPIC_ARN" \
  --protocol email --notification-endpoint "$EMAIL" >/dev/null
ok "Subscription requested — confirm via the email AWS sends before alarms deliver."

step "Alarms wired"
ok "Per-alarm response lives in docs/runbooks/deploy.md; dashboard: CloudWatch → Dashboards → CrisisMap-*."
