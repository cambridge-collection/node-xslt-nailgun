package uk.ac.cam.lib.cudl.xsltnail;

import javax.xml.transform.ErrorListener;
import net.sf.saxon.Configuration;
import net.sf.saxon.lib.StandardErrorListener;

public final class ErrorListeners {
  private ErrorListeners() {}

  /**
   * Assign a thread safe error listener (pointing to an in-memory log sink) to an object capable of
   * being asigned an ErrorListener.
   *
   * <p>Many classes in Saxon's API use error listeners, and they inherit them from the global
   * processor, so it's important to not use the default error listener when errors need to be kept
   * separate.
   *
   * @param errorListenerReceiver An object which maintains an ErrorListener
   */
  public static MemoryLogger assignThreadSafeErrorListener(
      ErrorListenerReceiver errorListenerReceiver) {
    StandardErrorListener errorListener = new StandardErrorListener();
    errorListener.setRecoveryPolicy(Configuration.RECOVER_WITH_WARNINGS);
    MemoryLogger memoryLogger = MemoryLogger.newInstance();
    errorListener.setLogger(memoryLogger);
    errorListenerReceiver.setErrorListener(errorListener);
    return memoryLogger;
  }

  interface ErrorListenerReceiver {
    void setErrorListener(ErrorListener errorListener);
  }
}
