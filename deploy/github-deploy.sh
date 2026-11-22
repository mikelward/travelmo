#!/usr/bin/env bash
# Lets ci.yml's deploy job act on the project with no stored key: a deployer
# service account, a Workload Identity pool and GitHub OIDC provider that
# accept only this repository's ci.yml running on main, the right to
# impersonate the deployer for that repository alone, a bucket for Cloud
# Build's source uploads, and the fewest roles the deploys need. Idempotent:
# rerun after changing a value.
#
#   PROJECT=my-project REGION=us-central1 REPO=owner/name \
#   PARSER_SA=parser@my-project.iam.gserviceaccount.com deploy/github-deploy.sh
#
# PARSER_SA is the service account the parser runs as (README "Deploy",
# step 2): Cloud Run lets a deploy keep it only if the deployer may act as it.
# It prints the variables to set in the repository's `production`
# environment (README "Continuous deployment").
set -euo pipefail

: "${PROJECT:?set PROJECT to the Google Cloud project id}"
: "${REGION:?set REGION to the region the parser runs in}"
: "${REPO:?set REPO to the GitHub repository, as owner/name}"
: "${PARSER_SA:?set PARSER_SA to the service account the parser runs as}"
DEPLOYER="${DEPLOYER:-github-deployer}"
POOL="${POOL:-github}"
PROVIDER="${PROVIDER:-github}"
# Bucket names are global; set SOURCE_BUCKET if this one is taken, and the
# GCP_SOURCE_BUCKET variable to match.
SOURCE_BUCKET="${SOURCE_BUCKET:-$PROJECT-deploy-source}"
AR_REPOSITORY="${AR_REPOSITORY:-travelmo}"

gcloud="gcloud --project=$PROJECT --quiet"
DEPLOYER_SA="$DEPLOYER@$PROJECT.iam.gserviceaccount.com"

$gcloud services enable iam.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com cloudbuild.googleapis.com run.googleapis.com \
  artifactregistry.googleapis.com firebaserules.googleapis.com \
  firestore.googleapis.com logging.googleapis.com

if ! $gcloud iam service-accounts describe "$DEPLOYER_SA" >/dev/null 2>&1; then
  $gcloud iam service-accounts create "$DEPLOYER" \
    --display-name="Deploys from GitHub Actions ($REPO)"
fi

# The pool and its provider. GitHub's token names the repository, the ref,
# and the workflow file it came from; the provider refuses every token but
# one from ci.yml on main of this repository. Requiring the workflow file as
# well as the ref keeps out the repository's other workflows that also run
# with main's context, such as those triggered by pull_request_target.
if ! $gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1; then
  $gcloud iam workload-identity-pools create "$POOL" --location=global \
    --display-name="GitHub Actions"
fi
provider_args=(
  --location=global
  --workload-identity-pool="$POOL"
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.workflow_ref=assertion.workflow_ref"
  --attribute-condition="assertion.repository == '$REPO' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == '$REPO/.github/workflows/ci.yml@refs/heads/main'"
)
if $gcloud iam workload-identity-pools providers describe "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  $gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" "${provider_args[@]}"
else
  $gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" "${provider_args[@]}" \
    --display-name="GitHub" --issuer-uri="https://token.actions.githubusercontent.com"
fi

PROJECT_NUMBER=$($gcloud projects describe "$PROJECT" --format='value(projectNumber)')
POOL_ID="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL"
$gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/$POOL_ID/attribute.repository/$REPO" >/dev/null

# Cloud Build's source uploads land here rather than in the default
# <project>_cloudbuild bucket, whose ownership check needs the right to list
# every bucket in the project. A week is long enough to look at a failed
# build's source.
if ! $gcloud storage buckets describe "gs://$SOURCE_BUCKET" >/dev/null 2>&1; then
  $gcloud storage buckets create "gs://$SOURCE_BUCKET" --location="$REGION" \
    --uniform-bucket-level-access --public-access-prevention
fi
lifecycle=$(mktemp)
trap 'rm -f "$lifecycle"' EXIT
printf '%s\n' '{"rule": [{"action": {"type": "Delete"}, "condition": {"age": 7}}]}' > "$lifecycle"
$gcloud storage buckets update "gs://$SOURCE_BUCKET" --lifecycle-file="$lifecycle" >/dev/null
$gcloud storage buckets add-iam-policy-binding "gs://$SOURCE_BUCKET" \
  --member="serviceAccount:$DEPLOYER_SA" --role=roles/storage.admin >/dev/null

# The project-level roles:
#   cloudbuild.builds.editor       start the parser's build
#   serviceusage.serviceUsageConsumer  call the project's APIs as it
#   logging.viewer                 stream the build's log (cloudbuild.yaml
#                                  logs to Cloud Logging only)
#   run.developer                  deploy a new revision; no IAM changes
#   firebaserules.admin            release firestore.rules
#   datastore.indexAdmin           deploy firestore.indexes.json
# The image is pushed by Cloud Build's own service account, as in a deploy
# by hand; the deployer only reads it (below).
for role in roles/cloudbuild.builds.editor roles/serviceusage.serviceUsageConsumer \
    roles/logging.viewer roles/run.developer roles/firebaserules.admin \
    roles/datastore.indexAdmin; do
  $gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$DEPLOYER_SA" --role="$role" --condition=None >/dev/null
done

# Cloud Run reads the image a revision names as the deployer, so it may read
# the parser's image repository (and no other).
$gcloud artifacts repositories add-iam-policy-binding "$AR_REPOSITORY" --location="$REGION" \
  --member="serviceAccount:$DEPLOYER_SA" --role=roles/artifactregistry.reader >/dev/null
# A new revision runs as the parser's service account, and a build runs as
# the project's default Cloud Build service account (the Compute Engine
# default in projects made since 2024), so the deployer may act as those
# two; it may act as no other. The workflow names no build account, so its
# builds run as the project's default; read it here rather than guess.
BUILD_SA=$($gcloud builds get-default-service-account --format='value(serviceAccountEmail)')
BUILD_SA="${BUILD_SA##*/}"
# The legacy Cloud Build account (<number>@cloudbuild.gserviceaccount.com) is
# Google-owned and takes no IAM bindings; submitting builds as it needs none.
sas=("$PARSER_SA")
case "$BUILD_SA" in
  *@cloudbuild.gserviceaccount.com) echo "Builds run as the legacy Cloud Build account $BUILD_SA, which needs no binding." ;;
  *) sas+=("$BUILD_SA") ;;
esac
for sa in "${sas[@]}"; do
  $gcloud iam service-accounts add-iam-policy-binding "$sa" \
    --member="serviceAccount:$DEPLOYER_SA" --role=roles/iam.serviceAccountUser >/dev/null
done

echo "Deployer $DEPLOYER_SA, impersonable from $REPO's ci.yml on main; acts as $PARSER_SA and $BUILD_SA"
echo "GCP_PROJECT=$PROJECT"
echo "GCP_REGION=$REGION"
echo "GCP_WORKLOAD_IDENTITY_PROVIDER=$POOL_ID/providers/$PROVIDER"
echo "GCP_DEPLOY_SERVICE_ACCOUNT=$DEPLOYER_SA"
echo "GCP_SOURCE_BUCKET=$SOURCE_BUCKET"
echo "PARSER_IMAGE=$REGION-docker.pkg.dev/$PROJECT/$AR_REPOSITORY/parser"
