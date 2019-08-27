package uk.ac.cam.lib.cudl.xsltnail

import io.vavr.collection.HashMap
import io.vavr.collection.Map
import spock.lang.Specification
import spock.lang.Unroll

import java.nio.file.FileSystems

import static io.vavr.API.Map

class XSLTTransformOperationSpec extends Specification {
    def "properties follow constructor arguments"() {
        given:
        def path = FileSystems.getDefault().getPath("/foo")
        def ident = "/bar"

        when:
        def op = new XSLTTransformOperation(path, ident)

        then:
        path.is(op.xsltPath)
        ident.is(op.inputIdentifier)
    }

    @Unroll
    def "fromParsedArguments() rejects args without expected keys"(Map<String, String> values) {
        when:
        XSLTTransformOperation.fromParsedArguments(values)

        then:
        thrown(IllegalArgumentException.class)

        where:
        values << [
            [:],
            ["transform": false, "<xslt-file>": "/foo", "<xml-base-uri>": "/bar"],
            ["transform": true, "<xslt-file>": null, "<xml-base-uri>": "/bar"],
            ["transform": true, "<xml-base-uri>": "/bar"],
            ["transform": true, "<xslt-file>": "/foo", "<xml-base-uri>": null],
            ["transform": true, "<xslt-file>": "/foo"],
        ].collect { HashMap.ofAll(it) }
    }

    def "fromParsedArguments() accepts valid args"() {
        given:
        def path = FileSystems.getDefault().getPath("/foo")
        def ident = "/bar"
        def args = Map("transform", true, "<xslt-file>", "/foo", "<xml-base-uri>", "/bar")

        when:
        def result = XSLTTransformOperation.fromParsedArguments(args)

        then:
        result.xsltPath == path
        result.inputIdentifier == ident
    }
}
