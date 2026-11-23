#!/usr/bin/env bash
# Moves deployed/<part> to this push for each part the plan marked
# record_<part>=true, after CI's Deploy job's deploys all succeeded, so the
# next run measures from here. A tag that can't be moved warns: the part
# deploys again next time, which is safe.
#
# Inputs (environment): AFTER_SHA, GITHUB_REPOSITORY, GH_TOKEN for
# `gh api`, and RECORD_FIRESTORE, RECORD_PARSER, RECORD_WORKER,
# RECORD_SCHEDULER. Tested by
# scripts/deploy_plan_test.py.
set -euo pipefail
record() {
  [ "$2" = true ] || return 0
  if gh api --silent -X PATCH "repos/$GITHUB_REPOSITORY/git/refs/tags/deployed/$1" \
      -f sha="$AFTER_SHA" -F force=true 2>/dev/null \
    || gh api --silent -X POST "repos/$GITHUB_REPOSITORY/git/refs" \
      -f ref="refs/tags/deployed/$1" -f sha="$AFTER_SHA"; then
    echo "deployed/$1 is now $AFTER_SHA."
  else
    echo "::warning::Couldn't move deployed/$1 to $AFTER_SHA; the next run deploys it again."
  fi
}
record firestore "$RECORD_FIRESTORE"
record parser "$RECORD_PARSER"
record worker "$RECORD_WORKER"
record scheduler "$RECORD_SCHEDULER"
