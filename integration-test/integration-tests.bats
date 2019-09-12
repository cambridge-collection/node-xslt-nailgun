@test "keep-alive timeout does stop node from terminating" {
  # keep-alive is 60s, the transform will typically take ~1s start to finish due
  # to JVM startup. The process should exit as soon as it's done, it shouldn't
  # wait for the 60s to elapse.
  timeout 5 node keep-alive-termination.js
}

@test "nailgun server process does not leak when executor is not closed" {
  get_child_pid() {
    for _ in {1..10} ; do
      CHILD="$(pgrep --parent "$1")"
      if [[ "$CHILD" ]]; then
          echo $CHILD
          return
      fi
      sleep 0.1
    done
    echo "Failed to find child PID" 1>&2
    return 1
  }

  node process-leak.js &
  PID=${!}
  CHILD_PID="$(get_child_pid "$PID")"
  [[ "$CHILD_PID" ]]
  echo "PID: $PID, CHILD_PID: $CHILD_PID"
  wait $PID

  # It can take a short time for the child to actually die
  for _ in {1..10} ; do
    run kill -0 $CHILD_PID
    # the child should not be running
    if [[ "$status" -eq 1 ]] ; then
      return
    fi
    sleep 0.1
  done
  echo "child $CHILD_PID is still alive"
  false
}
