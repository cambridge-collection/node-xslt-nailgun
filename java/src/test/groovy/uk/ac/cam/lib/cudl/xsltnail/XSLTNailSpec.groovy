package uk.ac.cam.lib.cudl.xsltnail

import com.facebook.nailgun.NGContext
import com.facebook.nailgun.NGServer
import net.sf.saxon.s9api.Processor
import org.xmlunit.builder.Input
import spock.lang.Specification
import spock.lang.Unroll

import java.nio.charset.StandardCharsets
import java.time.Duration
import java.time.temporal.ChronoUnit
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch

import static org.xmlunit.matchers.CompareMatcher.isSimilarTo
import static spock.util.matcher.HamcrestSupport.expect

class XSLTNailSpec extends Specification {
    static def getResourceAsPath(String path) {
        return new File(XSLTNailSpec.class.getResource(path).toURI()).toPath()
    }

    static def stream(String s) {
        return new ByteArrayInputStream(s.getBytes(StandardCharsets.UTF_8))
    }

    def "transform() executes stylesheet with input"() {
        given:
        def xsltPath = getResourceAsPath("a.xsl")
        def inputPath = "file:///tmp/foo.xml"
        def input = "<a/>"
        def op = new XSLTTransformOperation(xsltPath, inputPath)
        def out = new ByteArrayOutputStream()

        when:

        def result = XSLTNail.newInstance().withCloseable { xn -> xn.transform(op, stream(input), out) }

        then:
        assert result.isRight()
        expect Input.fromByteArray(out.toByteArray()), isSimilarTo(Input.from("<result><a/></result>"))
    }

    def "transform() returns error message on invalid input data"() {
        given:
        def input = "<a>..."  // invalid XML

        def xsltPath = getResourceAsPath("a.xsl")
        def inputPath = "file:///tmp/foo.xml"
        def op = new XSLTTransformOperation(xsltPath, inputPath)
        def out = new ByteArrayOutputStream()

        when:
        def result = XSLTNail.newInstance().withCloseable { xn -> xn.transform(op, stream(input), out) }

        then:
        result.left._1 =~ /Error reported by XML parser:/
        result.left._2 == Constants.EXIT_STATUS_USER_ERROR
    }

    def "transform() returns error message on syntactically invalid XSLT"() {
        given:
        def inputPath = "file:///tmp/foo.xml"
        def input = "<a/>"
        def op = new XSLTTransformOperation(getResourceAsPath("invalid-syntax.xsl"), inputPath)
        def out = new ByteArrayOutputStream()

        when:
        def result = XSLTNail.newInstance().withCloseable { xn -> xn.transform(op, stream(input), out) }

        then:
        result.left._1 =~ /^Failed to compile XSLT: Error on line \d+ column \d+ of invalid-syntax.xsl:/
        result.left._2 == Constants.EXIT_STATUS_USER_ERROR
    }

    def "transform() returns error message when execution of XSLT raises an error"() {
        given:
        def inputPath = "file:///tmp/foo.xml"
        def input = "<a/>"
        def op = new XSLTTransformOperation(getResourceAsPath("invalid-logic.xsl"), inputPath)
        def out = new ByteArrayOutputStream()

        when:
        def result = XSLTNail.newInstance().withCloseable { xn -> xn.transform(op, stream(input), out) }

        then:
        result.left._1 =~ /^Failed to execute transform: Error evaluating \(1 div 0\)/
        result.left._1 =~ /FOAR0001: Integer division by zero/
        result.left._2 == Constants.EXIT_STATUS_USER_ERROR
    }

    private static final XSLT_TEMPLATE = """\
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
    <xsl:template match="/">%s</xsl:template>
</xsl:stylesheet>
"""

    def "transform() re-compiles XSLT after expiration"() {
        given:
        def reloadCompleteSignal = new CountDownLatch(1)
        def processor = new Processor(false)

        // Intercept the reload method to know when the reload is complete
        def loader = Spy(FileTimestampAsyncXSLTLoader, constructorArgs: [processor]) {
            _ * asyncReload(_, _, _) >> {
                CompletableFuture<FileTimestampAsyncXSLTLoader.FileTimestampCachedXSLT> result = callRealMethod()
                result.thenRunAsync({ reloadCompleteSignal.countDown() })
                return result
            }
        }
        def xsltFile = File.createTempFile("xslt-nail-test_", "")
        xsltFile.write(String.format(XSLT_TEMPLATE, "<initial-version/>"))

        def input = "<a/>"
        def op = new XSLTTransformOperation(xsltFile.toPath(), "file:///tmp/foo.xml")
        def out = new ByteArrayOutputStream()
        def nail = new XSLTNail(loader, Duration.of(1, ChronoUnit.NANOS))

        when:
        nail.transform(op, stream(input), out)

        then:
        expect Input.fromByteArray(out.toByteArray()), isSimilarTo(Input.from("<initial-version/>"))

        when:
        xsltFile.write(String.format(XSLT_TEMPLATE, "<updated-version/>"))

        // The first transform after expiration will trigger a reload, but will
        // itself use the existing version as the reload is asynchronous.
        nail.transform(op, stream(input), out)

        reloadCompleteSignal.await()
        out.reset()
        nail.transform(op, stream(input), out)

        then:
        expect Input.fromByteArray(out.toByteArray()), isSimilarTo(Input.from("<updated-version/>"))

        cleanup:
        nail.close()
    }

