#!/usr/bin/env bash
set -euo pipefail
DIR=$(dirname "${BASH_SOURCE[0]}")

if [[ ! -f "$DIR/ng-testhost/target/ng-testhost.jar" ]]; then
  echo "*** ng-testhost.jar does not exist, building it..."
  mvn --batch-mode --file "$DIR/ng-testhost/pom.xml" clean package
fi

(cd "$DIR" && "../node_modules/.bin/bats" "test.bats")
