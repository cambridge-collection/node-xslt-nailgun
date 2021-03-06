package uk.ac.cam.lib.cudl.xsltnail;

import static java.lang.String.format;
import static uk.ac.cam.lib.cudl.xsltnail.Values.ifString;
import static uk.ac.cam.lib.cudl.xsltnail.Values.requireKey;

import com.facebook.nailgun.Alias;
import com.facebook.nailgun.AliasManager;
import com.facebook.nailgun.NGConstants;
import com.facebook.nailgun.NGListeningAddress;
import com.facebook.nailgun.NGServer;
import com.facebook.nailgun.builtins.NGStop;
import io.vavr.PartialFunction;
import io.vavr.Predicates;
import io.vavr.Tuple;
import io.vavr.collection.HashMap;
import io.vavr.collection.Map;
import io.vavr.collection.Stream;
import io.vavr.control.Option;
import io.vavr.control.Try;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.file.Path;
import java.util.concurrent.ExecutionException;
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

  static Map<String, String> getEnvironmentVariables(java.util.Map<String, String> environ) {
    return Stream.ofAll(Constants.ENVARS)
        .map(name -> Option.of(environ.get(name)).map(value -> Tuple.of(name, value)))
        .collect(PartialFunction.getIfDefined())
        .collect(HashMap.collector());
  }

  public static void main(String[] args) {
    System.setProperty(
        "java.util.logging.manager", Logging.DisabledResetLogManager.class.getName());
    try {
      main(
          handleServerCLIArgs(args),
          getEnvironmentVariables(System.getenv()),
          address ->
              new NGServer(
                  address, NGServer.DEFAULT_SESSIONPOOLSIZE, NGConstants.HEARTBEAT_TIMEOUT_MILLIS));
    } catch (FatalError e) {
      System.err.format("Error: %s\n", e.getMessage().stripTrailing());
      System.exit(Constants.EXIT_STATUS_USER_ERROR);
      throw new AssertionError();
    }
  }

  static void main(
      Map<String, Object> args, Map<String, String> environment, ServerFactory serverFactory) {
    Logging.configureLogging(
        environment
            .get(Constants.LOG_LEVEL_ENVAR)
            .map(level -> Tuple.of(level, Constants.LOG_LEVEL_ENVAR))
            .orElse(
                () ->
                    requireKey(args, "--log-level")
                        .toOption()
                        .flatMap(Values::ifString)
                        .map(level -> Tuple.of(level, "--log-level")))
            .map(
                level -> {
                  try {
                    return Level.parse(level._1());
                  } catch (IllegalArgumentException e) {
                    throw new FatalError(format("Invalid %s: %s", level._2(), level._1()), e);
                  }
                })
            .getOrElse(Level.WARNING),
        environment
            .get(Constants.LOG_DESTINATION_FILE_ENVAR)
            .filter(val -> !val.isEmpty())
            .map(Path::of));

    NGListeningAddress listenAddress = getAddress(args);
    NGServer server = serverFactory.createServer(listenAddress);
    ShutdownManager shutdownManager = DefaultShutdownManager.builder().server(server).build();

    server.setAllowNailsByClassName(false);
    removeDefaultAliases(server.getAliasManager());
    server
        .getAliasManager()
        .addAlias(new Alias("xslt", "Apply an XSLT program to an XML document.", XSLTNail.class));

    ifString(requireKey(args, "--require-running-process").get())
        .peek(
            pidString ->
                Try.of(() -> Long.parseLong(pidString))
                    .map(
                        pid ->
                            ProcessHandle.of(pid)
                                .orElseThrow(() -> new RuntimeException("Process does not exist")))
                    .fold(
                        e -> {
                          throw new FatalError(
                              String.format(
                                  "invalid --require-owner PID: \"%s\": %s",
                                  pidString, e.getMessage()),
                              e);
                        },
                        handle -> {
                          setupShutdownOnRequiredProcessExit(handle, shutdownManager);
                          return null;
                        }));

    Logger shutdownLogger = Logger.getLogger(XSLTNailgunServer.class.getName() + "#ShutdownHook");
    Logging.DisabledResetLogManager.getIfInUse()
        .peek(Logging.DisabledResetLogManager::disableReset);
    Runtime.getRuntime()
        .addShutdownHook(
            new Thread(
                () -> {
                  shutdownLogger.log(Level.FINEST, "Shutdown hook starting");
                  try {
                    shutdownManager.shutdown().toCompletableFuture().get();
                  } catch (InterruptedException | ExecutionException e) {
                    shutdownLogger.log(Level.SEVERE, "ShutdownManager.shutdown() failed", e);
                    throw new RuntimeException("Nailgun server shutdown failed", e);
                  } finally {
                    Logging.DisabledResetLogManager.getIfInUse().peek(m -> m.reset(true));
                  }
                  shutdownLogger.log(Level.FINEST, "Shutdown hook finished");
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

  static void setupShutdownOnRequiredProcessExit(
      ProcessHandle requiredProcess, ShutdownManager shutdownManager) {
    AutomaticShutdownManager.triggeredByProcessExit(requiredProcess, shutdownManager).start();
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
    String address = requireKey(args, "<address>").flatMap(Values::castToString).get();
    AddressType type =
        Option.of(requireKey(args, "--address-type").get())
            .flatMap(Values::ifString)
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

  interface ServerFactory {
    NGServer createServer(NGListeningAddress address);
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
