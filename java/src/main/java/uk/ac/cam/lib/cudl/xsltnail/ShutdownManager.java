package uk.ac.cam.lib.cudl.xsltnail;

import com.facebook.nailgun.NGServer;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Function;
import org.immutables.value.Value;

public interface ShutdownManager {
  long gracePeriod();

  NGServer server();

  /**
   * Instruct the server to shutdown, returning immediately with a future which resolves to the
   * shutdown server, or fails with a {@link}{@link TimeoutException}.
   */
  CompletionStage<NGServer> shutdown();

  @Value.Immutable()
  @Value.Style(typeImmutable = "*")
  abstract class AbstractDefaultShutdownManager implements ShutdownManager {
    @Value.Default
    @Override
    public long gracePeriod() {
      return Constants.SHUTDOWN_GRACE_PERIOD;
    }

    @Value.Default
    public long pollInterval() {
      return 100;
    }

    @Value.Default
    public ScheduledExecutorService scheduledExecutorService() {
      return new ScheduledThreadPoolExecutor(
          1,
          // Use daemon threads to avoid the executor keeping the JVM running
          r -> {
            Thread t = new Thread(r);
            t.setDaemon(true);
            t.setName(AbstractDefaultShutdownManager.class.getName() + "#scheduledExecutorService");
            return t;
          });
    }

    @Value.Check
    protected void checkState() {
      if (gracePeriod() < 0)
        throw new IllegalStateException("gracePeriod cannot be negative: " + gracePeriod());
    }

    @Value.Lazy
    CompletableFuture<Void> onShutdown() {
      final CompletableFuture<Void> onShutdown = new CompletableFuture<>();
      onShutdown.orTimeout(gracePeriod(), TimeUnit.MILLISECONDS);

      final ScheduledFuture<?> serverStatusPoller =
          scheduledExecutorService()
              .scheduleAtFixedRate(
                  () -> {
                    if (!server().isRunning()) {
                      onShutdown.complete(null);
                    }
                  },
                  0,
                  pollInterval(),
                  TimeUnit.MILLISECONDS);
      onShutdown.whenComplete((ignored, err) -> serverStatusPoller.cancel(true));

      server().shutdown();

      return onShutdown
          .thenApply(ignored -> CompletableFuture.completedFuture((Void) null))
          .exceptionally(
              timeout ->
                  CompletableFuture.failedFuture(
                      new TimeoutException(
                          String.format(
                              "NGServer failed to shutdown cleanly within %dms grace period",
                              gracePeriod()))))
          .thenCompose(Function.identity());
    }

    @Override
    public CompletableFuture<NGServer> shutdown() {
      return onShutdown().thenApply(ignored -> server());
    }
  }
}
