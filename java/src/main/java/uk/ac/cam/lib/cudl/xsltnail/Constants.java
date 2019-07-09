package uk.ac.cam.lib.cudl.xsltnail;

import org.docopt.Docopt;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

public final class Constants {
    public static final String VERSION = "0.0.0";
    public static final long SHUTDOWN_GRACE_PERIOD = 1000 * 5;

    // Docopt doesn't provide a way to get at just the usage section of the
    // parsed help (which we need when manually printing usage), so we have to
    // extract it ourselves...
    public static final String USAGE_STRING_TRANSFORM = (
        "Usage:\n" +
        "    xslt transform [options] <xslt-file> <xml-base-uri>");

    private static String getTransformDoc() {
        String template = new BufferedReader(
            new InputStreamReader(XSLTNail.class.getResourceAsStream("xslt-nail-usage.txt"),
                StandardCharsets.UTF_8))
            .lines().collect(Collectors.joining("\n"));

        return String.format(template, USAGE_STRING_TRANSFORM);
    }

    static Docopt USAGE_TRANSFORM = new Docopt(getTransformDoc())
        .withExit(false)
        .withHelp(true)
        .withVersion(VERSION);

    static final Docopt USAGE_SERVER = new Docopt(
        XSLTNailgunServer.class.getResourceAsStream("nailgun-server-usage.txt"),
        StandardCharsets.UTF_8)
        .withExit(true)
        .withHelp(true)
        .withVersion(VERSION);

    private Constants() {}
}
