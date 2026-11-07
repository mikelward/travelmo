#!/usr/bin/env bash
# Creates the parser's daily Cloud Scheduler jobs: Gmail watch renewal, the
# calendar feed poll, the geocoding sweep and the reminder mail. Each POSTs
# to an /internal route with an OIDC token from SCHEDULER_SA. Idempotent:
# rerun after changing a value. Three jobs per billing account are free; the
# fourth costs about ten cents a month.
#
#   PROJECT=my-project PARSER_URL=https://parser-xyz.a.run.app \
#   SCHEDULER_SA=scheduler@my-project.iam.gserviceaccount.com deploy/scheduler.sh
#
# SCHEDULER_SA must be listed in the parser's INTERNAL_CALLERS; PARSER_URL
# must be its INTERNAL_AUDIENCE.
set -euo pipefail

: "${PROJECT:?set PROJECT to the Google Cloud project id}"
: "${PARSER_URL:?set PARSER_URL to the Cloud Run URL of the parser}"
: "${SCHEDULER_SA:?set SCHEDULER_SA to the service account the jobs call as}"
LOCATION="${LOCATION:-europe-west1}"
TIME_ZONE="${TIME_ZONE:-Etc/UTC}"

gcloud="gcloud --project=$PROJECT --quiet"

# name, schedule, path
ensure_job() {
  local verb=create
  if $gcloud scheduler jobs describe "$1" --location="$LOCATION" >/dev/null 2>&1; then verb=update; fi
  $gcloud scheduler jobs "$verb" http "$1" \
    --location="$LOCATION" \
    --schedule="$2" \
    --time-zone="$TIME_ZONE" \
    --uri="${PARSER_URL%/}$3" \
    --http-method=POST \
    --oidc-service-account-email="$SCHEDULER_SA" \
    --oidc-token-audience="$PARSER_URL" \
    --attempt-deadline=30m >/dev/null
  echo "$verb $1: $2 → $3"
}

ensure_job renew-gmail-watches "17 3 * * *" /internal/renew-watches
ensure_job poll-calendar-feeds "43 4 * * *" /internal/poll-feeds
# Early in the UTC day, when the geocoding budget is fresh.
ensure_job geocode-sweep "11 1 * * *" /internal/geocode-sweep
# Morning in Europe, so a reminder is read the day it is about.
ensure_job send-reminders "7 6 * * *" /internal/reminders
