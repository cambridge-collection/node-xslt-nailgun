package uk.ac.cam.lib.cudl.xsltnail

import io.vavr.Tuple
import io.vavr.collection.HashMap
import io.vavr.collection.List
import io.vavr.collection.Map
import io.vavr.control.Either
import io.vavr.control.Option
import spock.lang.Specification
import spock.lang.Unroll

import static io.vavr.API.Map
import static uk.ac.cam.lib.cudl.xsltnail.XSLTNailArguments.Parsers.*

class XSLTNailArgumentsSpec extends Specification {
    @Unroll
    def "constant() matches constant value"(context, args, expected) {
        given:
        def parser = constant("foo")

        when:
        def result = parser.parse(context, args)
        then:
        result == expected

        where:
        [context, args, expected] << [
            [[], ["foo"], [[["foo", true]], []]],
            [[["abc", true]], ["foo", "bar"], [[["foo", true], ["abc", true]], ["bar"]]],
            [[], ["bar"], "foo"],
        ].collect(this.&parserParamsToVavr)
    }

    @Unroll
    def "value() matches any value"(context, args, expected) {
        given:
        def parser = value("<foo>")

        when:
        def result = parser.parse(context, args)
        then:
        result == expected

        where:
        [context, args, expected] << [
            [[], ["foo"], [[["<foo>", "foo"]], []]],
            [[["abc", true]], ["foo", "bar"], [[["<foo>", "foo"], ["abc", true]], ["bar"]]],
            [[], [], "<foo>"],
        ].collect(this.&parserParamsToVavr)
    }

    @Unroll
    def "option() matches long option"(context, args, expected) {
        given:
        def parser = option("--foo", "--foo")

        when:
        def result = parser.parse(context, args)
        then:
        result == expected

        where:
        [context, args, expected] << [
            [[], ["--foo"], [[["--foo", true]], []]],
            [[["abc", true]], ["--foo", "bar"], [[["--foo", true], ["abc", true]], ["bar"]]],
            [[], ["bar"], "--foo"],
        ].collect(this.&parserParamsToVavr)
    }

    @Unroll
    def "option() matches short option"(context, args, expected) {
        given:
        def parser = option("-f", "--foo")

        when:
        def result = parser.parse(context, args)
        then:
        result == expected

        where:
        [context, args, expected] << [
            [[], ["-f"], [[["--foo", true]], []]],
            [[["abc", true]], ["-f", "bar"], [[["--foo", true], ["abc", true]], ["bar"]]],
            [[], ["bar"], "-f"],
        ].collect(this.&parserParamsToVavr)
    }

    @Unroll
    def "optionWithValue() matches long option with value"(context, args, expected) {
        given:
        def parser = optionWithValue("--foo", "--foo")

        when:
        def result = parser.parse(context, args)
        then:
        result == expected

        where:
        [context, args, expected] << [
            [[], ["--foo", "123"], [[["--foo", "123"]], []]],
            [[], ["--foo=123"], [[["--foo", "123"]], []]],
            [[["abc", true]], ["--foo", "123", "bar"], [[["--foo", "123"], ["abc", true]], ["bar"]]],
            [[["abc", true]], ["--foo=123", "bar"], [[["--foo", "123"], ["abc", true]], ["bar"]]],
            [[], ["bar"], "--foo="],
        ].collect(this.&parserParamsToVavr)
    }

    @Unroll
    def "allOf() applies a sequence of parsers"(context, args, expected) {
        given:
        def parser = allOf(value("<a>"), constant("foo"), value("<b>"))

        when:
        def result = parser.parse(context, args)
        then:
        result == expected

        where:
        [context, args, expected] << [
            [[], ["a", "foo", "b"], [[["<b>", "b"], ["foo", true], ["<a>", "a"]], []]],
            [[], ["a", "bar", "b"], "foo"],
        ].collect(this.&parserParamsToVavr)
    }

    @Unroll
    def "allOf([]) is successful"(context, args, expected) {
        given:
        def parser = allOf()

        when:
        def result = parser.parse(context, args)
        then:
        result == expected

        where:
        [context, args, expected] << [
            [[], [], [[], []]],
            [[["foo", true]], ["abc"], [[["foo", true]], ["abc"]]]
        ].collect(this.&parserParamsToVavr)
    }

