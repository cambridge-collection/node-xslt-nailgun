package uk.ac.cam.lib.cudl.xsltnail;

public abstract class XSLTNailException extends RuntimeException {
    public XSLTNailException() { }
    public XSLTNailException(String message) { super(message); }
    public XSLTNailException(String message, Throwable cause) { super(message, cause); }
    public XSLTNailException(Throwable cause) { super(cause); }
}
