package uk.ac.cam.lib.cudl.xsltnail;

import javax.annotation.Nonnull;
import java.nio.file.FileSystems;
import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;

public final class XSLTTransformOperation {
    public final Path xsltPath;
    public final String inputIdentifier;

    public XSLTTransformOperation(@Nonnull Path xsltPath, @Nonnull String inputIdentifier) {
        this.xsltPath = xsltPath;
        this.inputIdentifier = inputIdentifier;
    }

    @Nonnull
    public static XSLTTransformOperation fromParsedArguments(Map<String, Object> args) {
        Optional<Path> xsltPath = Args.getString(args, "<xslt-file>")
            .map(FileSystems.getDefault()::getPath);

        Optional<String> inputIdentifier = Args.getString(args, "<xml-base-uri>");

        return new XSLTTransformOperation(
            xsltPath.orElseThrow(IllegalArgumentException::new),
            inputIdentifier.orElseThrow(IllegalArgumentException::new));
    }
}