    @Unroll
    def "firstOf([]) is unsuccessful"(context, args, expected) {
        given:
        def parser = firstOf()

        when:
        def result = parser.parse(context, args)
        then:
        result == expected

        where:
        [context, args, expected] << [
            [[], [], "firstOf([])"],
            [[["foo", true]], ["abc"], "firstOf([])"]
        ].collect(this.&parserParamsToVavr)
    }

    @Unroll
    def "firstOf() uses the first matching parser result"(context, args, expected) {
        given:
        def parser = firstOf(constant("foo"), constant("bar"))

        when:
        def result = parser.parse(context, args)
        then:
        result == expected

        where:
        [context, args, expected] << [
            [[], ["foo"], [[["foo", true]], []]],
            [[], ["bar"], [[["bar", true]], []]],
            [[], ["bar", "bar"], [[["bar", true]], ["bar"]]],
            [[], ["xyz"], "bar"],
            [[], [], "bar"],
        ].collect(this.&parserParamsToVavr)
    }

    @Unroll
    def "times(*, 0, 0) never matches"(context, args, expected) {
        given:
        def parser = times(value("<foo>"), 0, 0)

        when:
        def result = parser.parse(context, args)
        then:
        result == expected

        where:
        [context, args, expected] << [
            [[], ["foo"], "times(*, 0, 0)"],
        ].collect(this.&parserParamsToVavr)
    }

    @Unroll
    def "times(*, 0) matches parser 0 or more times"(context, args, expected) {
        given:
        def parser = times(constant("x"), 0)

        when:
        def result = parser.parse(context, args)
        then:
        result == expected

        where:
        [context, args, expected] << [
            [[], [], [[], []]],
            [[], ["y"], [[], ["y"]]],
            [[], ["x"], [[["x", true]], []]],
            [[], ["x", "x"], [[["x", true], ["x", true]], []]],
            [[], ["x", "x", "y"], [[["x", true], ["x", true]], ["y"]]],
        ].collect(this.&parserParamsToVavr)
    }

    @Unroll
    def "times(*, n) matches parser n or more times"(context, args, expected) {
        given:
        def parser = times(constant("x"), 2)

        when:
        def result = parser.parse(context, args)
        then:
        result == expected

        where:
        [context, args, expected] << [
            [[], ["x", "y"], "x"],
            [[], ["x", "x", "y"], [[["x", true], ["x", true]], ["y"]]],
            [[], ["x", "x", "x", "y"], [[["x", true], ["x", true], ["x", true]], ["y"]]],
        ].collect(this.&parserParamsToVavr)
    }

    @Unroll
    def "times(*, n, o) matches parser n - o times"(context, args, expected) {
        given:
        def parser = times(constant("x"), 2, 3)

        when:
        def result = parser.parse(context, args)
        then:
        result == expected

        where:
        [context, args, expected] << [
            [[], ["x", "y"], "x"],
            [[], ["x", "x", "y"], [[["x", true], ["x", true]], ["y"]]],
            [[], ["x", "x", "x", "y"], [[["x", true], ["x", true], ["x", true]], ["y"]]],
            [[], ["x", "x", "x", "x", "y"], [[["x", true], ["x", true], ["x", true]], ["x", "y"]]],
        ].collect(this.&parserParamsToVavr)
    }

    private static java.util.List<?> parserParamsToVavr(java.util.List<?> params) {
        return [
            List.ofAll(params[0].collect { Tuple.of(it[0], it[1]) }),
            List.ofAll(params[1]),
            params[2] instanceof String ? Either.left(params[2]) :
                Either.right(Tuple.of(
                    List.ofAll(params[2][0].collect { Tuple.of(it[0], it[1]) }),
                    List.ofAll(params[2][1])))
        ]
    }

    private static final Map<String, Object> PARSE_DEFAULTS = Map(
        "--", false,
        "--help", false,
        "--version", false,
        "--system-identifier", null,
        "--parameter", List.empty(),
        "transform", false,
        "<xslt-file>", null,
        "<xml-file>", null)

