package uk.ac.cam.lib.cudl.xsltnail;

import static java.util.concurrent.Executors.newFixedThreadPool;
import static uk.ac.cam.lib.cudl.xsltnail.Constants.EXIT_STATUS_INTERNAL_ERROR;
import static uk.ac.cam.lib.cudl.xsltnail.Constants.EXIT_STATUS_USER_ERROR;

import com.facebook.nailgun.NGContext;
import com.facebook.nailgun.NGServer;
import com.github.benmanes.caffeine.cache.AsyncCacheLoader;
import com.github.benmanes.caffeine.cache.AsyncLoadingCache;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.vavr.Tuple;
import io.vavr.Tuple2;
import io.vavr.collection.Map;
import io.vavr.collection.Multimap;
import io.vavr.control.Either;
import io.vavr.control.Option;
import java.io.*;
import java.nio.file.FileSystem;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.*;
import java.util.logging.Logger;
import javax.annotation.Nonnull;
import javax.xml.transform.Source;
import javax.xml.transform.stream.StreamSource;
import net.sf.saxon.lib.Feature;
import net.sf.saxon.s9api.*;
import net.sf.saxon.trans.RecoveryPolicy;
import net.sf.saxon.value.UntypedAtomicValue;

public class XSLTNail implements AutoCloseable {
  private static final Logger LOG = Logger.getLogger(XSLTNail.class.getName());

  private static final Cache<NGServer, XSLTNail> NAILS = Caffeine.newBuilder().weakKeys().build();

  public static void nailShutdown(@Nonnull NGServer server) {
    Optional.ofNullable(NAILS.getIfPresent(server))
        .ifPresent(
            nail -> {
              NAILS.invalidate(server);
              nail.close();
            });
  }

  public static void nailMain(@Nonnull NGContext context) {
    try {
      NGServer server = context.getNGServer();
      XSLTNail nail = NAILS.get(server, s -> XSLTNail.newInstance());
      Objects.requireNonNull(nail, "nail cache returned null");

      XSLTNailArguments.parse(context.getArgs())
          .mapLeft(XSLTNail::handleInvalidArgumentMessage)
          .flatMap(XSLTNail::handleHelpRequest)
          .flatMap(XSLTNail::handleVersion)
          .flatMap(
              args ->
                  XSLTTransformOperation.fromParsedArguments(args)
                      .toEither()
                      .mapLeft(Throwable::getMessage))
          .mapLeft(msg -> Tuple.of(msg, EXIT_STATUS_INTERNAL_ERROR))
          .flatMap(op -> nail.transform(op, context.in, context.out))
          .orElseRun(
              unsuccessfulResult -> {
                context.err.println(unsuccessfulResult._1());
                context.exit(unsuccessfulResult._2);
              });
    } catch (RuntimeException e) {
      context.err.println(
          "XSLT execution failed with an internal error, this is most likely a bug:");
      e.printStackTrace(context.err);
      context.exit(EXIT_STATUS_INTERNAL_ERROR);
    }
  }

  private static String handleInvalidArgumentMessage(Option<String> message) {
    return message
        .map(m -> String.format("Error: %s\n\n%s", m, Constants.USAGE_TRANSFORM))
        .getOrElse(Constants.USAGE_TRANSFORM);
  }

  private static Either<String, Map<String, Object>> handleHelpRequest(Map<String, Object> args) {
    return args.get("--help").exists(Boolean.TRUE::equals)
        ? Either.left(Constants.USAGE_TRANSFORM_FULL)
        : Either.right(args);
  }

  private static Either<String, Map<String, Object>> handleVersion(Map<String, Object> args) {
    return args.get("--version").exists(Boolean.TRUE::equals)
        ? Either.left(Constants.VERSION)
        : Either.right(args);
  }

  private final AsyncLoadingCache<Path, ? extends CachedXSLT> compiledXsltCache;
  private final ExecutorService xsltCompileExecutor;
  private final ExecutorService xsltEvaluateExecutor;
  private boolean closeCalled = false;

  public static XSLTNail newInstance() {
    Processor processor = new Processor(false);
    processor.setConfigurationProperty(
        Feature.RECOVERY_POLICY, RecoveryPolicy.RECOVER_WITH_WARNINGS.ordinal());
    FileTimestampAsyncXSLTLoader loader = new FileTimestampAsyncXSLTLoader(processor);

    return new XSLTNail(loader, Duration.of(60, ChronoUnit.SECONDS));
  }

  XSLTNail(
      AsyncCacheLoader<Path, ? extends CachedXSLT> xsltLoader, Duration xsltRefreshAfterCompile) {

    this.xsltCompileExecutor = newFixedThreadPool(Runtime.getRuntime().availableProcessors() * 2);
    this.xsltEvaluateExecutor = newFixedThreadPool(Runtime.getRuntime().availableProcessors() * 2);

    this.compiledXsltCache =
        Caffeine.newBuilder()
            .maximumSize(100)
            .refreshAfterWrite(xsltRefreshAfterCompile)
            .executor(this.xsltCompileExecutor)
            .buildAsync(xsltLoader);
  }

