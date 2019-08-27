package uk.ac.cam.lib.cudl.xsltnail;

import org.docopt.DocoptExitException;
import spock.lang.Specification;
import spock.lang.Unroll;

class XSLTNailArgumentsSpec extends Specification {
    @Unroll
    def "parse() parses valid argument list #args"(String[] args, Map<String, String> expected) {
        when:
        def result = XSLTNailArguments.parse(args)

        then:
        result.isRight()
        result.get().toJavaMap() == expected

        where:
        [args, expected] << [
            // Help cases
            ["--help", ["transform": false, "<xslt-file>": null, "<xml-base-uri>": null, "--help": true, "--version": false]],
            ["-h", ["transform": false, "<xslt-file>": null, "<xml-base-uri>": null, "--help": true, "--version": false]],
            ["--help transform /foo /bar", ["transform": false, "<xslt-file>": null, "<xml-base-uri>": null, "--help": true, "--version": false]],
            ["-h transform /foo /bar", ["transform": false, "<xslt-file>": null, "<xml-base-uri>": null, "--help": true, "--version": false]],

            // Version cases
            ["--version", ["transform": false, "<xslt-file>": null, "<xml-base-uri>": null, "--help": false, "--version": true]],
            ["--version transform /foo /bar", ["transform": false, "<xslt-file>": null, "<xml-base-uri>": null, "--help": false, "--version": true]],

            // Normal cases
            ["transform /foo /bar", ["transform": true, "<xslt-file>": "/foo", "<xml-base-uri>": "/bar", "--help": false, "--version": false]],
            ["-- transform /foo /bar", ["transform": true, "<xslt-file>": "/foo", "<xml-base-uri>": "/bar", "--help": false, "--version": false]],
            ["-- transform --help --version", ["transform": true, "<xslt-file>": "--help", "<xml-base-uri>": "--version", "--help": false, "--version": false]],
        ].collect {row ->
            def (a, e) = row
            [a.split(), e]
        }
    }

    @Unroll
    def "parse() rejects incomplete argument list #args"(String[] args) {
        when:
        def result = XSLTNailArguments.parse(args)

        then:
        result.isLeft()
        result.getLeft() == Constants.USAGE_TRANSFORM

        where:
        args << [
            "",
            "nottransform /foo /bar",
            "transform",
            "transform /foo",
            "transform /foo /bar /baz",
        ].collect { it.split() }
    }
}
