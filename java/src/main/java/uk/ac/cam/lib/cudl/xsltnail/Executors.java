package uk.ac.cam.lib.cudl.xsltnail;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;

public final class Executors {
  private Executors() {}

  /**
   * Shutdown a list of ExecutorServices.
   *
   * <p>Each is instructed to shutdown() and then given until the timeout to comply. Any remaining
   * non-shutdown executors are then shutdownNow().
   */
  public static void awaitTermination(long timeout, ExecutorService... executorServices) {
    for (ExecutorService es : executorServices) es.shutdown();

    Set<ExecutorService> alive = new HashSet<>(Arrays.asList(executorServices));

    long start = System.currentTimeMillis();
    boolean interrupted = false;
    while (alive.size() > 0) {
      long now = System.currentTimeMillis();
      if (now >= start + timeout) break;
      ExecutorService es = alive.iterator().next();
      try {
        es.awaitTermination((start + timeout) - now, TimeUnit.MILLISECONDS);
      } catch (InterruptedException e) {
        interrupted = true;
      }
      if (es.isTerminated()) alive.remove(es);
      if (interrupted) break;
    }

    for (ExecutorService es : alive) {
      es.shutdownNow();
    }
  }
}
