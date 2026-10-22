#!/bin/sh
# User-run only. Fill non-secret IDs; inject the API key through SecretStash.
# The deployment record and its receipt must already pass gamefield-study verify.
set -eu
: "${GAMEFIELD_IMAGE:?Supply registry/name@sha256:digest}"
: "${GAMEFIELD_PROFILE:?Supply your reviewed cloud profile}"
: "${GAMEFIELD_SUBNET:?Supply the Job subnet ID}"
: "${GAMEFIELD_FILESYSTEM:?Supply a verified shared-filesystem ID}"
: "${GAMEFIELD_SECRET:?Supply the SecretStash selector, never the key}"
: "${GAMEFIELD_STAGE:?Use engineering or final}"
case "$GAMEFIELD_IMAGE" in *@sha256:*) ;; *) exit 2 ;; esac
case "$GAMEFIELD_STAGE" in
  engineering) GAMEFIELD_COMMAND=check-provider; GAMEFIELD_TIMEOUT=2h ;;
  final) GAMEFIELD_COMMAND=run; GAMEFIELD_TIMEOUT=36h ;;
  *) exit 2 ;;
esac
nebius --profile "$GAMEFIELD_PROFILE" ai job create \
  --name "gamefield-$GAMEFIELD_STAGE" \
  --image "$GAMEFIELD_IMAGE" \
  --container-command gamefield-study \
  --args "$GAMEFIELD_COMMAND /evidence/$GAMEFIELD_STAGE-plan/plan.json --deployment /evidence/$GAMEFIELD_STAGE-plan/deployment.json --durable-mount /evidence" \
  --platform cpu-d3 --preset 2vcpu-8gb --disk-size 20Gi \
  --timeout "$GAMEFIELD_TIMEOUT" --restart-policy never \
  --volume "$GAMEFIELD_FILESYSTEM:/evidence:rw" \
  --subnet-id "$GAMEFIELD_SUBNET" \
  --env-secret "NEBIUS_API_KEY=$GAMEFIELD_SECRET"
