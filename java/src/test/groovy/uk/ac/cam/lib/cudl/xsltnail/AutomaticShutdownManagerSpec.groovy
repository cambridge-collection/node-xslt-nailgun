package uk.ac.cam.lib.cudl.xsltnail

import com.facebook.nailgun.NGServer
import spock.lang.Specification

import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.function.Consumer
import java.util.logging.Handler
import java.util.logging.Logger

class AutomaticShutdownManagerSpec extends Specification {
  def logHandler = Mock(Handler) {
    0 * publish(_)
  }
  def shutdownManager = Mock(ShutdownManager)
  def shutdownCondition = new CompletableFuture()
  Consumer<Integer> jvmExitFunction = Mock(Consumer)
  int exitStatus = 1234
  def asmBuilder = DefaultAutomaticShutdownManager.builder()
    .shutdownManager(shutdownManager)
    .jvmExitFunction(jvmExitFunction)
    .exitStatus(exitStatus)
    .shutdownCondition(shutdownCondition)
    .shutdownConditionDescription("Test condition triggered")
    .gracePeriod(100)

  def setup() {
    def logger = Logger.getLogger(DefaultAutomaticShutdownManager.class.getName());
    logger.addHandler(logHandler)
    logger.setUseParentHandlers(false) // suppress log output from tests

  }

  def cleanup() {
    def logger = Logger.getLogger(DefaultAutomaticShutdownManager.class.getName())
    logger.removeHandler(logHandler)
    logger.setUseParentHandlers(true)
  }

  def "triggeredByProcessExit() factory returns object with expected properties"() {
    given:
    def onExitFuture = Mock(CompletableFuture)
    def procHandle = Mock(ProcessHandle) {
      1 * pid() >> 1234
      1 * onExit() >> onExitFuture
    }
    when:
    def asm = AutomaticShutdownManager.triggeredByProcessExit(procHandle, shutdownManager)
    then:
    1 * onExitFuture.thenApply(_) >> onExitFuture
    0 * onExitFuture._
    asm.shutdownManager() == shutdownManager
    asm.shutdownCondition() == onExitFuture
    asm.shutdownConditionDescription() == "Required process (PID 1234) is no longer running"
  }

  def "shutdownManager is invoked once shutdownCondition is met"() {
    given:
    def asm = asmBuilder.build()

    // The asm doesn't call shutdown until the shutdown condition is triggered
    when:
    def onShutdown = asm.start().toCompletableFuture()
    onShutdown.get(10, TimeUnit.MILLISECONDS)
    then:
    thrown(TimeoutException)
    0 * shutdownManager.shutdown()
    0 * jvmExitFunction.accept(_)

    // The asm proceeds to shutdown after the condition is triggered
    when:
    shutdownCondition.complete(null)
    onShutdown.get(100, TimeUnit.MILLISECONDS)
    then:
    1 * shutdownManager.shutdown() >> CompletableFuture.completedFuture(Mock(NGServer))
    1 * jvmExitFunction.accept(exitStatus)
    1 * logHandler.publish({ it.message == "Automatic shutdown started: {0}" })
  }

  def "jvmExitFunction is called if shutdownCondition fails"() {
    given:
    def asm = asmBuilder.build()
    when:
    def onAutomaticShutdown = asm.start().toCompletableFuture()
    shutdownCondition.completeExceptionally(new RuntimeException())
    onAutomaticShutdown.get(100, TimeUnit.MILLISECONDS)
    then:
    1 * shutdownManager.shutdown() >> CompletableFuture.completedFuture(null)
    1 * jvmExitFunction.accept(exitStatus)
    1 * logHandler.publish({ it.message == "Proceeding to shutdown as shutdownCondition() completed with an exception:" })
  }

  def "jvmExitFunction is called if shutdownManager.shutdown() fails"() {
    given:
    def asm = asmBuilder.build()
    when:
    def onAutomaticShutdown = asm.start().toCompletableFuture()
    shutdownCondition.complete(null)
    onAutomaticShutdown.get(10, TimeUnit.MILLISECONDS)
    then:
    1 * shutdownManager.shutdown() >> CompletableFuture.failedFuture(new RuntimeException())
    1 * jvmExitFunction.accept(exitStatus)
    1 * logHandler.publish({ it.message == "Automatic shutdown started: {0}" })
    1 * logHandler.publish({ it.message == "NGServer failed to shutdown, exception follows:" })
  }

  def "jvmExitFunction is called if shutdownManager.shutdown() does not complete in grace period"() {
    given:
    def asm = asmBuilder.build()
    when:
    def onAutomaticShutdown = asm.start().toCompletableFuture()
    shutdownCondition.complete(null)
    onAutomaticShutdown.get(1, TimeUnit.SECONDS)
    then:
    1 * shutdownManager.shutdown() >> new CompletableFuture() // does not get resolved
    1 * jvmExitFunction.accept(exitStatus)
    1 * logHandler.publish({ it.message == "Automatic shutdown started: {0}" })
    1 * logHandler.publish({ it.message == "NGServer failed to shutdown, exception follows:" })
  }
}
