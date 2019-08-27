package uk.ac.cam.lib.cudl.xsltnail;

import io.vavr.Tuple2;
import io.vavr.collection.List;
import io.vavr.collection.Map;
import io.vavr.collection.Set;
import io.vavr.collection.Stream;
import io.vavr.control.Either;

import java.util.function.Predicate;

import static io.vavr.API.*;
import static io.vavr.Predicates.*;

class XSLTNailArguments {

    private static final Set<String> HELP_OPTIONS = List.of("-h", "--help").toSet();
    private static final Set<String> VERSION_OPTIONS = List.of("-v", "--version").toSet();

    private static final Predicate<String> IS_HELP_OPT = isIn("-h", "--help");
    private static final Predicate<String> IS_VERSION_OPT = isIn("--version");
    private static final Predicate<String> IS_KNOWN_OPT = anyOf(IS_HELP_OPT, IS_VERSION_OPT);

    private static final Map<String, Object> DEFAULT_RESULT = Map(
        "--help", false,
        "--version", false,
        "transform", false,
        "<xslt-file>", null,
        "<xml-base-uri>", null);

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
            Case($(exists(allOf(XSLTNailArguments::isOption, not(IS_KNOWN_OPT)))),
                Either.left(Constants.USAGE_TRANSFORM)),
            Case($(), () -> extractValues(args))
        );
    }

    private static Map<String, Object> withDefaults(Map<String, Object> values) {
        return values.merge(DEFAULT_RESULT);
    }

    private static List<String> getOptionCandidates(List<String> args) {
        Tuple2<List<String>, List<String>> split = args.splitAt(isIn("--"));
        // The first half contains all the elements if "--" does not occur
        return split._2().isEmpty() ? split._1(): List.empty();
    }

    private static List<String> getPositionals(List<String> args) {
        return args.splitAt(isIn("--")).apply((a, b) -> {
            a = a.filter(not(XSLTNailArguments::isOption));
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
