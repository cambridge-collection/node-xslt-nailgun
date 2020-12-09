package uk.ac.cam.lib.cudl.xsltnail

import com.facebook.nailgun.AliasManager
import com.facebook.nailgun.NGListeningAddress
import com.facebook.nailgun.NGServer
import io.vavr.collection.HashMap
import io.vavr.collection.Map
import spock.lang.Specification
import spock.lang.Unroll

class XSLTNailgunServerSpec extends Specification {
    private static final OPTIONAL_ARGS = HashMap.ofAll(["--address-type": null, "--log-level": null, "--require-running-process": null])

    NGServer server
    AliasManager aliasManager
    XSLTNailgunServer.ServerFactory serverFactory

    def setup() {
        aliasManager = new AliasManager()
        server = Mock(NGServer) {
            getAliasManager() >> aliasManager
        }
        serverFactory = Mock(XSLTNailgunServer.ServerFactory) {
            createServer(_) >> server
        }
    }

  def "getEnvironmentVariables() extracts relevant envars"(
    java.util.Map<String, String> allEnvars, Map<String, String> expectedEnvars) {
    expect:
    XSLTNailgunServer.getEnvironmentVariables(allEnvars) == expectedEnvars

    where:
    [allEnvars, expectedEnvars] << [
      [
        ["OTHER": "abc", (Constants.LOG_DESTINATION_FILE_ENVAR): "foo", (Constants.LOG_LEVEL_ENVAR): "bar"],
        [(Constants.LOG_DESTINATION_FILE_ENVAR): "foo", (Constants.LOG_LEVEL_ENVAR): "bar"]
      ],
      [
        ["OTHER": "abc", (Constants.LOG_DESTINATION_FILE_ENVAR): "foo"],
        [(Constants.LOG_DESTINATION_FILE_ENVAR): "foo"]
      ],
      [
        ["OTHER": "abc", (Constants.LOG_LEVEL_ENVAR): "bar"],
        [(Constants.LOG_LEVEL_ENVAR): "bar"]
      ],
      [["OTHER": "abc"], [:]],
      [[:], [:]],
    ].collect { [it[0], HashMap.ofAll(it[1])]}
  }

    @Unroll
    def "server is created with specified address"(Map<String, Object> args, Map<String, String> env, NGListeningAddress address) {
        when:
        XSLTNailgunServer.main(args, env, serverFactory)

        then:
        1 * serverFactory.createServer({ isSameAddress(it, address) }) >> server
        1 * server.run()

        where:
        [args, env, address] << [
            [["<address>": "./foo"], new NGListeningAddress("./foo")],
            [["<address>": "\\\\?\\pipe\\"], new NGListeningAddress("\\\\?\\pipe\\")],
            [["<address>": "foo", "--address-type": "local"], new NGListeningAddress("foo")],
            // Treated as local, not IP
            [["<address>": "127.0.0.1:2048", "--address-type": "local"], new NGListeningAddress("127.0.0.1:2048")],
            [["<address>": "127.0.0.1:2048"], new NGListeningAddress(InetAddress.getByName("127.0.0.1"), 2048)]
        ].collect { [HashMap.ofAll(it[0]).merge(OPTIONAL_ARGS), HashMap.empty(), it[1]] }
    }

    static def isSameAddress(NGListeningAddress a, NGListeningAddress b) {
        if(a.isInetAddress()) {
            return b.isInetAddress() && a.getInetAddress() == b.getInetAddress() && a.getInetPort() == b.getInetPort()
        }
        return b.isLocalAddress() && a.getLocalAddress() == b.getLocalAddress()
    }
}
