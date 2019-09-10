package uk.ac.cam.lib.cudl.xsltnail

import io.vavr.collection.HashMap
import io.vavr.collection.Map
import spock.lang.Specification
import spock.lang.Unroll

import java.nio.file.FileSystems

import static io.vavr.API.Map
import static io.vavr.API.Option

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
    def "fromParsedArguments() requires transform and <xslt-file> keys"(Map<String, String> values) {
        when:
        XSLTTransformOperation.fromParsedArguments(values)

        then:
        thrown(IllegalArgumentException.class)

        where:
        values << [
            [:],
            ["transform": false, "<xslt-file>": "/foo"],
            ["transform": true, "<xslt-file>": null],
            ["<xslt-file>": "/foo"],
            ["transform": true],
        ].collect { HashMap.ofAll(it) }
    }

    @Unroll
    def "fromParsedArguments() accepts valid args"(Map<String, Object> args, expected) {
        expect:
        XSLTTransformOperation.fromParsedArguments(args) == expected

        where:
        [args, expected] << [
            [["transform": true, "<xslt-file>": "/foo", "<xml-file>": null, "--system-identifier": null], ["/foo", null, null]],
            [["transform": true, "<xslt-file>": "/foo", "<xml-file>": "/bar", "--system-identifier": "/baz"], ["/foo", "/bar", "/baz"]]
        ].collect { [
            HashMap.ofAll(it[0]),
            new XSLTTransformOperation(
                FileSystems.getDefault().getPath(it[1][0]),
                Option(it[1][1]).map(FileSystems.getDefault().&getPath),
                Option(it[1][2]))
        ] }
    }
}
