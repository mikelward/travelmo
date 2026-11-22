#!/usr/bin/env bash
# Chooses what CI's Deploy job deploys (README "Continuous deployment"),
# part by part, writing <part>=true|false and record_<part>=true|false to
# $GITHUB_OUTPUT. Each part's deployed/<part> tag marks the commit it was
# last deployed (or found unchanged) at; a part is due when its files
# changed since, when it has no tag, or when its tag isn't behind this push
# (a force push). A due part missing settings is skipped with a warning and
# not recorded, so it deploys once configured. A run whose push main has
# since moved past deploys and records nothing: its check can finish after
# a newer push's, and the newer run measures from the tags anyway.
#
# Inputs (environment): AFTER_SHA (this push), GITHUB_REPOSITORY,
# GITHUB_OUTPUT, GH_TOKEN for `gh api`, and the deploy settings
# (GCP_PROJECT, GCP_WORKLOAD_IDENTITY_PROVIDER, GCP_DEPLOY_SERVICE_ACCOUNT,
# GCP_REGION, PARSER_IMAGE, CLOUDFLARE_ACCOUNT_ID, PARSER_URL,
# HAS_CLOUDFLARE_TOKEN). Tested by scripts/deploy_plan_test.py.
set -euo pipefail
if ! tip=$(gh api "repos/$GITHUB_REPOSITORY/commits/main" --jq .sha); then
  echo "::warning::Couldn't read main's tip; going on as if this push is it."
  tip="$AFTER_SHA"
fi
if [ "$tip" != "$AFTER_SHA" ] && git merge-base --is-ancestor "$AFTER_SHA" "$tip" 2>/dev/null; then
  echo "Main has moved on to $tip, whose run deploys this push's changes too: deploying nothing."
  for part in firestore parser worker; do
    echo "$part=false" >> "$GITHUB_OUTPUT"
    echo "record_$part=false" >> "$GITHUB_OUTPUT"
  done
  exit 0
fi
# missing <variable>...: the names among them that are empty.
missing() {
  local out="" name
  for name in "$@"; do
    [ -n "${!name}" ] || out="$out $name"
  done
  printf '%s' "$out"
}
# decide <part> <label> <path pattern> <missing settings>
decide() {
  local base due reason
  base=$(git rev-parse --quiet --verify "refs/tags/deployed/$1^{commit}" || true)
  if [ -z "$base" ]; then
    due=true reason="never deployed from CI"
  elif ! git merge-base --is-ancestor "$base" "$AFTER_SHA"; then
    due=true reason="last deployed at $base, which isn't behind this push"
  # grep reads the whole diff (no -q): quitting at the first match
  # would end git diff with SIGPIPE, and pipefail would read that
  # as no match, skipping a due part and moving its tag.
  elif git diff --name-only "$base" "$AFTER_SHA" | grep -E "$3" >/dev/null; then
    due=true reason="changed since $base"
  else
    due=false reason="unchanged since $base"
  fi
  if [ "$due" != true ]; then
    echo "Skipping $2: $reason."
    echo "$1=false" >> "$GITHUB_OUTPUT"
    echo "record_$1=true" >> "$GITHUB_OUTPUT"
  elif [ -n "$4" ]; then
    echo "::warning::Skipping $2 ($reason): set$4 in the production environment (README 'Continuous deployment')."
    echo "$1=false" >> "$GITHUB_OUTPUT"
    echo "record_$1=false" >> "$GITHUB_OUTPUT"
  else
    echo "Deploying $2: $reason."
    echo "$1=true" >> "$GITHUB_OUTPUT"
    echo "record_$1=true" >> "$GITHUB_OUTPUT"
  fi
}
gcp_missing=$(missing GCP_PROJECT GCP_WORKLOAD_IDENTITY_PROVIDER GCP_DEPLOY_SERVICE_ACCOUNT)
decide firestore "the Firestore rules and indexes" \
  '^(firestore\.rules|firestore\.indexes\.json|firebase\.json)$' "$gcp_missing"
decide parser "the parser" \
  '^(apps/parser/|packages/core/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|tsconfig\.base\.json$|\.dockerignore$|\.gcloudignore$)' \
  "$gcp_missing$(missing GCP_REGION PARSER_IMAGE)"
worker_missing=$(missing CLOUDFLARE_ACCOUNT_ID PARSER_URL)
[ "$HAS_CLOUDFLARE_TOKEN" = true ] || worker_missing="$worker_missing CLOUDFLARE_API_TOKEN"
decide worker "the forwarding Worker" '^apps/inbound/' "$worker_missing"
