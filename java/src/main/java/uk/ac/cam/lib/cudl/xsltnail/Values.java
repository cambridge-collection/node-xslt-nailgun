package uk.ac.cam.lib.cudl.xsltnail;

import io.vavr.Function1;
import io.vavr.PartialFunction;
import io.vavr.Tuple;
import io.vavr.Tuple2;
import io.vavr.collection.List;
import io.vavr.collection.Map;
import io.vavr.collection.Stream;
import io.vavr.control.Option;
import io.vavr.control.Try;
import java.util.NoSuchElementException;
import java.util.Objects;

final class Values {
  private Values() {}

  public static Option<String> ifString(Object value) {
    return castToString(value).toOption();
  }

  public static Try<String> castToString(Object value) {
    return as(String.class, value);
  }

  public static <T> Try<T> as(Class<T> tclass, Object value) {
    return Try.of(
        () -> {
          Objects.requireNonNull(value);
          return tclass.cast(value);
        });
  }

  private static <T> PartialFunction<T, Tuple2<Throwable, T>> failures(
      Function1<Object, ? extends Try<?>> tx) {
    return PartialFunction.unlift(
        value ->
            tx.apply(value)
                .fold(failure -> Option.of(Tuple.of(failure, value)), success -> Option.none()));
  }

  public static <T> Try<List<T>> asList(Function1<Object, Try<T>> castElement, Object value) {
    @SuppressWarnings("unchecked")
    Try<List<?>> list = (Try<List<?>>) (Object) Values.as(List.class, value);

    return list.flatMap(
        v ->
            Stream.ofAll(v)
                .collect(failures(castElement))
                .headOption()
                .fold(
                    () -> {
                      @SuppressWarnings("unchecked")
                      Try<List<T>> result = (Try<List<T>>) (Object) list;
                      return result;
                    },
                    firstCastError ->
                        Try.failure(
                            new IllegalArgumentException(
                                String.format(
                                    "Cannot cast value to List: Failed to cast element %s: %s",
                                    firstCastError._2, firstCastError._1.getMessage()),
                                firstCastError._1))));
  }

  static <K, V> Try<V> requireKey(Map<K, V> map, K key) {
    return map.get(key)
        .toTry(
            () ->
                new NoSuchElementException(String.format("Required key does not exist: %s", key)));
  }

  public static <T> Try<T> tryFromValueOrError(T value, Throwable err) {
    if (err != null) {
      if (value != null) {
        throw new IllegalArgumentException("value must be null if error is provided");
      }
      return Try.failure(err);
    }
    return Try.success(value);
  }
}
