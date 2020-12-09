package uk.ac.cam.lib.cudl.xsltnail;

import com.facebook.nailgun.NGServer;
import io.vavr.control.Option;
import io.vavr.control.Try;
import java.io.IOException;
import java.nio.file.Path;
import java.util.logging.ConsoleHandler;
import java.util.logging.FileHandler;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogManager;
import java.util.logging.Logger;
import java.util.logging.SimpleFormatter;

final class Logging {
  private Logging() {}

  public static final String LOG_FORMAT_PROPERTY = "java.util.logging.SimpleFormatter.format";
  public static final String LOG_FORMAT =
      "%1$tY-%1$tm-%1$td %1$tH:%1$tM:%1$tS %4$-6s "
          + ProcessHandle.current().pid()
          + " %2$s %5$s%6$s%n";

  static void configureLogging(Level level, Option<Path> destination) {
    Logger ngLog = Logger.getLogger(NGServer.class.getPackageName());
    Logger xsltNgLog = Logger.getLogger(XSLTNailgunServer.class.getPackageName());
    ngLog.setLevel(level);
    xsltNgLog.setLevel(level);
    ngLog.setUseParentHandlers(false);
    xsltNgLog.setUseParentHandlers(false);

    Handler handler =
        destination
            .map(
                path ->
                    Try.<Handler>of(() -> new FileHandler(path.toString(), true))
                        .recoverWith(
                            IOException.class,
                            e ->
                                Try.failure(
                                    new XSLTNailgunServer.FatalError(
                                        "Unable to log to path: " + path, e))))
            .getOrElse(() -> Try.success(new ConsoleHandler()))
            .get();
    handler.setFormatter(newSimpleFormatter(LOG_FORMAT));
    handler.setLevel(level);

    ngLog.addHandler(handler);
    xsltNgLog.addHandler(handler);
  }

  public static class DisabledResetLogManager extends LogManager {
    public static Option<DisabledResetLogManager> getIfInUse() {
      return Try.of(() -> (DisabledResetLogManager) LogManager.getLogManager()).toOption();
    }

    private volatile boolean isResetDisabled = false;

    public void disableReset() {
      this.isResetDisabled = true;
    }

    @Override
    public void reset() throws SecurityException {
      // Do nothing to disable shutting down until we choose to. This is called
      // by the java.util.logging JVM shutdown hook.
      reset(false);
    }

    public void reset(boolean forceReset) {
      if (forceReset || !isResetDisabled) {
        super.reset();
      }
    }
  }

  /** Create a SimpleFormatter using the specified format string. */
  private static synchronized SimpleFormatter newSimpleFormatter(String format) {
    String previousFormatValue = System.getProperty(LOG_FORMAT_PROPERTY);
    try {
      System.setProperty(LOG_FORMAT_PROPERTY, format);
      return new SimpleFormatter();
    } finally {
      if (previousFormatValue == null) {
        System.clearProperty(LOG_FORMAT_PROPERTY);
      } else {
        System.setProperty(LOG_FORMAT_PROPERTY, previousFormatValue);
      }
    }
  }
}
