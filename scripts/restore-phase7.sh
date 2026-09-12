#!/usr/bin/env bash
set -euo pipefail
# Restores scripts/phase7-upload.js from the last known-good commit (1fc37a64)
# then the near-black thumbnail changes can be re-applied in a follow-up.

GOOD_SHA="1fc37a64a976a7faab324e3328f6ff9bcf92c0a6"
TARGET="scripts/phase7-upload.js"

echo "[restore] Checking out $TARGET from $GOOD_SHA"
git show "${GOOD_SHA}:${TARGET}" > "${TARGET}"
echo "[restore] Restored $(wc -c < "${TARGET}") bytes"
