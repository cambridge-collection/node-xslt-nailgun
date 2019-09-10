package uk.ac.cam.lib.cudl.xsltnail;

import io.vavr.collection.Map;
import io.vavr.control.Option;
import java.nio.file.FileSystems;
import java.nio.file.Path;
import java.util.Objects;
import javax.annotation.Nonnull;

public final class XSLTTransformOperation {
  public final Path xsltPath;
  public final Option<Path> xmlPath;
  public final Option<String> inputIdentifier;

  public XSLTTransformOperation(
      @Nonnull Path xsltPath,
      @Nonnull Option<Path> xmlPath,
      @Nonnull Option<String> inputIdentifier) {
    Objects.requireNonNull(xsltPath, "xsltPath cannot be null");
    Objects.requireNonNull(xmlPath, "xmlPath cannot be null");
    Objects.requireNonNull(inputIdentifier, "inputIdentifier cannot be null");
    if (xmlPath.isDefined()) Objects.requireNonNull(xmlPath.get(), "xmlPath cannot contain null");
    if (inputIdentifier.isDefined())
      Objects.requireNonNull(inputIdentifier.get(), "inputIdentifier cannot contain null");
    this.xsltPath = xsltPath;
    this.xmlPath = xmlPath;
    this.inputIdentifier = inputIdentifier;
  }

  @Nonnull
  public static XSLTTransformOperation fromParsedArguments(Map<String, Object> args) {
    if (!args.get("transform").exists(Boolean.TRUE::equals))
      throw new IllegalArgumentException("args are not a transform command");
    Objects.requireNonNull(args);
    Option<Path> xsltPath =
        args.get("<xslt-file>")
            .flatMap(Values::asString)
            .map(path -> FileSystems.getDefault().getPath(path));
    Option<Path> xmlPath =
        args.get("<xml-file>")
            .flatMap(Values::asString)
            .map(path -> FileSystems.getDefault().getPath(path));

    Option<String> inputIdentifier = args.get("--system-identifier").flatMap(Values::asString);

    // Note that values not being present is a programming error
    return new XSLTTransformOperation(
        xsltPath.getOrElseThrow(IllegalArgumentException::new), xmlPath, inputIdentifier);
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
