package org.jahia.se.modules.contentSharing;

import org.junit.Test;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.Assert.assertTrue;

/**
 * Keeps the resource bundles ASCII.
 *
 * <p>The parent POM's {@code native2ascii} step reads these files as ISO-8859-1. An editor that
 * saves one as UTF-8 therefore turns {@code é} into {@code Ã©} in jContent while the build stays
 * green, which is invisible until someone reads the label. Writing every non-ASCII character as a
 * {@code \\uXXXX} escape removes the dependency on the file's encoding, and this test is what keeps
 * it that way.</p>
 */
public class ResourceBundleEncodingTest {

    private static final Path BUNDLES = Path.of("src", "main", "resources", "resources");

    @Test
    public void bundlesContainOnlyAscii() throws IOException {
        List<String> offenders = new ArrayList<>();

        try (Stream<Path> files = Files.list(BUNDLES)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".properties")).toList()) {
                List<String> lines = Files.readAllLines(file, StandardCharsets.ISO_8859_1);
                for (int i = 0; i < lines.size(); i++) {
                    String line = lines.get(i);
                    for (int c = 0; c < line.length(); c++) {
                        if (line.charAt(c) > 127) {
                            offenders.add(file.getFileName() + ":" + (i + 1)
                                    + " contains '" + line.charAt(c) + "' - write it as "
                                    + String.format("\\u%04x", (int) line.charAt(c)));
                            break;
                        }
                    }
                }
            }
        }

        assertTrue("Resource bundles must be ASCII with \\uXXXX escapes:\n"
                + String.join("\n", offenders), offenders.isEmpty());
    }

    @Test
    public void everyBundleHasTheSameKeys() throws IOException {
        Path reference = BUNDLES.resolve("content-sharing.properties");
        List<String> referenceKeys = keysOf(reference);

        List<String> problems = new ArrayList<>();
        File[] files = BUNDLES.toFile().listFiles((dir, name) -> name.endsWith(".properties"));
        for (File file : files == null ? new File[0] : files) {
            List<String> keys = keysOf(file.toPath());
            for (String key : referenceKeys) {
                if (!keys.contains(key)) {
                    problems.add(file.getName() + " is missing " + key);
                }
            }
        }

        assertTrue("Every language ships every key:\n" + String.join("\n", problems), problems.isEmpty());
    }

    private static List<String> keysOf(Path file) throws IOException {
        List<String> keys = new ArrayList<>();
        for (String line : Files.readAllLines(file, StandardCharsets.ISO_8859_1)) {
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("#") || !trimmed.contains(":")) {
                continue;
            }
            keys.add(trimmed.substring(0, trimmed.indexOf(':')).trim());
        }
        return keys;
    }
}
