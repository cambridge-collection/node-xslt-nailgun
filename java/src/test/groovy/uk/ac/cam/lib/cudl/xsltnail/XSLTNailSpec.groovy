package uk.ac.cam.lib.cudl.xsltnail

import com.facebook.nailgun.NGContext
import com.facebook.nailgun.NGServer
import io.vavr.collection.HashMultimap
import io.vavr.collection.Multimap
import io.vavr.control.Option
import net.sf.saxon.s9api.Processor
import net.sf.saxon.s9api.QName
import org.xmlunit.builder.Input
import spock.lang.Specification
import spock.lang.Unroll

import java.nio.charset.StandardCharsets
import java.nio.file.FileSystems
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.FileTime
import java.time.Duration
import java.time.temporal.ChronoUnit
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.function.BiFunction

import static io.vavr.API.*
import static org.xmlunit.matchers.CompareMatcher.isSimilarTo
import static spock.util.matcher.HamcrestSupport.expect
import static uk.ac.cam.lib.cudl.xsltnail.Constants.EXIT_STATUS_USER_ERROR

class XSLTNailSpec extends Specification {
    static def path(String segment, String... segments) {
        return FileSystems.getDefault().getPath(segment, segments)
    }

    static def getResourceAsPath(String path) {
        return new File(XSLTNailSpec.class.getResource(path).toURI()).toPath()
    }

    static def stream(String s) {
        return new ByteArrayInputStream(s.getBytes(StandardCharsets.UTF_8))
    }

    static Multimap<QName, String> parameters(Multimap<String, String> params) {
        params.map((BiFunction<String, String, Tuple2<QName, String>>){ k, v -> Tuple(QName.fromClarkName(k), v)})
    }

    static def normaliseWhitespace(String s) {
        s.replaceAll("\\s+", " ")
    }

    static def runParamTransform(Multimap<QName, String> params) {
        def xsltPath = getResourceAsPath("params.xsl")
        def input = "<a/>"
        def op = new XSLTTransformOperation(xsltPath, Some(path("-")), None(), params)
        def out = new ByteArrayOutputStream()
        def result = XSLTNail.newInstance().withCloseable { xn -> xn.transform(op, stream(input), out) }
        return result.map { out.toString("utf-8") }
    }

    static def DEFAULT_PARAMS = HashMultimap.withSeq().of(
        "untyped-param", "foo",
        "default-param2", "non-default value",
        "numeric-param", "42",
        "date-param", "2019-12-25",
        "multi-string-param", "ab",
        "multi-string-param", "cd",
        "multi-string-param", "ef",
        "{http://example.com/myparam}namespaced-param", "bar",
    )

    @Unroll
    def "transform() executes stylesheet with input from stdin when #desc"(desc, xmlPath, systemIdentifier) {
        given:
        def xsltPath = getResourceAsPath("a.xsl")
        def input = "<a/>"
        def op = new XSLTTransformOperation(xsltPath, xmlPath, systemIdentifier)
        def out = new ByteArrayOutputStream()

        when:
        def result = XSLTNail.newInstance().withCloseable { xn -> xn.transform(op, stream(input), out) }

        then:
        assert result.isRight()
        expect Input.fromByteArray(out.toByteArray()), isSimilarTo(Input.from("<result><a/></result>"))

        where:
        [desc, xmlPath, systemIdentifier] << [
            ["<xml-file> is - without a system identifier", Option(path("-")), Option(null)],
            ["<xml-file> is - with a system identifier", Option(path("-")), Option("file:///tmp/foo.xml")],
            ["<xml-file> and system identifier are not provided", Option(null), Option(null)]
        ]
    }

    @Unroll
    def "transform() executes stylesheet with input from file #tmpFile when <xml-file> is #xmlPath and --system-identifier is #systemIdentifier"(
            Path tmpFile, xmlPath, systemIdentifier) {
        setup:
        def input = "<a/>"
        def xsltPath = getResourceAsPath("a.xsl")
        def op = new XSLTTransformOperation(xsltPath, xmlPath, systemIdentifier)
        def out = new ByteArrayOutputStream()

        tmpFile.write(input)

        when:
        def result = XSLTNail.newInstance().withCloseable { xn -> xn.transform(op, stream(input), out) }

        then:
        assert result.isRight()
        expect Input.fromByteArray(out.toByteArray()), isSimilarTo(Input.from("<result><a/></result>"))

        cleanup:
        Files.delete(tmpFile)

        where:
        [tmpFile, xmlPath, systemIdentifier] << {
            Path file ->
            [
                [file, Option(file), Option(null)],
                [file, Option(null), Option(file.toUri().toString())],
                [file, Option(file), Option(file.toUri().toString())]
            ]
        }.call(Files.createTempFile("input-", ".xml"))
    }

