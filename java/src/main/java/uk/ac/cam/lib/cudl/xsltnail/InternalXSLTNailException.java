package uk.ac.cam.lib.cudl.xsltnail;

/**
 * An error not caused by user input.
 */
public class InternalXSLTNailException extends XSLTNailException {
    public InternalXSLTNailException() { }
    public InternalXSLTNailException(String message) { super(message); }
    public InternalXSLTNailException(String message, Throwable cause) { super(message, cause); }
    public InternalXSLTNailException(Throwable cause) { super(cause); }
}
