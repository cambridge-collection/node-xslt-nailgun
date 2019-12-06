package uk.ac.cam.lib.cudl.xsltnail;

import io.vavr.Function2;
import io.vavr.Tuple;
import io.vavr.Tuple2;
import io.vavr.collection.*;
import io.vavr.control.Option;
import io.vavr.control.Try;
import java.nio.file.FileSystems;
import java.nio.file.Path;
import java.util.Objects;
import javax.annotation.Nonnull;
import net.sf.saxon.s9api.QName;

public final class XSLTTransformOperation {
  public final Path xsltPath;
  public final Option<Path> xmlPath;
  public final Option<String> inputIdentifier;
  public final Multimap<QName, String> parameters;

  public XSLTTransformOperation(
      @Nonnull Path xsltPath,
      @Nonnull Option<Path> xmlPath,
      @Nonnull Option<String> inputIdentifier) {
    this(xsltPath, xmlPath, inputIdentifier, HashMultimap.withSeq().empty());
  }

  public XSLTTransformOperation(
      @Nonnull Path xsltPath,
      @Nonnull Option<Path> xmlPath,
      @Nonnull Option<String> inputIdentifier,
      @Nonnull Multimap<QName, String> parameters) {
    Objects.requireNonNull(xsltPath, "xsltPath cannot be null");
    Objects.requireNonNull(xmlPath, "xmlPath cannot be null");
    Objects.requireNonNull(inputIdentifier, "inputIdentifier cannot be null");
    Objects.requireNonNull(parameters, "parameters cannot be null");
    if (xmlPath.isDefined()) Objects.requireNonNull(xmlPath.get(), "xmlPath cannot contain null");
    if (inputIdentifier.isDefined())
      Objects.requireNonNull(inputIdentifier.get(), "inputIdentifier cannot contain null");
    this.xsltPath = xsltPath;
    this.xmlPath = xmlPath;
    this.inputIdentifier = inputIdentifier;
    this.parameters = parameters;
  }

  /**
   * Create an XSLTTransformOperation from a command line args map.
   *
   * <p>The args map must contain:
   *
   * <dl>
   *   <dt>{@code <xslt-file>}
   *   <dd>The filesystem path of the xsltPath as a String
   *   <dt>{@code <xml-file>}
   *   <dd>The filesystem path of the xsltPath as a String
   * </dl>
   *
   * - bsdfs
   *
   * @param args The parsed CLI arguments.
   * @return
   */
  @Nonnull
  public static Try<XSLTTransformOperation> fromParsedArguments(Map<String, Object> args) {
    if (!Values.requireKey(args, "transform").flatMap(t -> Values.as(Boolean.class, t)).get())
      throw new IllegalArgumentException("args are not a transform command");
    Objects.requireNonNull(args);

    // Note that values not being present is a programming error. All keys must
    // exist, but only xsltPath must have a non-default value.
    Path xsltPath =
        Values.requireKey(args, "<xslt-file>")
            .flatMap(Values::castToString)
            .map(path -> FileSystems.getDefault().getPath(path))
            .get();

    Option<Path> xmlPath =
        Option.of(Values.requireKey(args, "<xml-file>").get())
            .flatMap(Values::ifString)
            .map(path -> FileSystems.getDefault().getPath(path));

    Option<String> inputIdentifier =
        Option.of(Values.requireKey(args, "--system-identifier").get()).flatMap(Values::ifString);

    List<String> rawParameters =
        Values.requireKey(args, "--parameter")
            .flatMap(o -> Values.asList(Values::castToString, o))
            .get();
    Try<Multimap<QName, String>> parameters =
        foldSuccessful(
            Stream.ofAll(rawParameters).map(XSLTTransformOperation::parseParameter),
            HashMultimap.withSeq().empty(),
            Multimap::put);

    return parameters.map(
        params -> new XSLTTransformOperation(xsltPath, xmlPath, inputIdentifier, params));
  }

  private static <T> Try<Option<T>> flip(Option<Try<T>> opt) {
    return opt.fold(() -> Try.success(Option.none()), t -> t.map(Option::some));
  }

  private static <T, R> Try<R> foldSuccessful(
      Stream<Try<T>> values, R zero, Function2<R, T, R> folder) {
    return values.foldLeft(
        Try.success(zero),
        (result, next) -> result.flatMap(partial -> next.map(val -> folder.apply(partial, val))));
  }

  private static Try<Tuple2<QName, String>> parseParameter(String parameter) {
    int split = parameter.indexOf('=');
    if (split == -1)
      return Try.failure(
          new IllegalArgumentException(
              String.format(
                  "parameters must be of the form \"Name=Value\", got: \"%s\"", parameter)));

    String name = parameter.substring(0, split);
    String value = parameter.substring(split + 1);
    return parseClarkName(name)
        .fold(
            err ->
                Try.failure(
                    new IllegalArgumentException(
                        String.format(
                            "parameter names must be qnames in Clark notation (\"{uri}local\"), got: \"%s\": %s",
                            name, err.getMessage()),
                        err)),
            qname -> Try.success(Tuple.of(qname, value)));
  }

  private static Try<QName> parseClarkName(String clarkName) {
    return Try.of(() -> QName.fromClarkName(clarkName))
        .flatMap(
            qname ->
                qname.isValid(null)
                    ? Try.success(qname)
                    : Try.failure(new IllegalArgumentException("value is not a valid qname")));
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) return true;
    if (o == null || getClass() != o.getClass()) return false;
    XSLTTransformOperation that = (XSLTTransformOperation) o;
    return xsltPath.equals(that.xsltPath)
        && xmlPath.equals(that.xmlPath)
        && inputIdentifier.equals(that.inputIdentifier);
  }

  @Override
  public int hashCode() {
    return Objects.hash(xsltPath, xmlPath, inputIdentifier);
  }
}
