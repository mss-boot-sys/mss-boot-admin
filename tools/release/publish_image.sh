#!/usr/bin/env bash
set -euo pipefail
component=${1:?root or frontend required}
[[ "${GITHUB_SHA}" =~ ^[0-9a-f]{40}$ ]]
[[ "${RELEASE_VERSION}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
image="${REGISTRY}/${IMAGE_NAME}:${RELEASE_VERSION}"
case "${component}" in
  root) context=.; dockerfile=Dockerfile ;;
  frontend) context=web/antd-v6; dockerfile=web/antd-v6/Dockerfile ;;
  *) echo 'unsupported image component' >&2; exit 1 ;;
esac
# Resolve the public identity first. Authentication/network failures never mean absent.
error_file="$(mktemp)"
trap 'rm -f "${error_file}"' EXIT
if docker buildx imagetools inspect "${image}" --raw > /dev/null 2>"${error_file}"; then
  # Reruns may reconcile the already published exact source; never push over it.
  docker buildx imagetools inspect "${image}" --format '{{json .Image}}' > "${RUNNER_TEMP}/image-configs.json"
  jq -e --arg version "${RELEASE_VERSION}" --arg commit "${GITHUB_SHA}" '
    .["linux/amd64"].config.Labels["org.opencontainers.image.version"] == $version and
    .["linux/arm64"].config.Labels["org.opencontainers.image.version"] == $version and
    .["linux/amd64"].config.Labels["org.opencontainers.image.revision"] == $commit and
    .["linux/arm64"].config.Labels["org.opencontainers.image.revision"] == $commit
  ' "${RUNNER_TEMP}/image-configs.json" >/dev/null
else
  if ! grep -Eqi 'manifest unknown|not found' "${error_file}"; then
    echo 'image absence could not be verified; refusing to push' >&2
    exit 1
  fi
  docker buildx build --file "${dockerfile}" --platform linux/amd64,linux/arm64 \
    --build-arg "VERSION=${RELEASE_VERSION}" --build-arg "COMMIT=${GITHUB_SHA}" \
    --label "org.opencontainers.image.source=https://github.com/${GITHUB_REPOSITORY}" \
    --label "org.opencontainers.image.version=${RELEASE_VERSION}" \
    --label "org.opencontainers.image.revision=${GITHUB_SHA}" \
    --tag "${image}" --provenance=true --sbom=true --push "${context}"
fi
docker buildx imagetools inspect "${image}" --raw | jq -e '
  [.manifests[].platform | select(.os == "linux") | .architecture] | sort == ["amd64","arm64"]
' >/dev/null
