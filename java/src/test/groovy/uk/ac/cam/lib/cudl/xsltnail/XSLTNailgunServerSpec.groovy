package uk.ac.cam.lib.cudl.xsltnail

import com.facebook.nailgun.AliasManager
import com.facebook.nailgun.NGListeningAddress
import com.facebook.nailgun.NGServer
import spock.lang.Specification
import spock.lang.Unroll

class XSLTNailgunServerSpec extends Specification {
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

    @Unroll
    def "server is created with specified address"(Map<String, Object> args, NGListeningAddress address) {
        when:
        XSLTNailgunServer.main(args, serverFactory)

        then:
        1 * serverFactory.createServer({ isSameAddress(it, address) }) >> server
        1 * server.run()

        where:
        [args, address] << [
            [["<address>": "./foo"], new NGListeningAddress("./foo")],
            [["<address>": "\\\\?\\pipe\\"], new NGListeningAddress("\\\\?\\pipe\\")],
            [["<address>": "foo", "--address-type": "local"], new NGListeningAddress("foo")],
            // Treated as local, not IP
            [["<address>": "127.0.0.1:2048", "--address-type": "local"], new NGListeningAddress("127.0.0.1:2048")],
            [["<address>": "127.0.0.1:2048"], new NGListeningAddress(InetAddress.getByName("127.0.0.1"), 2048)]
        ]
    }

    static def isSameAddress(NGListeningAddress a, NGListeningAddress b) {
        if(a.isInetAddress()) {
            return b.isInetAddress() && a.getInetAddress() == b.getInetAddress() && a.getInetPort() == b.getInetPort()
        }
        return b.isLocalAddress() && a.getLocalAddress() == b.getLocalAddress()
    }
}