  public Either<Tuple2<String, Integer>, Void> transform(
      @Nonnull XSLTTransformOperation operation,
      @Nonnull InputStream in,
      @Nonnull OutputStream out) {

    // We want to keep the XSLT Executor just for executing stylesheets, so we load the stylesheet
    // in the
    // cache's executor before submitting a job to the XSLT Executor. This request handling thread
    // is blocked
    // on both executors, but that's fine.
    CompletableFuture<Either<String, Void>> transformJob =
        this.compiledXsltCache
            .get(operation.xsltPath)
            .thenApplyAsync(
                cachedXslt ->
                    cachedXslt
                        .getXSLTCompilation()
                        .flatMap(executable -> executeTransform(executable, operation, in, out)),
                this.xsltEvaluateExecutor);

    try {
      return transformJob.get().mapLeft(msg -> Tuple.of(msg, EXIT_STATUS_USER_ERROR));
    } catch (InterruptedException | ExecutionException | CancellationException e) {
      Throwable cause = e instanceof ExecutionException ? e.getCause() : e;
      if (cause instanceof XSLTNailException) throw (XSLTNailException) cause;
      throw new InternalXSLTNailException("Failed to execute transform: " + e, cause);
    }
  }

  private static Either<String, Void> executeTransform(
      XsltExecutable executable,
      XSLTTransformOperation operation,
      InputStream in,
      OutputStream out) {
    Xslt30Transformer tx = executable.load30();
    MemoryLogger logger = SaxonErrors.assignThreadSafeErrorReporter(tx::setErrorReporter);

    return getSource(operation, in)
        .flatMap(
            source -> {
              try {
                tx.setStylesheetParameters(
                    buildStylesheetParameters(operation.parameters).toJavaMap());
                tx.transform(source, tx.newSerializer(new BufferedOutputStream(out)));
                return Either.right(null);
              } catch (SaxonApiException e) {
                return Either.left("Failed to execute transform: " + logger.getLoggedMessages());
              }
            });
  }

  private static Map<QName, XdmValue> buildStylesheetParameters(Multimap<QName, String> values) {
    // Parameter values are sequences of 0 or more strings. They're provided to the transformer as
    // xs:untypedAtomic values, which results in the transformer applying standard conversion rules
    // to cast them to the actual types of parameters.
    return values
        .asMap()
        .map((k, v) -> Tuple.of(k, XdmAtomicValue.makeSequence(v.map(UntypedAtomicValue::new))));
  }

  private static Either<String, Source> getSource(
      @Nonnull XSLTTransformOperation operation, @Nonnull InputStream stdin) {
    if (!operation.xmlPath.isDefined() && operation.inputIdentifier.isDefined()) {
      // No input is specified, so the source just references the system identifier
      return Either.right(new StreamSource(operation.inputIdentifier.get()));
    }

    FileSystem fs =
        operation.xmlPath.map(Path::getFileSystem).getOrElse(operation.xsltPath.getFileSystem());
    Path stdinPath = fs.getPath("-");
    Path xml = operation.xmlPath.getOrElse(stdinPath);
    if (stdinPath.equals(xml)) {
      return Either.right(
          new StreamSource(stdin, operation.inputIdentifier.getOrElse((String) null)));
    }
    // Use the contents of the file on disk; the system ID is the file:// URI of the path unless
    // overridden by
    // specifying a system identifier.
    try {
      return Either.right(
          new StreamSource(
              Files.newBufferedReader(xml),
              operation.inputIdentifier.getOrElse(() -> xml.toUri().toString())));
    } catch (IOException e) {
      return Either.left(
          String.format("Unable to open <xml-file> \"%s\" - %s", xml.toString(), e.getMessage()));
    }
  }

  /**
   * Start a graceful shutdown of this XSLTNail's background threads and wait for the shutdown to
   * complete.
   *
   * <p>Should be called before discarding references to XSLTNail objects, but {@link #finalize()}
   * will forcefully terminate background threads to avoid leaking resources if this isn't done.
   */
  @Override
  public void close() {
    this.closeCalled = true;
    // We need to manually shutdown our nail's executors, otherwise their
    // threads will hang around.
    Executors.awaitTermination(
        TimeUnit.SECONDS.toMillis(60), this.xsltCompileExecutor, this.xsltEvaluateExecutor);
  }

  @Override
  protected void finalize() {
    // Ensure we don't leak threads if we're not shutdown via the
    // nailShutdown API.
    if (!this.closeCalled) {
      LOG.warning("An XSLTNail instance was finalized without close() being called");
      this.xsltCompileExecutor.shutdownNow();
      this.xsltEvaluateExecutor.shutdownNow();
    }
  }
}
