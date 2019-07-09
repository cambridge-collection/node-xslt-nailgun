package uk.ac.cam.lib.cudl.xsltnail;

import com.facebook.nailgun.NGContext;
import com.facebook.nailgun.NGServer;
import com.github.benmanes.caffeine.cache.AsyncCacheLoader;
import com.github.benmanes.caffeine.cache.AsyncLoadingCache;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.vavr.control.Either;
import net.sf.saxon.lib.Logger;
import net.sf.saxon.lib.StandardErrorListener;
import net.sf.saxon.s9api.Processor;
import net.sf.saxon.s9api.SaxonApiException;
import net.sf.saxon.s9api.Xslt30Transformer;
import org.docopt.DocoptExitException;

import javax.annotation.Nonnull;
import javax.xml.transform.stream.StreamSource;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Path;
import java.time.Duration;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.*;

import static java.util.concurrent.Executors.newFixedThreadPool;

public class XSLTNail implements AutoCloseable {
    private static final java.util.logging.Logger LOG = java.util.logging.Logger.getLogger(XSLTNail.class.getName());

    public static final int EXIT_STATUS_INTERNAL_ERROR = 1;
    public static final int EXIT_STATUS_USER_ERROR = 2;

    private static final Cache<NGServer, XSLTNail> NAILS = Caffeine.newBuilder().weakKeys().build();

    public static void nailShutdown(@Nonnull NGServer server) {
        Optional.ofNullable(NAILS.getIfPresent(server)).ifPresent(nail -> {
            NAILS.invalidate(server);
            nail.close();
        });
    }

    public static void nailMain(@Nonnull NGContext context) {
        NGServer server = context.getNGServer();
        XSLTNail nail = NAILS.get(server, s -> XSLTNail.newInstance());

        try {
            Map<String, Object> args = Constants.USAGE_TRANSFORM.parse(context.getArgs());
            XSLTTransformOperation op = XSLTTransformOperation.fromParsedArguments(args);
            Either<String, Void> result = nail.transform(op, context.in, context.out);
            result.orElseRun(error -> {
                context.err.println(error);
                context.exit(EXIT_STATUS_USER_ERROR);
            });
        }
        catch(DocoptExitException e) {
            String message = e.getMessage();

            // The Docopt exception has no message when docopt would print the
            // short usage text. Docopt doesn't provide a way for us to do that
            // ourselves, hence this workaround.
            if(message == null) {
                message = Constants.USAGE_STRING_TRANSFORM;
            }
            context.err.println(message);
            // We don't want to use the docopt exit codes, as CLI usage errors
            // (or returning e.g. help text from --help) should not happen, and
            // are internal module errors.
            context.exit(EXIT_STATUS_INTERNAL_ERROR);
        }
        catch(XSLTNailException e) {
            context.err.println(e);
            context.exit(EXIT_STATUS_INTERNAL_ERROR);
        }
    }

    private final AsyncLoadingCache<Path, ? extends CachedXSLT> compiledXsltCache;
    private final ExecutorService xsltCompileExecutor;
    private final ExecutorService xsltEvaluateExecutor;
    private boolean closeCalled = false;

    public static XSLTNail newInstance() {
        Processor processor = new Processor(false);
        FileTimestampAsyncXSLTLoader loader = new FileTimestampAsyncXSLTLoader(processor);

        return new XSLTNail(loader, Duration.of(60, ChronoUnit.SECONDS));
    }

    XSLTNail(AsyncCacheLoader<Path, ? extends CachedXSLT> xsltLoader, Duration xsltRefreshAfterCompile) {

        this.xsltCompileExecutor = newFixedThreadPool(Runtime.getRuntime().availableProcessors() * 2);
        this.xsltEvaluateExecutor = newFixedThreadPool(Runtime.getRuntime().availableProcessors() * 2);

        this.compiledXsltCache = Caffeine.newBuilder()
            .maximumSize(100)
            .refreshAfterWrite(xsltRefreshAfterCompile)
            .executor(this.xsltCompileExecutor)
            .buildAsync(xsltLoader);
    }

    private static void setLogger(Xslt30Transformer transformer, Logger logger) {
        StandardErrorListener errorListener = Optional.of(transformer.getErrorListener())
            .map(el -> el instanceof StandardErrorListener ? (StandardErrorListener)el : null)
            .orElseThrow(() -> new AssertionError("Xslt30Transformer's error listener is not a StandardErrorListener"));

        errorListener.setLogger(logger);
    }

    public Either<String, Void> transform(@Nonnull XSLTTransformOperation operation, @Nonnull InputStream in, @Nonnull OutputStream out) {

        // We want to keep the XSLT Executor just for executing stylesheets, so we load the stylesheet in the
        // cache's executor before submitting a job to the XSLT Executor. This request handling thread is blocked
        // on both executors, but that's fine.
        CompletableFuture<Either<String, Void>> transformJob = this.compiledXsltCache.get(operation.xsltPath).thenApplyAsync((cachedXslt) -> {
            return cachedXslt.getXSLTCompilation().flatMap(executable -> {
                Xslt30Transformer tx = executable.load30();
                MemoryLogger logger = MemoryLogger.newInstance();
                setLogger(tx, logger);

                try {
                    tx.transform(new StreamSource(new BufferedInputStream(in), operation.inputIdentifier),
                        tx.newSerializer(new BufferedOutputStream(out)));
                    return Either.right(null);
                } catch (SaxonApiException e) {
                    return Either.left("Failed to execute transform: " + logger.getLoggedMessages());
                }
            });
        }, this.xsltEvaluateExecutor);

        try {
            return transformJob.get();
        }
        catch (InterruptedException | ExecutionException | CancellationException e) {
            Throwable cause = e instanceof ExecutionException ? e.getCause() : e;
            if(cause instanceof XSLTNailException)
                throw (XSLTNailException)cause;
            throw new InternalXSLTNailException("Failed to execute transform: " + e.getMessage(), cause);
        }
    }

    /**
     * Start a graceful shutdown of this XSLTNail's background threads and wait
     * for the shutdown to complete.
     *
     * Should be called before discarding references to XSLTNail objects, but
     * {@link #finalize()} will forcefully terminate background threads to avoid
     * leaking resources if this isn't done.
     */
    @Override
    public void close() {
        this.closeCalled = true;
        // We need to manually shutdown our nail's executors, otherwise their
        // threads will hang around.
        Executors.awaitTermination(TimeUnit.SECONDS.toMillis(60), this.xsltCompileExecutor, this.xsltEvaluateExecutor);
    }

    @Override
    protected void finalize() {
        // Ensure we don't leak threads if we're not shutdown via the
        // nailShutdown API.
        if(!this.closeCalled) {
            LOG.warning("An XSLTNail instance was finalized without close() being called");
            this.xsltCompileExecutor.shutdownNow();
            this.xsltEvaluateExecutor.shutdownNow();
        }
    }
}
