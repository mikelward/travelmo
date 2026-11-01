#!/usr/bin/env bash
# Creates the Gmail Pub/Sub topic, the push subscription to the parser with a
# dead-letter topic, and the pull subscription that keeps dead-lettered
# notifications for inspection. Idempotent: rerun after changing a value.
#
#   PROJECT=my-project PARSER_URL=https://parser-xyz.a.run.app \
#   PUSH_SA=pubsub-push@my-project.iam.gserviceaccount.com deploy/pubsub.sh
#
# PUSH_SA must be listed in the parser's INTERNAL_CALLERS; PARSER_URL must be
# its INTERNAL_AUDIENCE.
set -euo pipefail

: "${PROJECT:?set PROJECT to the Google Cloud project id}"
: "${PARSER_URL:?set PARSER_URL to the Cloud Run URL of the parser}"
: "${PUSH_SA:?set PUSH_SA to the service account Pub/Sub pushes as}"
TOPIC="${TOPIC:-gmail}"
DEAD_LETTER_TOPIC="${DEAD_LETTER_TOPIC:-gmail-dead-letter}"
PUSH_SUBSCRIPTION="${PUSH_SUBSCRIPTION:-gmail-parser}"
MAX_DELIVERY_ATTEMPTS="${MAX_DELIVERY_ATTEMPTS:-5}"

gcloud="gcloud --project=$PROJECT --quiet"

ensure_topic() {
  $gcloud pubsub topics describe "$1" >/dev/null 2>&1 || $gcloud pubsub topics create "$1"
}

ensure_topic "$TOPIC"
ensure_topic "$DEAD_LETTER_TOPIC"

# Gmail publishes to the topic from Google's own service account.
$gcloud pubsub topics add-iam-policy-binding "$TOPIC" \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher >/dev/null

# Dead-lettering is done by the Pub/Sub service agent, which must be allowed
# to publish to the dead-letter topic and to acknowledge on the subscription.
PROJECT_NUMBER=$($gcloud projects describe "$PROJECT" --format='value(projectNumber)')
PUBSUB_AGENT="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"
$gcloud pubsub topics add-iam-policy-binding "$DEAD_LETTER_TOPIC" \
  --member="$PUBSUB_AGENT" --role=roles/pubsub.publisher >/dev/null

push_args=(
  --topic="$TOPIC"
  --push-endpoint="$PARSER_URL/internal/pubsub/gmail"
  --push-auth-service-account="$PUSH_SA"
  --push-auth-token-audience="$PARSER_URL"
  --ack-deadline=120
  --min-retry-delay=10s
  --max-retry-delay=600s
  --dead-letter-topic="$DEAD_LETTER_TOPIC"
  --max-delivery-attempts="$MAX_DELIVERY_ATTEMPTS"
)
if $gcloud pubsub subscriptions describe "$PUSH_SUBSCRIPTION" >/dev/null 2>&1; then
  $gcloud pubsub subscriptions update "$PUSH_SUBSCRIPTION" "${push_args[@]:1}"
else
  $gcloud pubsub subscriptions create "$PUSH_SUBSCRIPTION" "${push_args[@]}"
fi
$gcloud pubsub subscriptions add-iam-policy-binding "$PUSH_SUBSCRIPTION" \
  --member="$PUBSUB_AGENT" --role=roles/pubsub.subscriber >/dev/null

# Dead-lettered notifications wait here (seven days) to be read with
# `gcloud pubsub subscriptions pull gmail-dead-letter --auto-ack`. The alert in
# deploy/monitoring.sh fires while this subscription has a message.
if ! $gcloud pubsub subscriptions describe "$DEAD_LETTER_TOPIC" >/dev/null 2>&1; then
  $gcloud pubsub subscriptions create "$DEAD_LETTER_TOPIC" \
    --topic="$DEAD_LETTER_TOPIC" --message-retention-duration=7d --expiration-period=never
fi

echo "Push subscription $PUSH_SUBSCRIPTION -> $PARSER_URL/internal/pubsub/gmail, dead-letter $DEAD_LETTER_TOPIC after $MAX_DELIVERY_ATTEMPTS attempts"
echo "GMAIL_PUBSUB_TOPIC=projects/$PROJECT/topics/$TOPIC"
