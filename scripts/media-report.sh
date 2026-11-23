#!/bin/sh
set -eu

project_dir=$(cd "$(dirname "$0")/.." && pwd)
docker compose run --rm --no-deps -T \
  -v "$project_dir/scripts/media-report.mjs:/tmp/media-report.mjs:ro" \
  --entrypoint node homework /tmp/media-report.mjs
