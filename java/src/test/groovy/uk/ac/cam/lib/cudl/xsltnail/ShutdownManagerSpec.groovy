package uk.ac.cam.lib.cudl.xsltnail

import com.facebook.nailgun.NGServer
import spock.lang.Specification

import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

class ShutdownManagerSpec extends Specification {
  def "shutdown() shuts down server after polling twice"() {
    given:
    def server = Mock(NGServer) {
      1 * shutdown()
      3 * isRunning() >>> [true, true, false]
    }
    def shutdownManager = DefaultShutdownManager.builder()
      .server(server)
      .gracePeriod(200)
      .pollInterval(50)
      .build()
    when:
    def onShutdown = shutdownManager.shutdown()

    then:
    onShutdown.get(400, TimeUnit.MILLISECONDS) == server
  }

  def "shutdown() shuts down server after polling once"() {
    given:
    def server = Mock(NGServer) {
      1 * shutdown()
      1 * isRunning() >> false
    }
    def shutdownManager = DefaultShutdownManager.builder()
      .server(server)
      .gracePeriod(200)
      .pollInterval(50)
      .build()
    when:
    def onShutdown = shutdownManager.shutdown()

    then:
    onShutdown.get(400, TimeUnit.MILLISECONDS) == server
  }

  def "shutdown() future resolves with timeout when server fails to shutdown"() {
    given:
    def server = Mock(NGServer) {
      1 * shutdown()
      (10.._) * isRunning() >> true
    }
    def shutdownManager = DefaultShutdownManager.builder()
      .server(server)
      .gracePeriod(100)
      .pollInterval(5)
      .build()
    when:
    def onShutdown = shutdownManager.shutdown()
    onShutdown.get(200, TimeUnit.MILLISECONDS)

    then:
    def err = thrown(ExecutionException)
    onShutdown.isCompletedExceptionally()
    err.cause instanceof TimeoutException
    err.cause.message == "NGServer failed to shutdown cleanly within 100ms grace period"
  }
}
