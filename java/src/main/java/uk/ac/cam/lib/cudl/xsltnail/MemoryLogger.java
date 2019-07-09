package uk.ac.cam.lib.cudl.xsltnail;

import net.sf.saxon.lib.StandardLogger;

import javax.annotation.Nonnull;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.io.UnsupportedEncodingException;

/**
 * A Saxon Logger which holds logged messages in memory.
 */
final class MemoryLogger extends StandardLogger {
    public static MemoryLogger newInstance() {
        ByteArrayOutputStream errorDataSink = new ByteArrayOutputStream();
        try {
            PrintStream errorStream = new PrintStream(errorDataSink, false, "UTF-8");
            return new MemoryLogger(errorStream, errorDataSink);
        }
        catch (UnsupportedEncodingException e) { throw new AssertionError(e); }
    }

    private final PrintStream errorStream;
    private final ByteArrayOutputStream errorDataSink;

    private MemoryLogger(@Nonnull PrintStream errorStream, @Nonnull ByteArrayOutputStream errorDataSink) {
        super(errorStream);
        this.errorStream = errorStream;
        this.errorDataSink = errorDataSink;

        this.setUnicodeAware(true);
    }

    public String getLoggedMessages() {
        errorStream.flush();
        if(errorStream.checkError())
            throw new RuntimeException("PrintStream failed to write to ByteArrayOutputStream");
        try { return this.errorDataSink.toString("UTF-8"); }
        catch (UnsupportedEncodingException e) { throw new AssertionError(e); }
    }

    public void clearLoggedMessages() {
        this.errorStream.flush();
        this.errorDataSink.reset();
    }
}
