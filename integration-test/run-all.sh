#!/usr/bin/env bash
set -euo pipefail
NO_INSTALL="$(printf '%s\n' "$@" | grep '^--no-install$' || true)"
DIR="$(readlink -f "$(dirname "${BASH_SOURCE[0]}")")"

cd "$DIR"

if [[ ! $NO_INSTALL ]]; then
  ./link-local-build.sh
  npm uninstall --no-save @lib.cam/xslt-nailgun
  npm install
fi

if [[ ${CI:-} = true ]]; then
  mkdir -p test-reports

  set +e
  node_modules/.bin/bats integration-tests.bats | tee test-reports/bats.tap
  STATUS=$?
  set -e

  # bats outputs test output as TAP comments; turn these comments into regular
  # output so that it shows up in the xunit XML file and gets reported in
  # pipelines.
  sed -e 's/^# / /g' < test-reports/bats.tap | node_modules/.bin/tap-xunit > test-reports/bats.xml
  exit $STATUS
else
  node_modules/.bin/bats integration-tests.bats
fi
