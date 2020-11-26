IS_BB_PIPELINES="$(env | grep -q '^BITBUCKET_' && echo true || true)"

@test "keep-alive timeout does stop node from terminating" {
  # keep-alive is 60s, the transform will typically take ~1s start to finish due
  # to JVM startup. The process should exit as soon as it's done, it shouldn't
  # wait for the 60s to elapse.
  timeout 5 node keep-alive-termination.js
}

get_child_pid() {
  for _ in {1..10} ; do
    CHILD="$(pgrep -P "$1")"
    if [[ "$CHILD" ]]; then
        echo $CHILD
        return
    fi
    sleep 0.1
  done
  echo "Failed to find child PID" 1>&2
  return 1
}

wait_for_nailgun_server_exit() {
  CHILD_PID="$1"
  # It can take a short time for the child to actually die
  for _ in {1..10} ; do
    status="$(ps -p "$CHILD_PID" -o stat= || true)"
    # the child should not be running
    if [[ "$status" = "" ]] ; then
      return
    # Note that Bitbucket Pipelines fails to reap orphaned child processes, so treat zombie (Z) state
    # processes as terminated: https://getsupport.atlassian.com/servicedesk/customer/portal/11/BBS-116725
    elif [[ $IS_BB_PIPELINES = true && "$status" = "Z" ]]; then
      return
    fi
    sleep 0.1
  done
  echo "child $CHILD_PID is still alive"
  false
}

@test "nailgun server process does not leak when executor is not closed" {
  node process-leak.js &
  PID=${!}
  CHILD_PID="$(get_child_pid "$PID")"
  [[ "$CHILD_PID" ]]
  echo "PID: $PID, CHILD_PID: $CHILD_PID"
  wait $PID

  wait_for_nailgun_server_exit "$CHILD_PID"
}

@test "nailgun server process does not leak when node process is forcibly killed " {
  node run-nailgun-server.js &
  PID=${!}
  CHILD_PID="$(get_child_pid "$PID")"
  [[ "$CHILD_PID" ]]
  echo "PID: $PID, CHILD_PID: $CHILD_PID"

  # kill the node process. It won't be able to shutdown the nailgun server itself, but the server
  # should realise the node proess has terminated and shut itself down.
  kill -9 "$PID"

  wait_for_nailgun_server_exit "$CHILD_PID"
}
