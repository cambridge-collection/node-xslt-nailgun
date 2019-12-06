package uk.ac.cam.lib.cudl.xsltnail

import io.vavr.collection.List
import io.vavr.control.Try
import spock.lang.Specification

class ValuesSpec extends Specification {
    def setup() {

    }

    def "castToList() casts list with elements of expected type"() {
        given:
        Object list = List.of("abc", "def")
        when:
        Try<List<String>> strings = Values.<String>asList(Values.&castToString, list)
        then:
        strings.isSuccess()
        strings.get() == list
    }

    def "castToList() fails to cast list with elements of incorrect type"() {
        given:
        Object list = List.of("abc", "def", 1)
        when:
        Try<List<String>> strings = Values.<String>asList(Values.&castToString, list)
        then:
        strings.isFailure()
        strings.getCause().getMessage() ==
            "Cannot cast value to List: Failed to cast element 1: Cannot cast java.lang.Integer to java.lang.String"
    }
}
