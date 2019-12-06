package uk.ac.cam.lib.cudl.xsltnail

import io.vavr.Tuple
import io.vavr.collection.HashMap
import io.vavr.collection.HashMultimap
import io.vavr.collection.List
import io.vavr.collection.Map
import net.sf.saxon.s9api.QName
import spock.lang.Specification
import spock.lang.Unroll

import java.nio.file.FileSystems

import static io.vavr.API.List
import static io.vavr.API.Option;

class XSLTTransformOperationSpec extends Specification {
    def "properties follow constructor arguments"() {
        given:
        def xsltPath = FileSystems.getDefault().getPath("/foo")
        def xmlPath = Option(FileSystems.getDefault().getPath("/foo"))
        def ident = Option("/bar")

        when:
        def op = new XSLTTransformOperation(xsltPath, xmlPath, ident)

        then:
        xsltPath.is(op.xsltPath)
        xmlPath.is(op.xmlPath)
        ident.is(op.inputIdentifier)
    }

    @Unroll
    def "fromParsedArguments() requires keys for all handled CLI options"(Map<String, String> values) {
        when:
        XSLTTransformOperation.fromParsedArguments(values)

        then:
        thrown(NoSuchElementException.class)

        where:
        values << [
            [:],
            [/*              */ "<xslt-file>": "/foo", "<xml-file>": null, "--system-identifier": null, "--parameter": List()],
            ["transform": true, /*                  */ "<xml-file>": null, "--system-identifier": null, "--parameter": List()],
            ["transform": true, "<xslt-file>": "/foo", /*               */ "--system-identifier": null, "--parameter": List()],
            ["transform": true, "<xslt-file>": "/foo", "<xml-file>": null, /*                        */ "--parameter": List()],
            ["transform": true, "<xslt-file>": "/foo", "<xml-file>": null, "--system-identifier": null, /*                 */],
        ].collect { HashMap.ofAll(it) }
    }

    @Unroll
    def "fromParsedArguments() reports invalid CLI parameter values"(values, msg) {
        when:
        def result = XSLTTransformOperation.fromParsedArguments(HashMap.ofAll([
            "transform": true, "<xslt-file>": "/foo", "<xml-file>": null, "--system-identifier": null, "--parameter": values
        ]))
        then:
        result.isFailure()

        when:
        result.get()
        then:
        def e = thrown(IllegalArgumentException)
        e.message == msg

        where:
        [values, msg] << [
            [["foo"], "parameters must be of the form \"Name=Value\", got: \"foo\""],
            [["=foo"], "parameter names must be qnames in Clark notation (\"{uri}local\"), got: \"\": Supplied Clark name is null or empty"],
            [["{}=foo"], "parameter names must be qnames in Clark notation (\"{uri}local\"), got: \"{}\": value is not a valid qname"],
            [["{x=foo"], "parameter names must be qnames in Clark notation (\"{uri}local\"), got: \"{x\": No closing '}' in Clark name"],
            [["x}=foo"], "parameter names must be qnames in Clark notation (\"{uri}local\"), got: \"x}\": value is not a valid qname"],
            [["{{x}=foo"], "parameter names must be qnames in Clark notation (\"{uri}local\"), got: \"{{x}\": value is not a valid qname"]
        ].collect({
            return [List.ofAll(it[0]), it[1]]
        })
    }

    @Unroll
    def "fromParsedArguments() accepts valid args"(Map<String, Object> args, expected) {
        when:
        def result = XSLTTransformOperation.fromParsedArguments(args)
        then:
        result.isSuccess()
        result.get() == expected

        where:
        [args, expected] << [
            [["transform": true, "<xslt-file>": "/foo", "<xml-file>": null, "--system-identifier": null, "--parameter": List()], ["/foo", null, null, []]],
            [["transform": true, "<xslt-file>": "/foo", "<xml-file>": "/bar", "--system-identifier": "/baz", "--parameter": List()], ["/foo", "/bar", "/baz", []]],
            [["transform": true, "<xslt-file>": "/foo", "<xml-file>": "/bar", "--system-identifier": "/baz",
              "--parameter": List("foo=bar", "foo=baz", "{uri}local=boz")],
            ["/foo", "/bar", "/baz", [
                Tuple.of(new QName("foo"), "bar"),
                Tuple.of(new QName("foo"), "baz"),
                Tuple.of(new QName("uri", "local"), "boz")]]]
        ].collect { it ->
            return [
            HashMap.ofAll(it[0]),
            new XSLTTransformOperation(
                FileSystems.getDefault().getPath(it[1][0]),
                Option(it[1][1]).map(FileSystems.getDefault().&getPath),
                Option(it[1][2]),
                HashMultimap.withSeq().ofEntries(it[1][3])
            )
        ] }
    }
}
