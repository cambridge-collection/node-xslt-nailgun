package uk.ac.cam.lib.cudl.xsltnail;

import javax.xml.transform.ErrorListener;
import net.sf.saxon.lib.ErrorReporter;
import net.sf.saxon.lib.StandardErrorReporter;

public final class SaxonErrors {
  private SaxonErrors() {}

  /**
   * Assign a thread safe error reporter (pointing to an in-memory log sink) to an object capable of
   * being assigned an ErrorReporter.
   *
   * <p>Many classes in Saxon's API use error reporters, and they inherit them from the global
   * processor, so it's important to not use the default error reporter when errors need to be kept
   * separate.
   *
   * @param errorReporterReceiver An object which maintains an ErrorReporter
   */
  public static MemoryLogger assignThreadSafeErrorReporter(
      ErrorReporterReceiver errorReporterReceiver) {
    StandardErrorReporter errorReporter = new StandardErrorReporter();
    MemoryLogger memoryLogger = MemoryLogger.newInstance();
    errorReporter.setLogger(memoryLogger);
    errorReporterReceiver.setErrorReporter(errorReporter);
    return memoryLogger;
  }

  interface ErrorListenerReceiver {
    void setErrorListener(ErrorListener errorListener);
  }

  interface ErrorReporterReceiver {
    void setErrorReporter(ErrorReporter errorReporter);
  }
}
