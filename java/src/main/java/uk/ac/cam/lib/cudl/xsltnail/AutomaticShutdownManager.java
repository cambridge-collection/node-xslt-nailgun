package uk.ac.cam.lib.cudl.xsltnail;

import java.util.concurrent.CompletionStage;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.immutables.value.Value;

/**
 * Responsible for terminating the server process when a condition is met.
 *
 * <p>An attempt is made to shutdown the nailgun server and exit cleanly, and if that fails the JVM
 * is instructed to exit anyway.
 */
public interface AutomaticShutdownManager {
  ShutdownManager shutdownManager();

  Consumer<Integer> jvmExitFunction();

  int exitStatus();

  CompletionStage<Void> shutdownCondition();
  /**
   * A string describing the state that has been detected to satisfy the {@link
   * #shutdownCondition()}.
   */
  String shutdownConditionDescription();

  long gracePeriod();

  /**
   * Monitor the shutdown condition and invoke the shutdown manager if met, and exit the JVM if the
   * shutdown manager fails to complete within the grace period.
   */
  CompletionStage<Void> start();

  static AutomaticShutdownManager triggeredByProcessExit(
      ProcessHandle process, ShutdownManager shutdownManager) {
    return DefaultAutomaticShutdownManager.builder()
        .shutdownManager(shutdownManager)
        .shutdownCondition(process.onExit().thenApply(ignored -> null))
        .shutdownConditionDescription(
            String.format("Required process (PID %d) is no longer running", process.pid()))
        .build();
  }

  @Value.Immutable()
  @Value.Style(typeImmutable = "*")
  abstract class AbstractDefaultAutomaticShutdownManager implements AutomaticShutdownManager {
    protected static final Logger LOGGER =
        Logger.getLogger(DefaultAutomaticShutdownManager.class.getName());

    @Value.Default
    @Override
    public Consumer<Integer> jvmExitFunction() {
      return System::exit;
    }

    @Value.Default
    @Override
    public long gracePeriod() {
      return shutdownManager().gracePeriod() + Constants.SHUTDOWN_GRACE_PERIOD;
    }

    @Value.Default
    @Override
    public int exitStatus() {
      return Constants.EXIT_STATUS_AUTOMATIC_SHUTDOWN;
    }

    @Override
    public CompletionStage<Void> start() {
      return shutdownCondition()
          .handleAsync(Values::tryFromValueOrError)
          .thenComposeAsync(
              conditionResult -> {
                conditionResult
                    .onFailure(
                        err ->
                            LOGGER.log(
                                Level.SEVERE,
                                "Proceeding to shutdown as shutdownCondition() completed with an exception:",
                                err))
                    .andThen(
                        () ->
                            LOGGER.log(
                                Level.WARNING,
                                "Automatic shutdown started: {0}",
                                shutdownConditionDescription()));
                return shutdownManager()
                    .shutdown()
                    .toCompletableFuture()
                    .orTimeout(gracePeriod(), TimeUnit.MILLISECONDS);
              })
          .handleAsync(
              (server, e) -> {
                if (e != null) {
                  LOGGER.log(Level.WARNING, "NGServer failed to shutdown, exception follows:", e);
                }
                LOGGER.log(Level.WARNING, "Exiting with status {0}", exitStatus());
                jvmExitFunction().accept(exitStatus());
                return null;
              });
    }
  }
}
