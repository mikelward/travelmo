#!/usr/bin/env bash
# Creates the Gmail Pub/Sub topic, the push subscription to the parser with a
# dead-letter topic, and the pull subscription that keeps dead-lettered
# notifications for inspection; and the topic and push subscription through
# which each batch of a mailbox reading queues the next. Idempotent: rerun
# after changing a value.
#
#   PROJECT=my-project PARSER_URL=https://parser-xyz.a.run.app \
#   PUSH_SA=pubsub-push@my-project.iam.gserviceaccount.com \
#   PARSER_SA=parser@my-project.iam.gserviceaccount.com deploy/pubsub.sh
#
# PUSH_SA must be listed in the parser's INTERNAL_CALLERS; PARSER_URL must be
# its INTERNAL_AUDIENCE; PARSER_SA is the service account the parser runs as,
# which publishes the mailbox reading's batches.
set -euo pipefail

: "${PROJECT:?set PROJECT to the Google Cloud project id}"
: "${PARSER_URL:?set PARSER_URL to the Cloud Run URL of the parser}"
: "${PUSH_SA:?set PUSH_SA to the service account Pub/Sub pushes as}"
: "${PARSER_SA:?set PARSER_SA to the service account the parser runs as}"
TOPIC="${TOPIC:-gmail}"
DEAD_LETTER_TOPIC="${DEAD_LETTER_TOPIC:-gmail-dead-letter}"
PUSH_SUBSCRIPTION="${PUSH_SUBSCRIPTION:-gmail-parser}"
MAX_DELIVERY_ATTEMPTS="${MAX_DELIVERY_ATTEMPTS:-5}"
BACKFILL_TOPIC="${BACKFILL_TOPIC:-gmail-backfill}"
BACKFILL_SUBSCRIPTION="${BACKFILL_SUBSCRIPTION:-gmail-backfill-parser}"
# Only a batch that errs fails its delivery: one that must wait (a failed
# batch's fifteen minutes, a copy still reading, Gmail's rate limit) hands
# on to a fresh message instead, since ten attempts span only about five
# minutes.
BACKFILL_MAX_DELIVERY_ATTEMPTS="${BACKFILL_MAX_DELIVERY_ATTEMPTS:-10}"

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
# A new project has no agent until something asks for it, and granting it a
# role before then fails with "does not exist".
$gcloud beta services identity create --service=pubsub.googleapis.com >/dev/null
PROJECT_NUMBER=$($gcloud projects describe "$PROJECT" --format='value(projectNumber)')
PUBSUB_AGENT="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"
$gcloud pubsub topics add-iam-policy-binding "$DEAD_LETTER_TOPIC" \
  --member="$PUBSUB_AGENT" --role=roles/pubsub.publisher >/dev/null

# A push subscription to the parser, retried with backoff and dead-lettered
# after the given attempts: ensure_push <subscription> <topic> <path>
# <ack deadline> <max attempts>.
ensure_push() {
  local push_args=(
    --topic="$2"
    --push-endpoint="$PARSER_URL$3"
    --push-auth-service-account="$PUSH_SA"
    --push-auth-token-audience="$PARSER_URL"
    --ack-deadline="$4"
    --min-retry-delay=10s
    --max-retry-delay=600s
    --dead-letter-topic="$DEAD_LETTER_TOPIC"
    --max-delivery-attempts="$5"
  )
  if $gcloud pubsub subscriptions describe "$1" >/dev/null 2>&1; then
    $gcloud pubsub subscriptions update "$1" "${push_args[@]:1}"
  else
    $gcloud pubsub subscriptions create "$1" "${push_args[@]}"
  fi
  $gcloud pubsub subscriptions add-iam-policy-binding "$1" \
    --member="$PUBSUB_AGENT" --role=roles/pubsub.subscriber >/dev/null
}

ensure_push "$PUSH_SUBSCRIPTION" "$TOPIC" /internal/pubsub/gmail 120 "$MAX_DELIVERY_ATTEMPTS"

# The mailbox reading: the parser publishes each next batch, and a batch
# runs for up to five minutes, so the push waits the longest Pub/Sub allows
# before it counts as failed.
ensure_topic "$BACKFILL_TOPIC"
$gcloud pubsub topics add-iam-policy-binding "$BACKFILL_TOPIC" \
  --member="serviceAccount:$PARSER_SA" --role=roles/pubsub.publisher >/dev/null
ensure_push "$BACKFILL_SUBSCRIPTION" "$BACKFILL_TOPIC" /internal/backfill 600 "$BACKFILL_MAX_DELIVERY_ATTEMPTS"

# Dead-lettered notifications and mailbox-reading batches wait here (seven
# days) to be read with `gcloud pubsub subscriptions pull gmail-dead-letter
# --format=json` and acknowledged with `--auto-ack`. The alert in
# deploy/monitoring.sh fires while this subscription has a message.
if ! $gcloud pubsub subscriptions describe "$DEAD_LETTER_TOPIC" >/dev/null 2>&1; then
  $gcloud pubsub subscriptions create "$DEAD_LETTER_TOPIC" \
    --topic="$DEAD_LETTER_TOPIC" --message-retention-duration=7d --expiration-period=never
fi

echo "Push subscription $PUSH_SUBSCRIPTION -> $PARSER_URL/internal/pubsub/gmail, dead-letter $DEAD_LETTER_TOPIC after $MAX_DELIVERY_ATTEMPTS attempts"
echo "Push subscription $BACKFILL_SUBSCRIPTION -> $PARSER_URL/internal/backfill, dead-letter $DEAD_LETTER_TOPIC after $BACKFILL_MAX_DELIVERY_ATTEMPTS attempts"
echo "GMAIL_PUBSUB_TOPIC=projects/$PROJECT/topics/$TOPIC"
echo "BACKFILL_PUBSUB_TOPIC=projects/$PROJECT/topics/$BACKFILL_TOPIC"
