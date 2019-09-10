package uk.ac.cam.lib.cudl.xsltnail;

import io.vavr.control.Option;

final class Values {
  private Values() {}

  public static Option<String> asString(Object value) {
    return value instanceof String ? Option.some((String) value) : Option.none();
  }
}
