package uk.ac.cam.lib.cudl.xsltnail

import spock.lang.Specification

class MemoryLoggerSpec extends Specification {
    MemoryLogger logger

    def setup() {
        logger = MemoryLogger.newInstance()
    }

    def "logger initially has no messages()"() {
        expect:
        logger.getLoggedMessages() == ""
    }

    def "logger records logged messges"() {
        when:
        logger.error("Boom!")
        logger.info("Foo\nbar.")

        then:
        logger.getLoggedMessages() == "Boom!\nFoo\nbar.\n"
    }

    def "logger can be written to after reading messages"() {
        when:
        logger.error("Foo")

        then:
        logger.getLoggedMessages() == "Foo\n"

        when:
        logger.error("Bar")

        then:
        logger.getLoggedMessages() == "Foo\nBar\n"
    }
}
