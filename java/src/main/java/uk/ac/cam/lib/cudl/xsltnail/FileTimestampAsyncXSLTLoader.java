package uk.ac.cam.lib.cudl.xsltnail;

import com.github.benmanes.caffeine.cache.AsyncCacheLoader;
import io.vavr.control.Either;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import javax.annotation.Nonnull;
import javax.xml.transform.stream.StreamSource;
import net.sf.saxon.lib.StandardErrorListener;
import net.sf.saxon.s9api.Processor;
import net.sf.saxon.s9api.SaxonApiException;
import net.sf.saxon.s9api.XsltCompiler;
import net.sf.saxon.s9api.XsltExecutable;

class FileTimestampAsyncXSLTLoader
    implements AsyncCacheLoader<Path, FileTimestampAsyncXSLTLoader.FileTimestampCachedXSLT> {
  private final Processor processor;
  private final ThreadLocal<XsltCompiler> compiler;
  private final ThreadLocal<MemoryLogger> logger;

  public FileTimestampAsyncXSLTLoader(Processor processor) {
    this.processor = processor;

    // We maintain a logger and compiler per-thread
    this.logger = new ThreadLocal<>();
    this.compiler =
        ThreadLocal.withInitial(
            () -> {
              XsltCompiler c = this.processor.newXsltCompiler();
              StandardErrorListener errorListener =
                  Optional.of(c.getErrorListener())
                      .map(
                          el ->
                              el instanceof StandardErrorListener
                                  ? (StandardErrorListener) el
                                  : null)
                      .orElseThrow(
                          () ->
                              new AssertionError(
                                  "XsltCompiler's ErrorListener is not a StandardErrorListener"));
              MemoryLogger logger = MemoryLogger.newInstance();
              errorListener.setLogger(logger);
              this.logger.set(logger);
              return c;
            });
  }

  @Override
  public @Nonnull CompletableFuture<FileTimestampCachedXSLT> asyncLoad(
      @Nonnull Path key, @Nonnull Executor executor) {
    return CompletableFuture.supplyAsync(() -> this.compileXslt(key), executor);
  }

  @Override
  public @Nonnull CompletableFuture<FileTimestampCachedXSLT> asyncReload(
      @Nonnull Path key, @Nonnull FileTimestampCachedXSLT oldValue, @Nonnull Executor executor) {
    return CompletableFuture.supplyAsync(
        () -> {
          long lastModified = this.getLastModifiedTimestamp(key);
          if (lastModified == oldValue.getLastModifiedTimestamp()) return oldValue;
          return compileXslt(key, lastModified);
        },
        executor);
  }

  private long getLastModifiedTimestamp(@Nonnull Path xsltFile) {
    try {
      return Files.getLastModifiedTime(xsltFile).toMillis();
    } catch (NoSuchFileException | FileNotFoundException e) {
      // The file does not exist, so compilation itself will fail.
      // Therefore we'll allow that to happen, and just use a default
      // timestamp value.
      return Long.MIN_VALUE;
    } catch (IOException e) {
      throw new InternalXSLTNailException(
          "Failed to get XSLT file modified timestamp: " + e.getMessage(), e);
    }
  }

  @Nonnull
  private FileTimestampCachedXSLT compileXslt(@Nonnull Path xsltFile) {
    return compileXslt(xsltFile, this.getLastModifiedTimestamp(xsltFile));
  }

  @Nonnull
  private FileTimestampCachedXSLT compileXslt(@Nonnull Path xsltPath, long lastModified) {
    XsltCompiler compiler = this.compiler.get();
    MemoryLogger logger = this.logger.get();

    logger.clearLoggedMessages();
    Either<String, XsltExecutable> result;
    try {
      XsltExecutable xslt =
          compiler.compile(
              new StreamSource(
                  new FileInputStream(xsltPath.toFile()), xsltPath.toUri().toString()));

      result = Either.right(xslt);
    } catch (SaxonApiException e) {
      result = Either.left("Failed to compile XSLT: " + logger.getLoggedMessages());
    } catch (FileNotFoundException e) {
      result = Either.left("Failed to compile XSLT: " + e.getMessage());
    }
    return new FileTimestampCachedXSLT(lastModified, result);
  }

  public static final class FileTimestampCachedXSLT implements CachedXSLT {
    private final long timestamp;
    private final Either<String, XsltExecutable> xsltCompilation;

    public FileTimestampCachedXSLT(long timestamp, Either<String, XsltExecutable> xsltCompilation) {
      this.timestamp = timestamp;
      this.xsltCompilation = xsltCompilation;
    }

    @Override
    public Either<String, XsltExecutable> getXSLTCompilation() {
      return this.xsltCompilation;
    }

    public long getLastModifiedTimestamp() {
      return this.timestamp;
    }
  }
}
