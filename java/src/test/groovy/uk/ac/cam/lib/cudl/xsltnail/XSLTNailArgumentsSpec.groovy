package uk.ac.cam.lib.cudl.xsltnail

import io.vavr.Tuple
import io.vavr.collection.HashMap
import io.vavr.collection.List
import io.vavr.collection.Map
import io.vavr.control.Either
import io.vavr.control.Option
import spock.lang.Specification;
import spock.lang.Unroll

import static uk.ac.cam.lib.cudl.xsltnail.XSLTNailArguments.Parsers.*

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

    @Unroll
    def "parse()"(args, expected) {
        when:
        def result = XSLTNailArguments._parse(args)

        then:
        result == expected

        where:
        [args, expected] << [
            // FIXME: Need to ensure --system-identifier or <xml-file> are provided
            [["transform", "foo", "bar"],
             ["--": false, "--help": false, "--version": false, "transform": true,
              "--system-identifier": null, "<xslt-file>": "foo", "<xml-file>": "bar"]],
            [["transform", "--system-identifier", "abc", "foo", "bar"],
             ["--": false, "--help": false, "--version": false, "transform": true,
              "--system-identifier": "abc", "<xslt-file>": "foo", "<xml-file>": "bar"]],
            [["transform", "--system-identifier=abc", "foo", "bar"],
             ["--": false, "--help": false, "--version": false, "transform": true,
              "--system-identifier": "abc", "<xslt-file>": "foo", "<xml-file>": "bar"]],
            [["transform", "--system-identifier=abc", "--", "--foo", "--bar"],
             ["--": true, "--help": false, "--version": false, "transform": true,
              "--system-identifier": "abc", "<xslt-file>": "--foo", "<xml-file>": "--bar"]],
        ].collect { [List.ofAll(it[0]),
                     it[1] instanceof java.util.Map ?
                         Either.right(HashMap.ofAll(it[1])) :
                         Either.left(it[1] == null ? Option.none() : Option.some(it[1]))] }
    }
}
