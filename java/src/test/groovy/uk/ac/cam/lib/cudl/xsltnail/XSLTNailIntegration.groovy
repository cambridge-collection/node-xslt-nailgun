package uk.ac.cam.lib.cudl.xsltnail

import org.xmlunit.builder.Input
import spock.lang.Specification

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

import static org.xmlunit.matchers.CompareMatcher.isSimilarTo
import static spock.util.matcher.HamcrestSupport.expect

class XSLTNailIntegration extends Specification {
    private static final String SERVER_CLASSPATH_PROPERTY = "uk.ac.cam.lib.cudl.xsltnail.server.classpath"
    private static final String PYTHON_NG_CLIENT = "uk.ac.cam.lib.cudl.xsltnail.python-ng-client"

    static int getUnusedPort() {
        new ServerSocket(0).withCloseable { ss -> ss.getLocalPort() }
    }

    def requireProperty(name) {
        Optional.ofNullable(System.getProperty(name))
            .orElseThrow({ new RuntimeException("System property ${name} is not set - it should be set automatically via by Maven") })
    }

    static def getResourceAsPath(String path) {
        return new File(XSLTNailSpec.class.getResource(path).toURI()).toPath()
    }

    def serverClasspath = requireProperty(SERVER_CLASSPATH_PROPERTY)
    def clientPath = requireProperty(PYTHON_NG_CLIENT)
    def port

    def setup() {
        port = getUnusedPort()
    }

    def "server can start, run a transform and stop cleanly"() {
        given:
        CountDownLatch startedSignal = new CountDownLatch(1)

        when:
        Process serverProc = ["java", "-cp", serverClasspath,
                              "uk.ac.cam.lib.cudl.xsltnail.XSLTNailgunServer",
                              "localhost:${port}"].execute()
        // consume and ignore stderr
        Thread.start { serverProc.getErrorStream().eachLine("UTF-8") { } }
        Thread.start { serverProc.getInputStream().eachLine("UTF-8") {
            if(it.find(/^NGServer [\d.]+ started on address/))
                startedSignal.countDown()
        } }
        startedSignal.await(5, TimeUnit.SECONDS)

        then:
        assert startedSignal.count == 0 : "Server failed to start"

        when:
        def xslFile = getResourceAsPath("a.xsl")
        Process txProc = [
            "python3", clientPath, "--nailgun-server", "localhost", "--nailgun-port", "${port}", "--",
            "xslt", "transform", "--system-identifier", "file:///tmp/foo.xml", "--", xslFile, "-"].execute()
        def stdout = new ByteArrayOutputStream()
        def stderr = new ByteArrayOutputStream()
        txProc.consumeProcessOutputStream(stdout)
        txProc.consumeProcessErrorStream(stderr)
        txProc.getOutputStream().withWriter("UTF-8") { it.write("<a/>") }
        txProc.waitFor(5, TimeUnit.SECONDS)

        then:
        assert stderr.toString("UTF-8") == ""
        assert txProc.exitValue() == 0
        expect Input.fromByteArray(stdout.toByteArray()), isSimilarTo(Input.from("<result><a/></result>"))

        when:
        Process stopProc = [
            "python3", clientPath, "--nailgun-server", "localhost", "--nailgun-port", "${port}",
            "ng-stop"].execute()
        stopProc.consumeProcessOutput()
        stopProc.waitFor(5, TimeUnit.SECONDS)
        serverProc.waitFor(5, TimeUnit.SECONDS)

        then:
        stopProc.exitValue() == 0
        serverProc.exitValue() == 0

        cleanup:
        serverProc?.destroyForcibly()
        txProc?.destroyForcibly()
        stopProc?.destroyForcibly()
    }

}