    @Unroll
    def "transform() reports error when reloaded XSLT cannot be compiled"(Closure<Void> xsltBreaker, errPatterns) {
        given:
        def processor = new Processor(false)
        def reloadCompleteSignal = new CountDownLatch(1)

        // Intercept the reload method to know when the reload is complete
        def loader = Spy(FileTimestampAsyncXSLTLoader, constructorArgs: [processor]) {
            _ * asyncReload(_, _, _) >> {
                CompletableFuture<FileTimestampAsyncXSLTLoader.FileTimestampCachedXSLT> result = callRealMethod()
                result.thenRunAsync({ reloadCompleteSignal.countDown() })
                return result
            }
        }
        def xsltFile = File.createTempFile("xslt-nail-test_", "")
        xsltFile.write(String.format(XSLT_TEMPLATE, "<initial-version/>"))

        def input = "<a/>"
        def op = new XSLTTransformOperation(xsltFile.toPath(), "file:///tmp/foo.xml")
        def out = new ByteArrayOutputStream()
        def nail = new XSLTNail(loader, Duration.of(1, ChronoUnit.NANOS))

        when:
        nail.transform(op, stream(input), out)

        then:
        expect Input.fromByteArray(out.toByteArray()), isSimilarTo(Input.from("<initial-version/>"))

        when:
        xsltBreaker(xsltFile)

        // The first transform after expiration will trigger a reload, but will
        // itself use the existing version as the reload is asynchronous.
        assert nail.transform(op, stream(input), out).isRight()

        reloadCompleteSignal.await()
        def result = nail.transform(op, stream(input), out)

        then:
        errPatterns.each {
            assert result.left._1.find(it)
        }
        result.left._2 == Constants.EXIT_STATUS_USER_ERROR

        cleanup:
        nail.close()

        where:
        [xsltBreaker, errPatterns] << [
            [{File file -> file.delete()},
             [/^Failed to compile XSLT: .*xslt-nail-test_.* \(No such file or directory\)$/]],
            [{File file -> file.write(String.format(XSLT_TEMPLATE, "< broken xml"))},
             [/^Failed to compile XSLT: /, /SXXP0003: Error reported by XML parser: /]]
        ]
    }

    @Unroll
    def "transform can be invoked via nailgun API"(xsltPath, input, assertResult) {
        given:
        def server = Mock(NGServer)
        def context = Mock(NGContext)
        def out = new ByteArrayOutputStream()
        def err = new ByteArrayOutputStream()
        context.out = new PrintStream(out, true, "UTF-8")
        context.err = new PrintStream(err, true, "UTF-8")
        context.in = stream(input)
        def status = 0

        when:
        XSLTNail.nailMain(context)

        then:
        1 * context.getNGServer() >> server
        1 * context.getArgs() >> (["transform", xsltPath, "file:///tmp/foo.xml"] as String[])
        _ * context.exit(_) >> { int s -> status = s }
        0 * context._
        _ * server.hashCode()
        _ * server.equals()

        assertResult(status, out, err)

        when:
        def nail = XSLTNail.NAILS.getIfPresent(server)

        then:
        assert ! nail.closeCalled

        when:
        XSLTNail.nailShutdown(server)

        then:
        assert nail.closeCalled
        assert XSLTNail.NAILS.getIfPresent(server) == null

        where:
        [xsltPath, input, assertResult] << [
            [getResourceAsPath("a.xsl"), "<a/>", { int exitStatus, ByteArrayOutputStream outStream, ByteArrayOutputStream errStream ->
                assert exitStatus == 0
                assert expect(Input.fromByteArray(outStream.toByteArray()), isSimilarTo(Input.from("<result><a/></result>")))
                true
            }],
            [getResourceAsPath("a.xsl"), "<a", { int exitStatus, ByteArrayOutputStream outStream, ByteArrayOutputStream errStream ->
                assert exitStatus == 2
                assert outStream.toString() == ""
                assert errStream.toString().find(/^Failed to execute transform: Error on line 1 column 3 of foo.xml:/)
                assert errStream.toString().find(/Error reported by XML parser/)
                true
            }],
            [getResourceAsPath("invalid-syntax.xsl"), "<a/>", { int exitStatus, ByteArrayOutputStream outStream, ByteArrayOutputStream errStream ->
                assert exitStatus == 2
                assert outStream.toString() == ""
                assert errStream.toString().find(/^Failed to compile XSLT: Error on line 5 column 1 of invalid-syntax.xsl:/)
                assert errStream.toString().find(/Error reported by XML parser/)
                true
            }],
            [getResourceAsPath("invalid-logic.xsl"), "<a/>", { int exitStatus, ByteArrayOutputStream outStream, ByteArrayOutputStream errStream ->
                assert exitStatus == 2
                assert outStream.toString() == ""
                assert errStream.toString().find(/^Failed to execute transform: Error evaluating \(1 div 0\)/)
                assert errStream.toString().find(/FOAR0001: Integer division by zero/)
                true
            }],
        ]
    }
}
