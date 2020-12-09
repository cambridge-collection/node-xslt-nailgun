package uk.ac.cam.lib.cudl.xsltnail

import org.xmlunit.builder.Input
import spock.lang.Specification

import java.nio.file.Files
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

import static groovy.util.GroovyCollections.combinations
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

    Process serverProc
    List<String> serverStderrLines
    List<String> serverStdoutLines

    def setup() {
        port = getUnusedPort()
        serverStderrLines = []
        serverStdoutLines = []
    }

    def cleanup() {
        serverProc?.destroyForcibly()
    }

    def launchServer(List<String> options = [], boolean awaitStartup = true, Map<String, String> environment = [:]) {
        def startedSignal = new CompletableFuture().completeOnTimeout(false, 5, TimeUnit.SECONDS)

        // Run the server and wait for it to be listening
        def builder = new ProcessBuilder(
            (["java", "-cp", serverClasspath, "uk.ac.cam.lib.cudl.xsltnail.XSLTNailgunServer"] +
                options + ["localhost:${port}"]) as String[])
        // Don't inherit environment variables
        builder.environment().clear()
        builder.environment().putAll(environment)
        def serverProc = builder.start()

        // consume and ignore stderr
        Thread.start { serverProc.getErrorStream().eachLine("UTF-8", serverStderrLines::add) }
        Thread.start {
            serverProc.getInputStream().eachLine("UTF-8") {
                if (it.find(/^NGServer [\d.]+ started on address/))
                    startedSignal.complete(true)
                serverStdoutLines.add(it)
            }
        }

        if (awaitStartup) {
            assert startedSignal.get(), "Server failed to start. stderr:" + serverStderrLines.collect { "  ${it}" }.join("\n")
        }
        return serverProc
    }

    def "server can start, run a transform and stop cleanly"() {
        setup:
        serverProc = launchServer()
        when:
        def xslFile = getResourceAsPath("a.xsl")
        Process txProc = [
                "python3", clientPath, "--nailgun-server", "localhost", "--nailgun-port", "${port}", "--",
                "xslt", "transform", "--system-identifier", "file:///tmp/foo.xml",
                "--parameter", "thing=foo", "--parameter", "thing=bar", "--", xslFile, "-"].execute()
        def stdout = new ByteArrayOutputStream()
        def stderr = new ByteArrayOutputStream()
        txProc.consumeProcessOutputStream(stdout)
        txProc.consumeProcessErrorStream(stderr)
        txProc.getOutputStream().withWriter("UTF-8") { it.write("<a/>") }
        txProc.waitFor(5, TimeUnit.SECONDS)

        then:
        assert stderr.toString("UTF-8") == ""
        assert txProc.exitValue() == 0
        expect Input.fromByteArray(stdout.toByteArray()), isSimilarTo(Input.from("<result thing=\"foo bar\"><a/></result>"))

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
        txProc?.destroyForcibly()
        stopProc?.destroyForcibly()
    }

    def "server does not start if --require-running-process process is not running"() {
        setup:
        // generate a PID that does not refer to a running process
        Process requiredProc = ["sleep", "60"].execute()
        requiredProc.destroyForcibly()
        serverProc = launchServer(["--require-running-process", "${requiredProc.pid()}"], false)
        when:
        serverProc.onExit().get(15, TimeUnit.SECONDS)
        then:
        serverProc.exitValue() == Constants.EXIT_STATUS_USER_ERROR
        serverStderrLines.find { it.contains("Error: invalid --require-owner PID: \"${requiredProc.pid()}\": Process does not exist") }
    }

    def "server shuts itself down when the --require-running-process process terminates"() {
        setup:
        Process requiredProc = ["sleep", "60"].execute()
        serverProc = launchServer(["--require-running-process", "${requiredProc.pid()}"])

        expect:
        serverProc.isAlive()
        when:
        requiredProc.destroyForcibly()
        serverProc.onExit().get(15, TimeUnit.SECONDS)
        then:
        serverProc.exitValue() == Constants.EXIT_STATUS_AUTOMATIC_SHUTDOWN
        serverStderrLines.find { it.contains("Automatic shutdown started: Required process (PID ${requiredProc.pid()}) is no longer running") }

        cleanup:
        requiredProc?.destroyForcibly()
    }

    def "logs are written to file when XSLT_NAILGUN_SERVER_LOG_FILE is in environment"() {
      given:
      def tmpFile = Files.createTempFile("xslt-nailgun-", ".log")
      def serverProc = launchServer(["--log-level", "FINEST"], true, [XSLT_NAILGUN_SERVER_LOG_FILE: tmpFile.toString()])
      serverProc.supportsNormalTermination()

      when:
      serverProc.destroy()
      serverProc.onExit().get(5, TimeUnit.SECONDS)

      then:
      Files.exists(tmpFile)
      Files.readAllLines(tmpFile).find {it.contains("FINEST ${serverProc.pid()} uk.ac.cam.lib.cudl.xsltnail.ShutdownManager\$AbstractDefaultShutdownManager lambda\$onShutdown\$1 NGServer has stopped running") }

      cleanup:
      if(tmpFile) {
        Files.deleteIfExists(tmpFile)
      }
    }
}
