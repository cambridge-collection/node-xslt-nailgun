#!/usr/bin/env bash
set -euo pipefail
DIR="$(readlink -f "$(dirname "${BASH_SOURCE[0]}")")"
PACKAGE_PATTERN='lib.cam-xslt-nailgun-*.tgz'

get_local_build() {
  find "$DIR"/../build/ -type f -name "$PACKAGE_PATTERN" | head -n 1
}

PACKAGE_PATH="$(get_local_build)"
if [[ ! -f "$PACKAGE_PATH" ]]; then
    echo "Error: '$PACKAGE_PATTERN' not found in build dir (has make been run?)" 1>&2
    exit 1
fi
RELATIVE_PACKAGE_PATH="$(realpath --relative-to "$DIR" "$PACKAGE_PATH")"
echo "@lib.cam/xslt-nailgun will be installed from $RELATIVE_PACKAGE_PATH"
ln -sf "$RELATIVE_PACKAGE_PATH" "${DIR}/lib.cam-xslt-nailgun-current.tgz"
