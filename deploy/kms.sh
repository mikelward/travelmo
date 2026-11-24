#!/usr/bin/env bash
# Creates the Cloud KMS key the parser seals stored mail credentials with
# (Gmail and Calendar refresh tokens, Fastmail API tokens, IMAP app
# passwords; SPEC "Stored credentials"): a key ring and a symmetric key in the parser's region,
# rotated every 90 days, which only the parser's service account may
# encrypt and decrypt with. Idempotent: rerun after changing a value.
#
#   PROJECT=my-project REGION=us-central1 \
#   PARSER_SA=parser@my-project.iam.gserviceaccount.com deploy/kms.sh
#
# It prints the CREDENTIALS_KMS_KEY value for the parser. A rotation adds a
# key version and keeps the old ones, which still decrypt what they sealed;
# never destroy a version while anything sealed with it is stored. Each
# version costs about $0.06 a month, and calls about $0.03 per 10,000.
set -euo pipefail

: "${PROJECT:?set PROJECT to the Google Cloud project id}"
: "${REGION:?set REGION to the region the parser runs in}"
: "${PARSER_SA:?set PARSER_SA to the service account the parser runs as}"
KEY_RING="${KEY_RING:-travelmo}"
KEY="${KEY:-credentials}"
# In days, such as 90d.
ROTATION_PERIOD="${ROTATION_PERIOD:-90d}"
[[ $ROTATION_PERIOD =~ ^[0-9]+d$ ]] || { echo "ROTATION_PERIOD must be a number of days, such as 90d" >&2; exit 1; }

gcloud="gcloud --project=$PROJECT --quiet"

$gcloud services enable cloudkms.googleapis.com

if ! $gcloud kms keyrings describe "$KEY_RING" --location="$REGION" >/dev/null 2>&1; then
  $gcloud kms keyrings create "$KEY_RING" --location="$REGION"
fi

# The first rotation is one period from now; a rerun keeps the next one
# where it was and changes only the period.
next_rotation=$($gcloud kms keys describe "$KEY" --keyring="$KEY_RING" --location="$REGION" \
  --format='value(nextRotationTime)' 2>/dev/null || true)
if [[ -z $next_rotation ]]; then
  # GNU date, else BSD date (macOS).
  next_rotation=$(date -u -d "+${ROTATION_PERIOD%d} days" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null ||
    date -u -v+"${ROTATION_PERIOD%d}"d +%Y-%m-%dT%H:%M:%SZ)
fi
if $gcloud kms keys describe "$KEY" --keyring="$KEY_RING" --location="$REGION" >/dev/null 2>&1; then
  $gcloud kms keys update "$KEY" --keyring="$KEY_RING" --location="$REGION" \
    --rotation-period="$ROTATION_PERIOD" --next-rotation-time="$next_rotation" >/dev/null
else
  $gcloud kms keys create "$KEY" --keyring="$KEY_RING" --location="$REGION" \
    --purpose=encryption --rotation-period="$ROTATION_PERIOD" \
    --next-rotation-time="$next_rotation"
fi

# On this key alone, not the project: the parser may use no other key, and
# nothing else may use this one.
$gcloud kms keys add-iam-policy-binding "$KEY" --keyring="$KEY_RING" --location="$REGION" \
  --member="serviceAccount:$PARSER_SA" --role=roles/cloudkms.cryptoKeyEncrypterDecrypter >/dev/null

echo "Key $KEY in key ring $KEY_RING ($REGION), rotated every $ROTATION_PERIOD, for $PARSER_SA"
echo "CREDENTIALS_KMS_KEY=projects/$PROJECT/locations/$REGION/keyRings/$KEY_RING/cryptoKeys/$KEY"
