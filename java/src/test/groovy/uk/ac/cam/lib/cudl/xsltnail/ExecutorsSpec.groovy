package uk.ac.cam.lib.cudl.xsltnail

import spock.lang.Specification

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ExecutorsSpec extends Specification {
    def "awaitTermination() shuts down executors"() {
        given:
        def a = java.util.concurrent.Executors.newFixedThreadPool(1)
        def b = java.util.concurrent.Executors.newFixedThreadPool(1)

        expect:
        !a.isShutdown()
        !b.isShutdown()

        when:
        Executors.awaitTermination(5, a, b)

        then:
        a.isShutdown()
        a.isTerminated()
        b.isShutdown()
        b.isTerminated()
    }

    def "awaitTermination() times out when executors refuse to shutdown"() {
        given:
        CountDownLatch keepRunningSignal = new CountDownLatch(1)
        CountDownLatch interruptedSignal = new CountDownLatch(1)
        CountDownLatch stoppedRunningSignal = new CountDownLatch(1)
        def start = System.currentTimeMillis()
        def a = java.util.concurrent.Executors.newFixedThreadPool(1)

        // Submit a task which refuses to stop when interrupted
        a.submit({
            while(keepRunningSignal.getCount() > 0) {
                try {
                    keepRunningSignal.await()
                }
                catch (InterruptedException e) {
                    // ignore - refuse to shutdown
                    assert interruptedSignal.getCount() > 0
                    interruptedSignal.countDown()
                }
            }
            stoppedRunningSignal.countDown()
        })

        when:
        Executors.awaitTermination(5, a)

        then:
        interruptedSignal.await(100, TimeUnit.MILLISECONDS)
        System.currentTimeMillis() < start + 100
        a.isShutdown()
        !a.isTerminated()

        cleanup:
        keepRunningSignal.countDown()
        stoppedRunningSignal.await(100, TimeUnit.MILLISECONDS)
        a.awaitTermination(5, TimeUnit.MILLISECONDS)
        assert a.isTerminated()
    }
}
