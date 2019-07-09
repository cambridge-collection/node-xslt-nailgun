package uk.ac.cam.lib.cudl.xsltnail

import org.docopt.DocoptExitException
import spock.lang.Specification
import spock.lang.Unroll

class XSLTTransformOperationSpec extends Specification {
    def "constructor"() {
        given:
        def xsltPath = new File("/foo").toPath()
        def inputIdentifier = "/bar"

        when:
        def op = new XSLTTransformOperation(xsltPath, inputIdentifier)

        then:
        op.xsltPath == xsltPath
        op.inputIdentifier == inputIdentifier
    }

    def "parse arguments"() {
        given:
        def xsltPath = new File("/foo").toPath()
        def inputIdentifier = "/bar"
        def args = "transform /foo /bar".split(" ")

        when:
        def op = XSLTTransformOperation.fromParsedArguments(Constants.USAGE_TRANSFORM.parse(args))

        then:
        op.xsltPath == xsltPath
        op.inputIdentifier == inputIdentifier
    }

    @Unroll
    def "docopt rejects invalid argument list #args"(String[] args) {
        when:
        Constants.USAGE_TRANSFORM.parse(args)

        then:
        thrown(DocoptExitException)

        where:
        args << [
            "",
            "foo /bar",
            "foo /bar /baz",
            "transform",
            "transform /bar",
            "transform /bar /baz /boz",
        ].collect { it.split(" ") }
    }
}
