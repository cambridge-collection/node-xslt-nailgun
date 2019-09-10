package uk.ac.cam.lib.cudl.xsltnail;

import io.vavr.control.Either;
import net.sf.saxon.s9api.XsltExecutable;

/**
 * The result of compiling an XSLT file.
 *
 * <p>Compilation errors caused by user input (e.g. missing files, syntax errors) are considered
 * part of the value.
 */
interface CachedXSLT {
  /**
   * The compilation result - either the successfully compiled XSLT, or a String containing a
   * human-readable message describing the reason the XSLT couldn't be compiled.
   */
  Either<String, XsltExecutable> getXSLTCompilation();
}
