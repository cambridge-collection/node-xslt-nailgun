package uk.ac.cam.lib.cudl.xsltnail;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.stream.Collectors;

public final class Constants {
  public static final int EXIT_STATUS_INTERNAL_ERROR = 1;
  public static final int EXIT_STATUS_USER_ERROR = 2;

  public static final String VERSION = "0.0.0";
  public static final long SHUTDOWN_GRACE_PERIOD = 1000 * 5;

  // Docopt doesn't provide a way to get at just the usage section of the
  // parsed help (which we need when manually printing usage), so we have to
  // extract it ourselves...
  public static final String USAGE_TRANSFORM =
      ("Usage:\n"
          + "    xslt transform [options] [--] <xslt-file> <xml-base-uri>"
          + "    xslt transform (--help|-h)"
          + "    xslt transform --version");

  private static String getResourceAsString(Class<?> clazz, String path, Charset charset)
      throws IOException {
    Objects.requireNonNull(clazz, "clazz may not be null");
    Objects.requireNonNull(path, "path may not be null");
    Objects.requireNonNull(charset, "charset may not be null");

    try (InputStreamReader resourceStream =
            new InputStreamReader(clazz.getResourceAsStream(path), charset);
        BufferedReader buffer = new BufferedReader(resourceStream)) {
      return buffer.lines().collect(Collectors.joining("\n"));
    }
  }

  private static String requireResourceAsString(Class<?> clazz, String path) {
    return requireResourceAsString(clazz, path, StandardCharsets.UTF_8);
  }

  private static String requireResourceAsString(Class<?> clazz, String path, Charset charset) {
    try {
      return getResourceAsString(clazz, path, charset);
    } catch (IOException e) {
      throw new RuntimeException(
          String.format("Failed to read %s relative to %s", path, clazz.getCanonicalName()), e);
    }
  }

  private static String getTransformDoc() {
    String template = requireResourceAsString(Constants.class, "xslt-nail-usage.txt");
    return String.format(template, USAGE_TRANSFORM);
  }

  static final String USAGE_TRANSFORM_FULL = getTransformDoc();

  static final String USAGE_SERVER =
      requireResourceAsString(Constants.class, "nailgun-server-usage.txt");

  private Constants() {}
}
