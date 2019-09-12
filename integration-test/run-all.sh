#!/usr/bin/env bash
set -euo pipefail
DIR="$(readlink -f "$(dirname "${BASH_SOURCE[0]}")")"
cd "$DIR"
npm uninstall --no-save @lib.cam/xslt-nailgun
npm install
npm run integration-test