    @Unroll
    def "parse(#args)"(args, expected) {
        when:
        def result = XSLTNailArguments.parse(args)

        then:
        result == expected

        where:
        [args, expected] << [
            // FIXME: Need to ensure --system-identifier or <xml-file> are provided
            [["transform", "foo", "bar"],
             ["--": false, "--help": false, "--version": false, "transform": true,
              "--system-identifier": null, "<xslt-file>": "foo", "<xml-file>": "bar",
              "--parameter": List.empty()]],
            [["transform", "--system-identifier", "abc", "foo", "bar"],
             ["--": false, "--help": false, "--version": false, "transform": true,
              "--system-identifier": "abc", "<xslt-file>": "foo", "<xml-file>": "bar",
              "--parameter": List.empty()]],
            [["transform", "--system-identifier", "abc", "foo", "bar"],
             ["--": false, "--help": false, "--version": false, "transform": true,
              "--system-identifier": "abc", "<xslt-file>": "foo", "<xml-file>": "bar",
              "--parameter": List.empty()]],
            [["transform", "--system-identifier=abc", "foo", "bar"],
             ["--": false, "--help": false, "--version": false, "transform": true,
              "--system-identifier": "abc", "<xslt-file>": "foo", "<xml-file>": "bar",
              "--parameter": List.empty()]],
            [["transform", "foo", "bar", "--system-identifier=abc"],
             ["--": false, "--help": false, "--version": false, "transform": true,
              "--system-identifier": "abc", "<xslt-file>": "foo", "<xml-file>": "bar",
              "--parameter": List.empty()]],
            [["transform", "foo", "--system-identifier=abc", "bar"],
             ["--": false, "--help": false, "--version": false, "transform": true,
              "--system-identifier": "abc", "<xslt-file>": "foo", "<xml-file>": "bar",
              "--parameter": List.empty()]],

            // --parameter is multi-valued. Note that the value should be of the
            // form name=value, but values are not parsed at this stage. Neither
            // are duplicate parameters handled here.
            [["transform", "foo", "bar", "--parameter", "foo"],
             ["--": false, "--help": false, "--version": false, "transform": true,
              "--system-identifier": null, "<xslt-file>": "foo", "<xml-file>": "bar",
              "--parameter": List.of("foo")]],
            [["transform", "foo", "bar", "--parameter", "foo", "--parameter=bar", "--parameter=baz123"],
             ["--": false, "--help": false, "--version": false, "transform": true,
              "--system-identifier": null, "<xslt-file>": "foo", "<xml-file>": "bar",
              "--parameter": List.of("foo", "bar", "baz123")]],
            [["transform", "foo", "bar", "--parameter", "foo", "--parameter=bar", "--parameter=baz=123", "--parameter", "baz=123"],
             ["--": false, "--help": false, "--version": false, "transform": true,
              "--system-identifier": null, "<xslt-file>": "foo", "<xml-file>": "bar",
              "--parameter": List.of("foo", "bar", "baz=123", "baz=123")]],

            // Argument separator (--) prevents subsequent values being interpreted as options
            [["transform", "--system-identifier=abc", "--", "--foo", "--bar"],
             ["--": true, "--help": false, "--version": false, "transform": true,
              "--system-identifier": "abc", "<xslt-file>": "--foo", "<xml-file>": "--bar",
              "--parameter": List.empty()]],
            [["transform", "--", "./foo.xsl", "--system-identifier=abc"],
             ["--": true, "--help": false, "--version": false, "transform": true,
              "--system-identifier": null, "<xslt-file>": "./foo.xsl", "<xml-file>": "--system-identifier=abc",
              "--parameter": List.empty()]],

            [["--version"], PARSE_DEFAULTS.put("--version", true)],
            [["--foo", "--version"], null],
            [["--version", "--foo"], null],

            [[], null],
            [["transform"], null],
            [["nottransform", "--foo"], null],

            [["--help"], PARSE_DEFAULTS.put("--help", true)],
            [["--foo", "--help", "--bar"], PARSE_DEFAULTS.put("--help", true)],
            [["-h"], PARSE_DEFAULTS.put("--help", true)],
            [["--foo", "-h", "--bar"], PARSE_DEFAULTS.put("--help", true)],
            // help with otherwise valid usage
            [["transform", "./foo", "--help"],
             PARSE_DEFAULTS.put("transform", true).put("<xslt-file>", "./foo").put("--help", true)],
        ].collect {
            Object _expected = it[1]
            def actualExpectation
            if(_expected instanceof java.util.Map)
                actualExpectation = Either.right(HashMap.ofAll(_expected))
            else if(_expected instanceof Map)
                actualExpectation = Either.right(_expected)
            else
                actualExpectation = Either.left(_expected == null ? Option.none() : Option.some(_expected))

            [List.ofAll(it[0]), actualExpectation]
        }
    }
}