    @Unroll
    def "transform() with xmlPath=#xmlPath, systemIdentifier=#systemIdentifier uses base URI #baseURI"(
        Option<Path> xmlPath, systemIdentifier, baseURI
    ) {
        given:
        def xsltPath = getResourceAsPath("base-uri.xsl")
        def input = xmlPath.exists { it.toString() == "-" } ? "<a/>" : ""
        def op = new XSLTTransformOperation(xsltPath, xmlPath, systemIdentifier)
        def out = new ByteArrayOutputStream()

        when:
        def result = XSLTNail.newInstance().withCloseable { xn -> xn.transform(op, stream(input), out) }

        then:
        assert result.isRight()
        expect Input.fromByteArray(out.toByteArray()),
            isSimilarTo(Input.from("<result base-uri-of-input=\"${baseURI}\"><a/></result>" as String))

        where:
        [xmlPath, systemIdentifier, baseURI] << [
            // data on stdin - base URI available by default
            [Option(path("-")), Option(null), ""],
            // base is specified for data on stdin
            [Option(path("-")), Option("foo:///bar"), "foo:///bar"],
            // base is URI of path
            [Option(getResourceAsPath("a.xml")), Option(null),
             getResourceAsPath("a.xml").toUri().toString()],
            // base is system ID, which is also used to locate the input
            [Option(null), Option(getResourceAsPath("a.xml").toUri().toString()),
             getResourceAsPath("a.xml").toUri().toString()],
            // base is overridden
            [Option(getResourceAsPath("a.xml")), Option("foo:///bar"), "foo:///bar"],
        ]
    }

    def "transform() makes parameters available to stylesheet"() {
        given:
        def params = parameters(DEFAULT_PARAMS)
        def expected = """\
<result>
    <param name="untyped-param" value="foo"/>
    <param name="default-param1" value="default value"/>
    <param name="default-param2" value="non-default value"/>
    <param name="numeric-param" value="42 * 2 = 84"/>
    <param name="date-param" year="2019" value="2019-12-25"/>
    <param name="multi-string-param" count="3" value="ab, cd, ef"/>
    <param name="myparam:namespaced-param" value="bar"/>
</result>
"""

        when:
        def result = runParamTransform(params)

        then:
        result.isRight()
        expect result.get(), isSimilarTo(expected).ignoreWhitespace()
    }

    def "transform() fails if required parameter is not specified"() {
        given:
        def params = parameters(DEFAULT_PARAMS.remove("date-param"))

        when:
        def result = runParamTransform(params)

        then:
        result.isLeft()
        result.getLeft()._2 == EXIT_STATUS_USER_ERROR
        def err = normaliseWhitespace(result.getLeft()._1)
        err.startsWith("Failed to execute transform: Error evaluating")
        err.contains("XTDE0700: A value must be supplied for parameter \$date-param because there is no default value for the required type")
    }

    def "transform() fails if a parameter value cannot be cast to the parameter type"() {
        given:
        def params = parameters(DEFAULT_PARAMS.remove("date-param").put("date-param", "foobar"))

        when:
        def result = runParamTransform(params)

        then:
        result.isLeft()
        result.getLeft()._2 == EXIT_STATUS_USER_ERROR
        def err = normaliseWhitespace(result.getLeft()._1)
        err.startsWith("Failed to execute transform: Error evaluating")
        err.contains("FORG0001: Invalid date \"foobar\" (Non-numeric year component)")
    }

    def "transform() returns error message on invalid input data"() {
        given:
        def input = "<a>..."  // invalid XML

        def xsltPath = getResourceAsPath("a.xsl")
        def op = new XSLTTransformOperation(xsltPath, Option(null), Option(null),)
        def out = new ByteArrayOutputStream()

        when:
        def result = XSLTNail.newInstance().withCloseable { xn -> xn.transform(op, stream(input), out) }

        then:
        result.left._1 =~ /Error reported by XML parser:/
        result.left._2 == Constants.EXIT_STATUS_USER_ERROR
    }

    def "transform() returns error message on syntactically invalid XSLT"() {
        given:
        def input = "<a/>"
        def op = new XSLTTransformOperation(getResourceAsPath("invalid-syntax.xsl"), Option(null), Option(null))
        def out = new ByteArrayOutputStream()

        when:
        def result = XSLTNail.newInstance().withCloseable { xn -> xn.transform(op, stream(input), out) }

        then:
        result.left._1 =~ /^Failed to compile XSLT: Error on line \d+ column \d+ of invalid-syntax.xsl:/
        result.left._2 == Constants.EXIT_STATUS_USER_ERROR
    }

    def "transform() returns error message when execution of XSLT raises an error"() {
        given:
        def input = "<a/>"
        def op = new XSLTTransformOperation(getResourceAsPath("invalid-logic.xsl"), Option(null), Option(null))
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
        // XSLT is only recompiled if the timestamp has changed, so use a really
        // old timestamp to ensure it's updated when we rewrite the file
        Files.setLastModifiedTime(xsltFile.toPath(), FileTime.from(0, TimeUnit.MILLISECONDS))

        def input = "<a/>"
        def op = new XSLTTransformOperation(xsltFile.toPath(), Option(null), Option(null))
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
        // XSLT is only recompiled if the timestamp has changed, so use a really
        // old timestamp to ensure it's updated when we rewrite the file
        Files.setLastModifiedTime(xsltFile.toPath(), FileTime.from(0, TimeUnit.MILLISECONDS))

        def input = "<a/>"
        def op = new XSLTTransformOperation(xsltFile.toPath(), Option(null), Option(null))
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
        1 * context.getArgs() >> (["transform", "--system-identifier", "file:///tmp/foo.xml", xsltPath, "-"] as String[])
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
