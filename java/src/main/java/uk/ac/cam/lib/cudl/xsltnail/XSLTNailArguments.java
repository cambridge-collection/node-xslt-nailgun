package uk.ac.cam.lib.cudl.xsltnail;

import io.vavr.Predicates;
import io.vavr.Tuple;
import io.vavr.Tuple2;
import io.vavr.collection.*;
import io.vavr.control.Either;
import io.vavr.Predicates;
import io.vavr.control.Option;

import java.util.HashMap;
import java.util.Objects;
import java.util.OptionalInt;
import java.util.function.Predicate;
import java.util.regex.Pattern;

import static io.vavr.API.*;
import static io.vavr.Predicates.isIn;
import static io.vavr.Predicates.anyOf;
import static io.vavr.Predicates.exists;
import static uk.ac.cam.lib.cudl.xsltnail.XSLTNailArguments.Parsers.*;

class XSLTNailArguments {

    private static final Set<String> HELP_OPTIONS = List.of("-h", "--help").toSet();
    private static final Set<String> VERSION_OPTIONS = List.of("-v", "--version").toSet();
    private static final Set<String> VALUE_OPTIONS = List.of("--system-identifier").toSet();

    private static final Predicate<String> IS_HELP_OPT = isIn("-h", "--help");
    private static final Predicate<String> IS_VERSION_OPT = isIn("--version");
    private static final Predicate<String> IS_KNOWN_OPT = anyOf(IS_HELP_OPT, IS_VERSION_OPT);

    interface Parser {
        Either<String, Tuple2<List<Tuple2<String, Object>>, List<String>>>
        parse(List<Tuple2<String, Object>> values, List<String> args);

        default Either<String, Tuple2<List<Tuple2<String, Object>>, List<String>>> parse(List<String> args) {
            return parse(List.empty(), args);
        }
    }

    static final class Parsers {

        public static Parser constant(String value) {
            return (List<Tuple2<String, Object>> values, List<String> args) ->
                args.length() > 0 && value.equals(args.get(0)) ?
                    success(recordValue(values, value, true), args.drop(1)) : failure(value);
        }

        public static Parser option(String name) { return option(name, name); }
        public static Parser option(String name, String key) {
            return (List<Tuple2<String, Object>> values, List<String> args) ->
                constant(name).parse(List.empty(), args)
                    .map(result -> result.update1(recordValue(values, key, true)));
        }

        public static Parser optionWithValue(String name) { return optionWithValue(name, name); }
        public static Parser optionWithValue(String name, String key) {
            String nameWithEquals = name + "=";
            return (List<Tuple2<String, Object>> values, List<String> args) -> {
                if(args.length() > 0 && args.get(0).startsWith(nameWithEquals)) {
                    String value = args.get(0).substring(nameWithEquals.length());
                    return success(recordValue(values, key, value), args.drop(1));
                }
                else if(args.length() > 1 && args.get(0).equals(name)) {
                    return success(recordValue(values, key, args.get(1)), args.drop(2));
                }
                return failure(nameWithEquals);
            };
        }

        public static Parser value(String key) {
            return (List<Tuple2<String, Object>> values, List<String> args) ->
                args.length() > 0 ? success(recordValue(values, key, args.get(0)), args.drop(1)) : failure(key);
        }

        public static Parser regex(String pattern, String key) {
            Pattern p = Pattern.compile(pattern);
            return (List<Tuple2<String, Object>> values, List<String> args) ->
                !args.isEmpty() && p.matcher(args.get(0)).matches() ?
                    success(recordValue(values, key, args.get(0)), args.drop(1)) : failure(key);
        }

        public static Parser any() {
            return (List<Tuple2<String, Object>> values, List<String> args) ->
                value("*").parse(values, args).flatMap(result -> success(values, result._2));
        }

        public static Parser allOf(Parser... parsers) {
            return allOf(List.of(parsers));
        }

        public static Parser allOf(List<Parser> parsers) {
            return (List<Tuple2<String, Object>> values, List<String> args) ->
                parsers.foldLeft(success(values, args), (prev, parser) ->
                    prev.flatMap(_prev -> parser.parse(_prev._1, _prev._2)));
        }

