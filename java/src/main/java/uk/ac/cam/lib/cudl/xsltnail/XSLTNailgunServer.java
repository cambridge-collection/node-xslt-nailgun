package uk.ac.cam.lib.cudl.xsltnail;

import static java.lang.String.format;

import com.facebook.nailgun.*;
import com.facebook.nailgun.builtins.NGStop;
import io.vavr.Predicates;
import io.vavr.collection.HashMap;
import io.vavr.collection.Map;
import io.vavr.collection.Stream;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.logging.ConsoleHandler;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.docopt.Docopt;

public final class XSLTNailgunServer {
  private XSLTNailgunServer() {}

  /**
   * Parse an argument list according to {@link Constants#USAGE_SERVER}. Help text or version info
   * is printed and the JVM terminated if requested, or if the args do not conform to the expected
   * structure.
   */
  private static Map<String, Object> handleServerCLIArgs(String[] args) {
    // Note that Docopt instances are not safe to reuse
    return HashMap.ofAll(
        new Docopt(Constants.USAGE_SERVER)
            .withExit(true)
            .withHelp(true)
            .withVersion(Constants.VERSION)
            .parse(args));
  }

  public static void main(String[] args) {
    try {
      main(
          handleServerCLIArgs(args),
          address ->
              new NGServer(
                  address, NGServer.DEFAULT_SESSIONPOOLSIZE, NGConstants.HEARTBEAT_TIMEOUT_MILLIS));
    } catch (FatalError e) {
      System.err.format("Error: %s", e.getMessage());
      System.exit(1);
      throw new AssertionError();
    }
  }

  interface ServerFactory {
    NGServer createServer(NGListeningAddress address);
  }

  static void main(io.vavr.collection.Map<String, Object> args, ServerFactory serverFactory) {
    configureLogging(
        args.get("--log-level")
            .flatMap(Values::asString)
            .map(
                level -> {
                  try {
                    return Level.parse(level);
                  } catch (IllegalArgumentException e) {
                    throw new FatalError(format("Invalid --log-level: %s", level), e);
                  }
                })
            .getOrElse(Level.WARNING));

    NGListeningAddress listenAddress = getAddress(args);
    NGServer server = serverFactory.createServer(listenAddress);

    server.setAllowNailsByClassName(false);
    removeDefaultAliases(server.getAliasManager());
    server
        .getAliasManager()
        .addAlias(new Alias("xslt", "Apply an XSLT program to an XML document.", XSLTNail.class));

    Runtime.getRuntime()
        .addShutdownHook(
            new Thread(
                () -> {
                  server.shutdown();

                  long limit = System.currentTimeMillis() + Constants.SHUTDOWN_GRACE_PERIOD;
                  while (server.isRunning() && System.currentTimeMillis() < limit) {
                    try {
                      Thread.sleep(100);
                    } catch (InterruptedException e) {
                      /* ignored */
                    }
                  }

                  if (server.isRunning()) System.err.println("NGServer failed to shutdown cleanly");
                }));

    try {
      server.run();
    } finally {
      // Support for nailShutdown() was removed from Nailgun server in
      // this PR: https://github.com/facebook/nailgun/pull/131
      // It doesn't seem to have been announced though, example code
      // still uses it. We'll invoke it ourselves for now.
      XSLTNail.nailShutdown(server);
    }
  }

  private static Stream<Alias> getAliases(AliasManager am) {
    return io.vavr.collection.Stream.of(am.getAliases())
        .map(o -> o instanceof Alias ? (Alias) o : null)
        .filter(Predicates.isNotNull());
  }

  private static void removeDefaultAliases(AliasManager am) {
    getAliases(am)
        .forEach(
            alias -> {
              if (!NGStop.class.equals(alias.getAliasedClass())) am.removeAlias(alias.getName());
            });
  }

  private static NGListeningAddress getAddress(Map<String, Object> args) {
    String address =
        args.get("<address>").flatMap(Values::asString).getOrElseThrow(AssertionError::new);
    AddressType type =
        args.get("--address-type")
            .flatMap(Values::asString)
            .map(
                value -> {
                  if (value.toLowerCase().equals(value)) {
                    try {
                      return AddressType.valueOf(value.toUpperCase());
                    } catch (IllegalArgumentException e) {
                      /* ignored */
                    }
                  }
                  throw new FatalError(
                      format(
                          "If specified, --address-type must be \"local\" or \"network\", got: \"%s\"",
                          value));
                })
            .getOrElse(() -> AddressType.guessAddressType(address));

    return type.parseAddress(address);
  }

  private enum AddressType {
    LOCAL {
      @Override
      protected NGListeningAddress parseAddress(String address) {
        return new NGListeningAddress(address);
      }
    },
    NETWORK {
      @Override
      protected NGListeningAddress parseAddress(String address) {
        Matcher match = NETWORK_ADDRESS.matcher(address);
        if (!match.matches()) throw new FatalError(format("Invalid <address>: %s", address));

        InetAddress addr;
        try {
          addr = InetAddress.getByName(match.group(1));
        } catch (UnknownHostException e) {
          throw new FatalError(
              format("Unable to listen on \"%s\": %s", match.group(1), e.getMessage()), e);
        }

        int port;
        try {
          port = Integer.parseInt(match.group(2));
        } catch (NumberFormatException e) {
          throw new FatalError(String.format("Invalid <address> port: %s", match.group(2)), e);
        }
        return new NGListeningAddress(addr, port);
      }
    };

    private static final Pattern NETWORK_ADDRESS = Pattern.compile("^(.*):([\\d]+)$");
    private static final Pattern CONTAINS_PATH_CHARS = Pattern.compile("(?:^[\\\\./]]|[\\\\/])");

    public static AddressType guessAddressType(String address) {
      if (CONTAINS_PATH_CHARS.matcher(address).find()) return LOCAL;
      return NETWORK;
    }

    protected abstract NGListeningAddress parseAddress(String address);
  }

  private static void configureLogging(Level level) {
    Logger nglog = Logger.getLogger("com.facebook.nailgun");
    nglog.setLevel(level);
    nglog.setUseParentHandlers(false);
    nglog.addHandler(new ConsoleHandler());
    Logger.getLogger(NGServer.class.getName()).setLevel(level);
    Logger.getLogger(NGSession.class.getName()).setLevel(level);
    Logger.getLogger(NGCommunicator.class.getName()).setLevel(level);
  }

  static class FatalError extends RuntimeException {
    public FatalError(String message) {
      super(message);
    }

    public FatalError(String message, Throwable cause) {
      super(message, cause);
    }
  }
}
