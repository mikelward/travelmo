#!/usr/bin/env bash
# Runs the app's instrumented tests (app/src/androidTest) against the
# Firestore and Auth emulators, on whatever Android emulator or device adb
# sees. Meant to run under the Firebase emulators, from the repository root:
#
#   pnpm --filter @travelmo/rules exec firebase emulators:exec \
#     --only firestore,auth --project demo-travelmo --config ../../firebase.json \
#     ../../apps/android/scripts/connected-tests.sh
#
# The rules read `email_verified` for a sharee, and a custom token cannot
# carry an email, so two users with verified addresses are seeded through
# the Auth emulator's REST API first; the tests sign in as them by password.
# CI's android-emulator job runs exactly this (.github/workflows/ci.yml).
set -euo pipefail

auth=${AUTH_EMULATOR_URL:-http://localhost:9099}/identitytoolkit.googleapis.com/v1
password=travelmo-test

seed_user() {
  local email=$1
  local response local_id
  response=$(curl -sS -X POST "$auth/accounts:signUp?key=fake" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$password\",\"returnSecureToken\":true}")
  if printf '%s' "$response" | grep -q EMAIL_EXISTS; then
    # Seeded by an earlier run against a long-lived emulator: sign in to
    # learn the id, then mark it verified again (idempotent).
    response=$(curl -sS -X POST "$auth/accounts:signInWithPassword?key=fake" -H 'Content-Type: application/json' \
      -d "{\"email\":\"$email\",\"password\":\"$password\",\"returnSecureToken\":true}")
  fi
  local_id=$(printf '%s' "$response" | python3 -c 'import json, sys; print(json.load(sys.stdin)["localId"])')
  # The emulator takes any bearer as the project owner.
  curl -sS -o /dev/null -X POST "$auth/accounts:update?key=fake" -H 'Content-Type: application/json' -H 'Authorization: Bearer owner' \
    -d "{\"localId\":\"$local_id\",\"emailVerified\":true}"
  echo "seeded $email"
}

seed_user owner@example.com
seed_user sharee@example.com

cd "$(dirname "$0")/.."
exec ./gradlew -PtravelmoFixedVersion :app:connectedDebugAndroidTest "$@"