        public static Parser firstOf(Parser... parsers) {
            return firstOf(List.of(parsers));
        }

        public static Parser firstOf(List<Parser> parsers) {
            return (List<Tuple2<String, Object>> values, List<String> args) ->
                parsers.isEmpty() ? failure("firstOf([])") :
                parsers.toStream().map(p -> p.parse(values, args)).zipWithIndex()
                    .filter(entry -> entry._1.isRight() || entry._2 == parsers.length() - 1)
                    .map(entry -> entry._1)
                    .get();
        }

        public static Parser times(Parser parser, int min) { return times(parser, min, OptionalInt.empty()); }
        public static Parser times(Parser parser, int min, int max) { return times(parser, min, OptionalInt.of(max)); }
        public static Parser times(Parser parser, int min, OptionalInt max) {
            Objects.requireNonNull(max, "max cannot be null");
            if(min < 0)
                throw new IllegalArgumentException(String.format("min must be >= 0; min=%d", min));
            if(max.isPresent() && max.getAsInt() < min)
                throw new IllegalArgumentException(String.format("max must be >= min; min=%d, max=%d", min, max.getAsInt()));

            return (List<Tuple2<String, Object>> values, List<String> args) -> {
                Either<String, Tuple2<List<Tuple2<String, Object>>, List<String>>> result = failure("times(*, 0, 0)");
                for(int i = 0; !max.isPresent() || i < max.getAsInt(); ++i) {
                    result = parser.parse(values, args);
                    if(result.isLeft())
                        return i >= min ? success(values, args) : result;
                    values = result.get()._1;
                    args = result.get()._2;
                }
                return result;
            };
        }

        public static Parser opt(Parser parser) {
            return times(parser, 0, 1);
        }

        public static Parser not(Parser parser, String desc) {
            return (List<Tuple2<String, Object>> values, List<String> args) -> {
                Either<String, Tuple2<List<Tuple2<String, Object>>, List<String>>> result = parser.parse(values, args);
                if(result.isRight())
                    return failure(desc);
                // Don't consume any input
                return success(values, args);
            };
        }

        private static List<Tuple2<String, Object>> recordValue(List<Tuple2<String, Object>> values, String key, Object value) {
            return values.prepend(Tuple.of(key, value));
        }

        private static Either<String, Tuple2<List<Tuple2<String, Object>>, List<String>>>
            success(List<Tuple2<String, Object>> context, List<String> remaining) {
            return Either.right(Tuple.of(context, remaining));
        }

        private static Either<String, Tuple2<List<Tuple2<String, Object>>, List<String>>>
        failure(String failure) {
            return Either.left(failure);
        }
    }

    private static final Map<String, Object> DEFAULT_RESULT = Map(
        "--", false,
        "--help", false,
        "--version", false,
        "--system-identifier", null,
        "transform", false,
        "<xslt-file>", null,
        "<xml-file>", null);

    private static class XSLTNailArgumentsParser {
        private XSLTNailArgumentsParser() {}

        private static final Parser unambiguousValue(String key) { return regex("^(?:|(?!--).+)$", key); }

        private static final Parser HELP_OPTION = firstOf(option("--help"), option("-h", "--help"));
        private static final Parser VERSION_OPTION = option("--version");


        private static final Parser SUBCOMMAND_TRANSFORM = constant("transform");
        private static final Parser ARG_SEPARATOR = constant("--");
        private static final Parser SYSTEM_ID_OPTION = optionWithValue("--system-identifier");
        private static final Parser OPTIONS = opt(firstOf(SYSTEM_ID_OPTION));
        private static final Parser XSLT_FILE = value("<xslt-file>");
        private static final Parser XML_FILE = value("<xml-file>");
        private static final Parser NOT_OPTLIKE_XSLT_FILE = unambiguousValue("<xslt-file>");
        private static final Parser NOT_OPTLIKE_XML_FILE = unambiguousValue("<xml-file>");

