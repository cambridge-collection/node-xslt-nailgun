#!/usr/bin/env bats

@test "binary test" {
  node jvmpin-binary-test.js
}

@test "event duplicity" {
  node jvmpin-event-duplicity-test.js
}

@test "ignored stdin" {
  node jvmpin-ignored-stdin-test.js
}

@test "multiple spawn" {
  node jvmpin-multiple-spawn-test.js
}

@test "roundtrip 1" {
  echo hi | node jvmpin-multiple-spawn-test.js
}

@test "roundtrip 2" {
  head -c 10M /dev/urandom | node jvmpin-multiple-spawn-test.js
}

@test "interactive prompt" {
  result="$(printf 'Bob\nto build things\n' | node jvmpin-ng --port "$NG_1_X_PORT" io.foldr.ngtesthost.Prompt | tail -n 1)"
  [[ "$result" = '> Your name is Bob and your quest is to build things' ]]
}

@test "premature termination with kill()" {
    node jvmpin-kill-test.js
}

@test "stream backpressure / memory usage - stdin w/ on-demand writes" {
  export NG_PORT=$NG_1_X_PORT
  backpressureTest --stream stdout --stdin-policy once-per-request
}

@test "stream backpressure / memory usage - stderr w/ on-demand writes" {
  export NG_PORT=$NG_1_X_PORT
  backpressureTest --stream stderr --stdin-policy once-per-request
}

@test "stream backpressure / memory usage - stdin w/ proactive writes" {
  export NG_PORT=$NG_0_9_1_PORT
  backpressureTest --stream stdout --stdin-policy all-after-request
}

@test "stream backpressure / memory usage - stderr w/ proactive writes" {
  export NG_PORT=$NG_0_9_1_PORT
  backpressureTest --stream stderr --stdin-policy all-after-request
}

backpressureTest() {
# Set an upper limit of 1GB in case
  let "mem_limit = 1024 * 1024 * 2"  # 2GB
  ulimit -v "$mem_limit"

  node --expose-gc jvmpin-backpressure-test.js $@
}

PID_FILE="$BATS_TMPDIR/test.bats.pid"
NAILGUN_SERVER_JAR="$BATS_TEST_DIRNAME/ng-testhost/target/ng-testhost.jar"
NG_0_9_1_PORT=2114
NG_1_X_PORT=2115

startNailgunServer() {
    local PORT="$1"
    local MAIN_CLASS="$2"

    local FIFO="$(mktemp -u)"
    mkfifo "$FIFO"

    java -cp "$NAILGUN_SERVER_JAR" "$MAIN_CLASS" "$PORT" >"$FIFO" &
    local PID=$!
    timeout 3 grep --files-with-match --quiet --perl-regexp '^NGServer \d+\.\d+\.\d+ started ' <"$FIFO" || \
        (kill "$PID" && echo "*** Error: nailgun server failed to start" >&2 && return 1) && \
    rm "$FIFO" && \
    echo "$PID"
}
setupFile() {
    echo -n '' > "$PID_FILE"
    NG_0_9_1_PID="$(startNailgunServer "$NG_0_9_1_PORT" "com.martiansoftware.nailgun.NGServer")"
    NG_1_X_PID="$(startNailgunServer "$NG_1_X_PORT" "com.facebook.nailgun.NGServer")"

    printf "%s\t%s" "$NG_1_X_PID" "$NG_0_9_1_PID" > "$PID_FILE"
    printf "Started nailgun servers; 1.X on port: %s, PID: %s; 0.9.1 on port: %s, PID: %s\n" \
        "$NG_1_X_PORT" "$NG_1_X_PID" "$NG_0_9_1_PORT" "$NG_0_9_1_PID"
}

teardownFile() {
    local NG_0_9_1_PID="$(head -n 1 "$PID_FILE" | cut -f 1)"
    local NG_1_X_PID="$(head -n 1 "$PID_FILE" | cut -f 2)"
    killQuiet "$NG_0_9_1_PID" "$NG_1_X_PID"
}
trap teardownFile SIGINT SIGTERM

killQuiet() {
    kill $@ 2>&1 >/dev/null
}
setup() {
    if [[ ! -f "$NAILGUN_SERVER_JAR" ]]; then
        echo "*** Nailgun server .jar does not exist; has the ng-testhost maven project been built?"
        false
    fi

    if [ "$BATS_TEST_NUMBER" -eq 1 ]; then
        setupFile
    fi

    # Default server port for tests to connect to
    export NG_PORT=$NG_1_X_PORT
}

teardown() {
    if [ "$BATS_TEST_NUMBER" -eq ${#BATS_TEST_NAMES[@]} ]; then
        teardownFile
    fi
}
