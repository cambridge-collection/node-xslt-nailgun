package uk.ac.cam.lib.cudl.xsltnail;

import io.vavr.collection.Map;
import io.vavr.control.Option;

import javax.annotation.Nonnull;
import java.nio.file.FileSystems;
import java.nio.file.Path;
import java.util.Objects;

public final class XSLTTransformOperation {
    public final Path xsltPath;
    public final String inputIdentifier;

    public XSLTTransformOperation(@Nonnull Path xsltPath, @Nonnull String inputIdentifier) {
        this.xsltPath = xsltPath;
        this.inputIdentifier = inputIdentifier;
    }

    @Nonnull
    public static XSLTTransformOperation fromParsedArguments(Map<String, Object> args) {
        if(!args.get("transform").exists(Boolean.TRUE::equals))
            throw new IllegalArgumentException("args are not a transform command");
        Objects.requireNonNull(args);
        Option<Path> xsltPath = args.get("<xslt-file>")
            .flatMap(Values::asString)
            .map(path -> FileSystems.getDefault().getPath(path));

        Option<String> inputIdentifier = args.get("<xml-base-uri>").flatMap(Values::asString);

        // Note that values not being present is a programming error
        return new XSLTTransformOperation(
            xsltPath.getOrElseThrow(IllegalArgumentException::new),
            inputIdentifier.getOrElseThrow(IllegalArgumentException::new));
    }
}