        private static final Parser TRANSFORM = firstOf(
            allOf(SUBCOMMAND_TRANSFORM, OPTIONS, NOT_OPTLIKE_XSLT_FILE, OPTIONS, opt(allOf(NOT_OPTLIKE_XML_FILE, OPTIONS))),
            // Don't allow options after the -- argument separator
            allOf(SUBCOMMAND_TRANSFORM, OPTIONS, ARG_SEPARATOR, XSLT_FILE, opt(XML_FILE)));

        private static final Parser HELP = allOf(
            times(allOf(not(HELP_OPTION, "not --help"), any()), 0),
            HELP_OPTION, times(any(), 0));

        private static final Parser VERSION = allOf(
            times(allOf(not(VERSION_OPTION, "not --version"), any()), 0),
            VERSION_OPTION, times(any(), 0));

        private static final Parser ROOT = firstOf(TRANSFORM, HELP, VERSION);
    }

    public static Either<Option<String>, Map<String, Object>> _parse(String... args) { return _parse(List.of(args)); }
    public static Either<Option<String>, Map<String, Object>> _parse(List<String> args) {
        return XSLTNailArgumentsParser.ROOT.parse(args)
            .fold(str -> Either.left(Option.none()),
                  result -> result._2.isEmpty() ?
                      mergeValues(result._1).mapLeft(Option::some) : Either.left(Option.none()));
    }

    private static Either<String, Map<String, Object>> mergeValues(List<Tuple2<String, Object>> values) {
        Map<String, Object> result = Map();
        for(Tuple2<String, Object> value : values) {
            if(result.containsKey(value._1))
                return Either.left(String.format("duplicate argument: %s", value._1));
            result = result.put(value);
        }
        return Either.right(result.merge(DEFAULT_RESULT));
    }

    /**
     * Parse a command line argument list conforming to {@link Constants#USAGE_TRANSFORM_FULL}.
     *
     * @param argv The argument list
     * @return A right value containing a map from the symbolic names in the
     *         usage text (e.g. "<xslt-file>") to the parsed value.
     */
    public static Either<String, Map<String, Object>> parse(String[] argv) {
        List<String> args = List.of(argv);
        List<String> options = getOptionCandidates(args);

        return Match(options).of(
            Case($(exists(IS_HELP_OPT)),
                Either.right(withDefaults(Map("--help", true)))),
            Case($(exists(IS_VERSION_OPT)),
                Either.right(withDefaults(Map("--version", true)))),
            // We don't have any
            Case($(exists(Predicates.allOf(XSLTNailArguments::isOption, Predicates.not(IS_KNOWN_OPT)))),
                Either.left(Constants.USAGE_TRANSFORM)),
            Case($(), () -> extractValues(args))
        );
    }

    private static Map<String, Object> withDefaults(Map<String, Object> values) {
        return values.merge(DEFAULT_RESULT);
    }

    private static List<String> getOptionCandidates(List<String> args) {
//        Tuple2<List<String>, List<String>> split = args.splitAt(3);
        Tuple2<List<String>, List<String>> split = args.splitAt(isIn("--"));
        // The first half contains all the elements if "--" does not occur
        return split._2().isEmpty() ? split._1(): List.empty();
    }

    private static List<String> getPositionals(List<String> args) {
        return args.splitAt(isIn("--")).apply((a, b) -> {
            a = a.filter(Predicates.not(XSLTNailArguments::isOption));
            return b.isEmpty() ? a : Stream.concat(a, b.slice(1, b.length())).toList();
        });
    }

    private static Either<String, Map<String, Object>> extractValues(List<String> args) {
        List<String> positionals = getPositionals(args);

        return Match(positionals).of(
            Case($((List<String> l) -> l.length() == 3 && "transform".equals(l.get(0))), (l) ->
                Either.right(withDefaults(Map(
                    "transform", true,
                    "<xslt-file>", l.get(1),
                    "<xml-base-uri>", l.get(2))))),
            Case($(), Either.left(Constants.USAGE_TRANSFORM))
        );
    }

    private static boolean isOption(String s) {
        return (s.length() == 2 && s.startsWith("-") && !s.equals("--")) || (s.length() > 2 && s.startsWith("--"));
    }

    private XSLTNailArguments() {}
}
