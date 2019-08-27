#!/usr/bin/env bash
set -euo pipefail

get_local_build() {
  find "$DIR"/../build/ -type f -name 'lib.cam-xslt-nailgun-*.tgz' | head -n 1
}

run_example() {
  printf "\n%s\n%s\n" "$1" "$SEPARATOR"
  NODE_PATH="$TMP_DIR/node_modules" node "$DIR/$1"
}

SEPARATOR="────────────────────────────────────────────────────────────────────────────────"
DIR="$(readlink -f "$(dirname "${BASH_SOURCE[0]}")")"
LOCAL_BUILD="$(get_local_build)"
if [[ ! -f "$LOCAL_BUILD" ]]; then
  echo "No package found in $DIR/build/, running make ..."
  make -c "$DIR" > /dev/null
fi
LOCAL_BUILD="$(get_local_build)"

TMP_DIR="$(mktemp -d)"
printf "Installing %s under %s ...\n" "$LOCAL_BUILD" "$TMP_DIR"

cd "$TMP_DIR"
npm install "$LOCAL_BUILD" > /dev/null

run_example "multiple-transforms.js"
run_example "single-transform.js"
run_example "single-transform-no-async.js"
run_example "single-transform-no-promises.js"

cd "$DIR"
rm -r "$TMP_DIR"
