package org.jahia.se.modules.contentSharing;

import org.junit.Test;

import java.util.Locale;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

/**
 * The notice is inserted into markup the module did not produce, so the cases that matter are the
 * ones where the insertion point is unusual or missing. A page must survive all of them.
 */
public class SharedLinkNoticeTest {

    @Test
    public void insertsRightAfterAPlainBodyTag() {
        String out = ContentSharingServlet.withSharedLinkNotice(
                "<html><body><h1>Hello</h1></body></html>", Locale.ENGLISH);

        assertTrue(out.startsWith("<html><body><div role=\"status\""));
        assertTrue(out.contains("<h1>Hello</h1>"));
    }

    @Test
    public void insertsAfterABodyTagThatCarriesAttributes() {
        String out = ContentSharingServlet.withSharedLinkNotice(
                "<html><BODY class=\"page\" data-x='1'><p>x</p></BODY></html>", Locale.ENGLISH);

        int body = out.indexOf("data-x='1'>");
        assertTrue("notice must follow the opening tag", out.indexOf("role=\"status\"") > body);
    }

    @Test
    public void leavesMarkupWithNoBodyUntouched() {
        String markup = "{\"not\":\"html\"}";
        assertSame(markup, ContentSharingServlet.withSharedLinkNotice(markup, Locale.ENGLISH));
    }

    @Test
    public void doesNotMatchABodyInsideAnotherWord() {
        String markup = "<html><div class=\"bodywrap\">x</div></html>";
        assertSame(markup, ContentSharingServlet.withSharedLinkNotice(markup, Locale.ENGLISH));
    }

    @Test
    public void usesTheVisitorsLanguage() {
        String english = ContentSharingServlet.withSharedLinkNotice("<body>", Locale.ENGLISH);
        String french = ContentSharingServlet.withSharedLinkNotice("<body>", Locale.FRENCH);

        assertTrue(english.contains("shared content"));
        assertTrue(french.contains("contenu partag"));
    }

    @Test
    public void fallsBackToTheDefaultBundleForAnUnknownLanguage() {
        String out = ContentSharingServlet.withSharedLinkNotice("<body>", Locale.forLanguageTag("is"));
        assertTrue(out.contains("shared content"));
    }

    @Test
    public void escapesTheTextItInserts() {
        // The strings are ours, but they travel through a resource bundle an integrator can
        // override, so the inserted text is escaped rather than trusted.
        assertEquals("&lt;script&gt;&amp;&quot;&#39;", ContentSharingServlet.escapeHtml("<script>&\"'"));
    }
}
