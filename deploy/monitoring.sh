#!/usr/bin/env bash
# Creates the alerting policies in deploy/alerts: one for a failed Gmail watch
# renewal (the parser's `renew_watch_failed` log line) and one for a
# notification that landed on the dead-letter topic. Idempotent: an existing
# policy with the same display name is updated in place.
#
#   PROJECT=my-project CHANNEL=projects/my-project/notificationChannels/123 deploy/monitoring.sh
#
# CHANNEL is a notification channel (email, Slack, ...) created in the Cloud
# Console or with `gcloud beta monitoring channels create`; list them with
# `gcloud beta monitoring channels list`.
set -euo pipefail

: "${PROJECT:?set PROJECT to the Google Cloud project id}"
: "${CHANNEL:?set CHANNEL to the full name of the notification channel}"
SERVICE="${SERVICE:-parser}"
DEAD_LETTER_TOPIC="${DEAD_LETTER_TOPIC:-gmail-dead-letter}"

here=$(cd "$(dirname "$0")" && pwd)
gcloud="gcloud --project=$PROJECT --quiet"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

apply_policy() {
  local file=$1 rendered
  rendered="$tmp/$(basename "$1")"
  sed -e "s|@SERVICE@|$SERVICE|g" -e "s|@DEAD_LETTER_TOPIC@|$DEAD_LETTER_TOPIC|g" "$file" >"$rendered"
  local display
  display=$(sed -n 's/^displayName: *"\(.*\)"$/\1/p' "$rendered")
  local existing
  existing=$($gcloud alpha monitoring policies list --filter="displayName=\"$display\"" --format='value(name)')
  if [ -n "$existing" ]; then
    $gcloud alpha monitoring policies update "$existing" --policy-from-file="$rendered" \
      --set-notification-channels="$CHANNEL" >/dev/null
    echo "Updated $display"
  else
    $gcloud alpha monitoring policies create --policy-from-file="$rendered" \
      --notification-channels="$CHANNEL" >/dev/null
    echo "Created $display"
  fi
}

for policy in "$here"/alerts/*.yaml; do
  apply_policy "$policy"
done
