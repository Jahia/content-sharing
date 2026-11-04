package org.jahia.se.modules.contentSharing;

import org.junit.Test;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

/**
 * A review rendering comes out of the authoring workspace, where the reviewer may read nothing, so
 * every file address in it is rewritten to come back through the endpoint carrying a signature.
 * What matters is that the rewrite finds them all and that the signature cannot be spent on
 * anything the rendering did not name.
 */
public class AssetProxyTest {

    private static final String KEY = "AlphaKey0000000000000001";
    private static final String TYPE = "jnt:page";

    private static String rewrite(String markup) {
        return ContentSharingServlet.withProxiedAssets(markup, KEY, TYPE);
    }

    @Test
    public void rewritesAnImageSource() {
        String out = rewrite("<img src=\"/files/default/sites/acme/files/logo.svg\">");

        assertFalse("no authoring address may survive", out.contains("/files/default/"));
        assertTrue(out.contains("/modules/share?c=" + KEY));
        assertTrue(out.contains("asset=%2Fsites%2Facme%2Ffiles%2Flogo.svg"));
        assertTrue(out.contains("sig="));
    }

    @Test
    public void dropsTheSizingQueryJahiaAppends() {
        String out = rewrite("<img src=\"/files/default/sites/acme/files/a.png?w=302\">");

        // The query is left where it was, outside the rewritten address: the file is served as
        // stored, which is the documented behaviour.
        assertTrue(out.contains("asset=%2Fsites%2Facme%2Ffiles%2Fa.png"));
        assertFalse(out.contains("asset=%2Fsites%2Facme%2Ffiles%2Fa.png%3Fw"));
    }

    @Test
    public void rewritesEveryOccurrenceNotJustTheFirst() {
        String out = rewrite("<img src=\"/files/default/sites/a/files/1.png\">"
                + "<img src=\"/files/default/sites/a/files/2.png\">"
                + "<div style=\"background:url(/files/default/sites/a/files/3.png)\">");

        assertEquals("three addresses, three rewrites", 3, count(out, "/modules/share\\?c="));
        assertFalse(out.contains("/files/default/"));
    }

    @Test
    public void leavesPublishedAddressesAlone() {
        String markup = "<img src=\"/files/live/sites/acme/files/logo.svg\">";
        assertEquals("a published address is readable as it is", markup, rewrite(markup));
    }

    @Test
    public void signatureIsBoundToBothTheKeyAndThePath() {
        String a = ContentSharingServlet.sign(KEY, "/sites/acme/files/a.png");
        String b = ContentSharingServlet.sign(KEY, "/sites/acme/files/b.png");
        String c = ContentSharingServlet.sign("BravoKey0000000000000002", "/sites/acme/files/a.png");

        assertNotEquals("another path must not verify", a, b);
        assertNotEquals("another key must not verify", a, c);
        assertEquals("signing is deterministic", a, ContentSharingServlet.sign(KEY, "/sites/acme/files/a.png"));
        assertEquals("128 bits, hex", 32, a.length());
        assertTrue(a.matches("[0-9a-f]{32}"));
    }

    @Test
    public void aSignatureFromTheRewriteVerifiesThePathItWasMintedFor() {
        String out = rewrite("<img src=\"/files/default/sites/acme/files/logo.svg\">");

        Matcher m = Pattern.compile("sig=([0-9a-f]{32})").matcher(out);
        assertTrue(m.find());
        assertEquals(ContentSharingServlet.sign(KEY, "/sites/acme/files/logo.svg"), m.group(1));
    }

    private static int count(String haystack, String regex) {
        Matcher m = Pattern.compile(regex).matcher(haystack);
        int n = 0;
        while (m.find()) {
            n++;
        }
        return n;
    }
}
