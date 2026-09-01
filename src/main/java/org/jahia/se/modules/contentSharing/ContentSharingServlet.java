package org.jahia.se.modules.contentSharing;

import org.apache.commons.lang3.StringUtils;
import org.jahia.api.Constants;
import org.jahia.bin.Render;
import org.jahia.services.content.JCRCallback;
import org.jahia.services.content.JCRContentUtils;
import org.jahia.services.content.JCRNodeIteratorWrapper;
import org.jahia.services.content.JCRNodeWrapper;
import org.jahia.services.content.JCRSessionFactory;
import org.jahia.services.content.JCRSessionWrapper;
import org.jahia.services.content.JCRTemplate;
import org.jahia.services.content.decorator.JCRSiteNode;
import org.jahia.services.content.nodetypes.ExtendedNodeType;
import org.jahia.services.content.nodetypes.NodeTypeRegistry;
import org.jahia.services.render.RenderContext;
import org.jahia.services.render.RenderException;
import org.jahia.services.render.RenderService;
import org.jahia.services.render.Resource;
import org.jahia.services.render.SiteInfo;
import org.jahia.services.render.URLGenerator;
import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.Binary;
import javax.jcr.PathNotFoundException;
import javax.jcr.RepositoryException;
import javax.jcr.nodetype.NoSuchNodeTypeException;
import javax.jcr.query.Query;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletRequestWrapper;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Serves a piece of otherwise non-public content to an unauthenticated visitor, addressed by a
 * sharing key that a contributor generated on the node.
 *
 * <p>The lookup runs under a <strong>system session</strong>, so JCR permissions do not narrow it
 * and this class decides on its own what may be served. Each parameter is validated for the slot
 * it occupies before the query is built:</p>
 *
 * <ul>
 *   <li>{@code t} (node type) occupies a JCR-SQL2 <em>identifier</em> slot, for which no string
 *       escape exists. It is resolved through {@link NodeTypeRegistry} and only the canonical
 *       registry name is used; the type must also be one {@value #SHARED_MIXIN} applies to.</li>
 *   <li>{@code c} (sharing key) occupies a JCR-SQL2 <em>string literal</em> slot: checked against
 *       {@link #KEY_PATTERN}, then escaped with {@link JCRContentUtils#sqlEncode}.</li>
 *   <li>{@code l} (language) is checked against the BCP&nbsp;47 shape before
 *       {@link Locale#forLanguageTag} sees it.</li>
 * </ul>
 *
 * <p>The resolved node must carry {@value #SHARED_MIXIN}, its stored key must match in constant
 * time, and its optional expiry date must not have passed. A malformed request, an unknown type
 * and a miss all produce the same {@code 404}.</p>
 *
 * <p>Responses are {@code no-store} and {@code no-referrer}: the key travels in the query string,
 * so neither a shared cache nor an outbound {@code Referer} should carry it further.</p>
 *
 * <p>Instances are created once by SCR and serve concurrent requests. All state is either
 * immutable or a thread-safe Jahia service; per-request state stays on the stack.</p>
 */
@Component(service = {javax.servlet.http.HttpServlet.class, javax.servlet.Servlet.class}, property = {"alias=/share", "allow-api-token=true"})
public class ContentSharingServlet extends HttpServlet {

    private static final long serialVersionUID = 1L;

    private static final Logger LOGGER = LoggerFactory.getLogger(ContentSharingServlet.class);

    /** Property holding the secret, contributed through the {@code SharedURLGenerator} selector. */
    private static final String KEY_PROPS = "se:sharedUrl";

    /** Optional expiry companion of {@link #KEY_PROPS}; absent means the link never expires. */
    private static final String EXPIRY_PROPS = "se:sharedUrlExpiry";

    /** Only a type carrying this mixin may be addressed, whatever {@code t} claims. */
    private static final String SHARED_MIXIN = "semix:sharedUrl";

    /**
     * Accepted shape of a sharing key: the URL-safe alphabet the generator emits. A key that
     * predates the alphabet change no longer matches and has to be regenerated.
     */
    private static final Pattern KEY_PATTERN = Pattern.compile("[A-Za-z0-9._~-]{8,128}");

    /** BCP 47 shape, e.g. {@code en}, {@code fr-CA}. Anything else falls back to the default. */
    private static final Pattern LANGUAGE_PATTERN = Pattern.compile("[a-zA-Z]{2,8}(-[a-zA-Z0-9]{2,8})*");

    private JCRTemplate jcrTemplate;
    private RenderService renderService;

    @Reference
    public void setJcrTemplate(JCRTemplate jcrTemplate) {
        this.jcrTemplate = jcrTemplate;
    }

    @Reference
    public void setRenderService(RenderService renderService) {
        this.renderService = renderService;
    }

    @Activate
    public void activate(Map<String, Object> config) {
        // No configuration yet; the method anchors the DS lifecycle for future OCD properties.
    }

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
        // Container decoding only: the query string is split before anything is percent-decoded.
        String contentKey = request.getParameter("c");
        String contentType = request.getParameter("t");
        Locale locale = toLocale(request.getParameter("l"));

        applySecretUrlHeaders(response);

        if (!isValidKey(contentKey)) {
            LOGGER.debug("Rejecting share request: malformed key");
            sendNotFound(response);
            return;
        }

        String canonicalType = resolveShareableType(contentType);
        if (canonicalType == null) {
            LOGGER.debug("Rejecting share request: type {} is unknown or not shareable", contentType);
            sendNotFound(response);
            return;
        }

        JCRNodeWrapper node;
        try {
            node = jcrTemplate.doExecuteWithSystemSessionAsUser(null, Constants.LIVE_WORKSPACE, locale,
                    new SharedNodeLookup(canonicalType, contentKey));
        } catch (RepositoryException e) {
            LOGGER.error("Unable to resolve shared content of type {}", canonicalType, e);
            response.sendError(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            return;
        }

        if (node == null) {
            sendNotFound(response);
            return;
        }

        try {
            if (node.isNodeType(Constants.JAHIANT_FILE)) {
                streamFile(node, response);
            } else {
                renderContent(node, request, response);
            }
        } catch (RepositoryException e) {
            LOGGER.error("Unable to serve shared node {}", node.getPath(), e);
            response.sendError(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
        }
    }

    @Override
    protected void doPost(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
        response.setHeader("Allow", "GET, HEAD");
        response.sendError(HttpServletResponse.SC_METHOD_NOT_ALLOWED);
    }

    /**
     * Resolves the single node of {@code type} whose sharing key matches, or {@code null}.
     *
     * <p>A named class rather than a lambda, so the two validated values it closes over stay
     * visible: {@code canonicalType} is a registry name, {@code contentKey} matched
     * {@link #KEY_PATTERN} and is escaped again here for the literal slot.</p>
     */
    private static final class SharedNodeLookup implements JCRCallback<JCRNodeWrapper> {

        private final String canonicalType;
        private final String contentKey;

        private SharedNodeLookup(String canonicalType, String contentKey) {
            this.canonicalType = canonicalType;
            this.contentKey = contentKey;
        }

        @Override
        public JCRNodeWrapper doInJCR(JCRSessionWrapper session) throws RepositoryException {
            String statement = "SELECT * FROM [" + canonicalType + "] AS node"
                    + " WHERE node.[" + KEY_PROPS + "] = '" + JCRContentUtils.sqlEncode(contentKey) + "'";

            JCRNodeIteratorWrapper nodes = session.getWorkspace().getQueryManager()
                    .createQuery(statement, Query.JCR_SQL2)
                    .execute()
                    .getNodes();

            while (nodes.hasNext()) {
                JCRNodeWrapper candidate = (JCRNodeWrapper) nodes.next();
                if (!candidate.isNodeType(SHARED_MIXIN)) {
                    continue;
                }
                // The query already filtered on equality; re-comparing keeps an index quirk
                // (case folding, normalisation) from widening the match.
                if (!constantTimeEquals(contentKey, candidate.getPropertyAsString(KEY_PROPS))) {
                    continue;
                }
                if (isExpired(candidate)) {
                    LOGGER.info("Shared link for {} has expired", candidate.getPath());
                    continue;
                }
                return candidate;
            }
            return null;
        }
    }

    /** {@code true} when the node carries an expiry date that is already in the past. */
    private static boolean isExpired(JCRNodeWrapper node) throws RepositoryException {
        if (!node.hasProperty(EXPIRY_PROPS)) {
            return false;
        }
        Calendar expiry = node.getProperty(EXPIRY_PROPS).getDate();
        return expiry != null && expiry.before(Calendar.getInstance());
    }

    /**
     * Returns the registry's own spelling of {@code type} when it exists and can legitimately
     * carry {@value #SHARED_MIXIN}, otherwise {@code null}.
     *
     * <p>{@code sqlEncode} is the wrong tool for the {@code FROM [ … ]} slot — it doubles quotes
     * and leaves the closing {@code ]} intact — so the value is never escaped and emitted: only a
     * name the registry itself produced is used. The mixin-compatibility test narrows it further;
     * the per-node {@code isNodeType} check in the lookup stays authoritative.</p>
     */
    private String resolveShareableType(String type) {
        if (StringUtils.isBlank(type)) {
            return null;
        }
        try {
            ExtendedNodeType nodeType = NodeTypeRegistry.getInstance().getNodeType(type);
            return canCarrySharedMixin(nodeType) ? nodeType.getName() : null;
        } catch (NoSuchNodeTypeException e) {
            return null;
        }
    }

    /**
     * {@code true} when {@code nodeType} satisfies one of the {@code extends} constraints declared
     * by {@value #SHARED_MIXIN}, i.e. a node of that type is allowed to carry the mixin at all.
     */
    private boolean canCarrySharedMixin(ExtendedNodeType nodeType) {
        try {
            ExtendedNodeType mixin = NodeTypeRegistry.getInstance().getNodeType(SHARED_MIXIN);
            List<ExtendedNodeType> constraints = mixin.getMixinExtends();
            if (constraints.isEmpty()) {
                // An unconstrained mixin can be applied anywhere, so this test has nothing to say.
                // The identifier is already registry-canonical and the per-node mixin check in the
                // lookup still runs, which is what actually authorizes the read.
                return true;
            }
            for (ExtendedNodeType constraint : constraints) {
                if (nodeType.isNodeType(constraint.getName())) {
                    return true;
                }
            }
        } catch (NoSuchNodeTypeException e) {
            LOGGER.warn("Mixin {} is not registered; the sharing endpoint serves nothing", SHARED_MIXIN);
        }
        return false;
    }

    private static boolean isValidKey(String key) {
        return key != null && KEY_PATTERN.matcher(key).matches();
    }

    private static Locale toLocale(String languageTag) {
        if (StringUtils.isBlank(languageTag) || !LANGUAGE_PATTERN.matcher(languageTag).matches()) {
            return Locale.ENGLISH;
        }
        Locale locale = Locale.forLanguageTag(languageTag);
        return StringUtils.isBlank(locale.getLanguage()) ? Locale.ENGLISH : locale;
    }

    /**
     * Compares without an early exit, so the time taken does not depend on how many leading
     * characters match. Length is compared first; it is not itself confidential.
     */
    private static boolean constantTimeEquals(String expected, String actual) {
        if (expected == null || actual == null || expected.length() != actual.length()) {
            return false;
        }
        int diff = 0;
        for (int i = 0; i < expected.length(); i++) {
            diff |= expected.charAt(i) ^ actual.charAt(i);
        }
        return diff == 0;
    }

    /**
     * The key sits in the URL, so the response must not be reusable by a shared cache and the URL
     * must not travel to third parties through {@code Referer}.
     */
    private static void applySecretUrlHeaders(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
        response.setHeader("Pragma", "no-cache");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    }

    /** One answer for every non-hit, so the endpoint says nothing about which keys exist. */
    private static void sendNotFound(HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_NOT_FOUND);
        response.setContentType("text/html; charset=UTF-8");
        response.getWriter().println("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
                + "<title>Not found</title></head><body><h1>This link is no longer available</h1>"
                + "</body></html>");
    }

    private void renderContent(JCRNodeWrapper node, HttpServletRequest request, HttpServletResponse response)
            throws RepositoryException, IOException {
        Resource resource = new Resource(node, "html", "default", "page");
        RenderContext renderContext = new RenderContext(unwrapRequest(request), response,
                JCRSessionFactory.getInstance().getCurrentUser());
        // Order matters: site, then workspace, then servlet path, then main resource.
        JCRSiteNode site = node.getResolveSite();
        renderContext.setSite(site);
        renderContext.setSiteInfo(new SiteInfo(site));
        renderContext.setWorkspace(Constants.LIVE_WORKSPACE);
        renderContext.setServletPath(Render.getRenderServletPath());
        renderContext.setMainResource(resource);
        renderContext.setEditMode(false);
        renderContext.setURLGenerator(new URLGenerator(renderContext, resource));

        String markup;
        try {
            markup = renderService.render(resource, renderContext);
        } catch (RenderException e) {
            LOGGER.error("Unable to render shared node {}", node.getPath(), e);
            response.sendError(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            return;
        }

        response.setContentType("text/html; charset=UTF-8");
        response.getWriter().write(markup);
    }

    /**
     * Streams the file's binary. Nothing may have touched {@link HttpServletResponse#getWriter()}
     * before this point: the Servlet contract makes the writer and the output stream mutually
     * exclusive, so the output channel is chosen once, after the lookup has decided what to serve.
     */
    private void streamFile(JCRNodeWrapper node, HttpServletResponse response)
            throws RepositoryException, IOException {
        JCRNodeWrapper content;
        try {
            content = node.getNode(Constants.JCR_CONTENT);
        } catch (PathNotFoundException e) {
            LOGGER.warn("Cannot find {} sub-node in {}", Constants.JCR_CONTENT, node.getPath());
            sendNotFound(response);
            return;
        }

        Binary binary = null;
        try {
            binary = content.getProperty(Constants.JCR_DATA).getBinary();
            String mimetype = content.hasProperty(Constants.JCR_MIMETYPE)
                    ? content.getProperty(Constants.JCR_MIMETYPE).getString()
                    : "application/octet-stream";

            response.setContentType(mimetype);
            response.setHeader("Content-Disposition", contentDisposition(node.getName()));
            response.setContentLengthLong(binary.getSize());

            try (InputStream is = binary.getStream(); OutputStream os = response.getOutputStream()) {
                byte[] buffer = new byte[8192];
                int bytesRead;
                while ((bytesRead = is.read(buffer)) != -1) {
                    os.write(buffer, 0, bytesRead);
                }
            }
        } catch (PathNotFoundException e) {
            LOGGER.warn("Unable to get {} property for node {}", Constants.JCR_DATA, node.getPath());
            sendNotFound(response);
        } finally {
            if (binary != null) {
                binary.dispose();
            }
        }
    }

    /**
     * Builds an RFC 6266 {@code Content-Disposition}. A JCR node name is not constrained to what
     * the quoted {@code filename} token accepts, so the ASCII fallback is reduced to a safe subset
     * and the real name travels in the {@code filename*} parameter.
     */
    private static String contentDisposition(String nodeName) throws UnsupportedEncodingException {
        // Separators and control characters are dropped, not escaped: nothing downstream opens a
        // path, so the name only has to be safe to place in a header and to save as.
        String name = nodeName.replaceAll("[\\p{Cntrl}/\\\\]", "");
        String ascii = name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (ascii.isEmpty()) {
            ascii = "download";
        }
        String encoded = URLEncoder.encode(name, StandardCharsets.UTF_8.name()).replace("+", "%20");
        return "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''" + encoded;
    }

    /**
     * Unwraps Felix's {@code ServletHandlerRequest}, which rewrites {@code servletPath} /
     * {@code pathInfo} in a way that leaks a {@code /modules} prefix into generated URLs.
     * Taken from {@code graphql-dxm-provider}'s {@code ServletUtil}.
     */
    public static HttpServletRequest unwrapRequest(HttpServletRequest request) {
        if (request instanceof HttpServletRequestWrapper) {
            return (HttpServletRequest) ((HttpServletRequestWrapper) request).getRequest();
        }
        return request;
    }
}
