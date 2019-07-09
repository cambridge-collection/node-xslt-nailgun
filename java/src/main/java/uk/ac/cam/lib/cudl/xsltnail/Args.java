package uk.ac.cam.lib.cudl.xsltnail;

import javax.annotation.Nonnull;
import java.util.Map;
import java.util.Optional;

final class Args {
    private Args() {}

    @Nonnull
    public static Optional<String> getString(@Nonnull Map<String, Object> args, @Nonnull String name) {
        return get(args, name, String.class);
    }

    public static <T> Optional<T> get(@Nonnull Map<String, Object> args, @Nonnull String name, @Nonnull Class<T> type) {
        Object value = args.get(name);
        if(type.isInstance(value))
            return Optional.of(type.cast(value));
        return Optional.empty();
    }
}
