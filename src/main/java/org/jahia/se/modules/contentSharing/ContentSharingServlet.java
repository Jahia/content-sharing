package org.jahia.se.modules.contentSharing;

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

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
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
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.MissingResourceException;
import java.util.ResourceBundle;
import java.util.Map;
import java.util.regex.Matcher;
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
 * time, and its optional expiry date must not have passed. A review link is a node of its own,
 * {@value #REVIEW_LINK_TYPE}, under the node it opens, with the same checks and a required expiry
 * date. A malformed request, an unknown type
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
    private static final String KEY_PROPS = "cshare:sharedUrl";

    /** Optional expiry companion of {@link #KEY_PROPS}; absent means the link never expires. */
    private static final String EXPIRY_PROPS = "cshare:sharedUrlExpiry";

    /** Only a type carrying this mixin may be addressed, whatever {@code t} claims. */
    private static final String SHARED_MIXIN = "cshmix:sharedUrl";

    /** The review link's mixin, property and expiry. Reaches the authoring workspace. */
    private static final String REVIEW_MIXIN = "cshmix:reviewUrl";
    private static final String REVIEW_KEY_PROPS = "cshare:reviewUrl";
    private static final String REVIEW_EXPIRY_PROPS = "cshare:reviewUrlExpiry";

    /**
     * Review links since 2.5.0: one node per language, named after it, in a container of that
     * name under the node the link opens. Never published, so the key stays in authoring.
     */
    private static final String REVIEW_LINK_TYPE = "cshnt:reviewLink";
    private static final String REVIEW_LINKS_CONTAINER = "cshareReviewLinks";
    private static final String REVIEW_LINKS_MIXIN = "cshmix:reviewLinks";
    private static final String LINK_KEY = "cshare:key";
    private static final String LINK_EXPIRY = "cshare:expiry";
    private static final String LINK_OWNER = "cshare:owner";

    /**
     * Set on the request before a shared node is rendered, so a template can tell this rendering
     * apart from an ordinary one and leave out what a visitor holding only this link cannot use.
     * Documented in the README; nothing in the platform sets it.
     */
    private static final String SHARED_RENDERING_ATTRIBUTE = "contentSharing.sharedRendering";

    /**
     * A template that renders its own notice sets this, and the default notice is left out.
     */
    private static final String NOTICE_RENDERED_ATTRIBUTE = "contentSharing.noticeRendered";

    /** Resource bundle holding the visitor-facing strings. */
    private static final String BUNDLE = "resources.content-sharing";

    /** Asset request: the repository path of one file, and the signature that vouches for it. */
    private static final String ASSET_PARAM = "asset";
    private static final String SIGNATURE_PARAM = "sig";

    /**
     * How Jahia addresses a file in the authoring workspace. A review rendering is full of these
     * and a reviewer may read none of them, so they are rewritten to come back through here.
     */
    private static final String EDIT_FILES_PREFIX = "/files/" + Constants.EDIT_WORKSPACE;

    /**
     * A file URL in a review rendering, with the sizing query Jahia may have appended.
     *
     * <p>The query is part of the match so that it is consumed: left behind it would follow the
     * address this is replaced with, where a second {@code ?} is just another character of the
     * last parameter's value, and the signature would never match.</p>
     */
    private static final Pattern EDIT_FILE_URL = Pattern.compile(
            Pattern.quote(EDIT_FILES_PREFIX) + "(/[^\"'()\\s?#<>\\\\]+)(\\?[^\"'()\\s#<>\\\\]*)?");

    /** Shape of a repository path this endpoint will look a file up at. */
    private static final Pattern ASSET_PATH = Pattern.compile("/sites/[A-Za-z0-9._\\-]+/[A-Za-z0-9._\\-/%@ ()+,'\u00c0-\u024f]+");

    private static final String HMAC = "HmacSHA256";

    /**
     * The two kinds of link this endpoint serves, each pinned to one workspace.
     *
     * <p>The workspace is a property of the kind, never of the request: were it a parameter,
     * anyone holding a link to published content could ask for the same node as it stands in the
     * authoring workspace, which is not what the contributor handed out.</p>
     *
     * <p>They are told apart by the property the key is stored in, so a key is only ever one kind
     * and no request can be read as both.</p>
     */
    private enum LinkKind {
        /** Published content, as a visitor of the site would see it. */
        PUBLISHED(SHARED_MIXIN, KEY_PROPS, EXPIRY_PROPS, Constants.LIVE_WORKSPACE,
                "sharedLink.notice", false),
        /** Content as it stands in the authoring workspace, for review before publication. */
        REVIEW(REVIEW_MIXIN, REVIEW_KEY_PROPS, REVIEW_EXPIRY_PROPS, Constants.EDIT_WORKSPACE,
                "reviewLink.notice", true);

        private final String mixin;
        private final String keyProperty;
        private final String expiryProperty;
        private final String workspace;
        private final String noticeKey;
        /** A link into the authoring workspace that never expires is one nobody can withdraw. */
        private final boolean expiryRequired;

        LinkKind(String mixin, String keyProperty, String expiryProperty, String workspace,
                String noticeKey, boolean expiryRequired) {
            this.mixin = mixin;
            this.keyProperty = keyProperty;
            this.expiryProperty = expiryProperty;
            this.workspace = workspace;
            this.noticeKey = noticeKey;
            this.expiryRequired = expiryRequired;
        }
    }

    /**
     * Accepted shape of a sharing key: the URL-safe alphabet the generator emits. A key that
     * predates the alphabet change no longer matches and has to be regenerated.
     */
    private static final Pattern KEY_PATTERN = Pattern.compile("[A-Za-z0-9._~-]{8,128}");

    /**
     * Language parameter. NOT {@code l}: Jahia's {@link org.jahia.services.render.URLResolver}
     * reads {@code l} as a version label and {@code v} as a version date, so a share URL carrying
     * {@code l=fr} makes it call {@code setVersionLabel("fr")}, which fails with
     * "Cannot use label fr in workspace live". It only reads them for a logged-in user, so the
     * breakage shows up for the contributor testing the link and not for its guest audience.
     */
    private static final String LANG_PARAM = "lang";

    /**
     * The name this endpoint used before {@link #LANG_PARAM}. A URL carrying it is redirected
     * rather than served, because {@code l} reaching the render chain is the whole problem.
     */
    private static final String LEGACY_LANG_PARAM = "l";

    /** Opening {@code body} tag, however it is spelled and whatever attributes it carries. */
    private static final Pattern BODY_TAG = Pattern.compile("<body\\b[^>]*>", Pattern.CASE_INSENSITIVE);

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
        String languageTag = request.getParameter(LANG_PARAM);
        String legacyLanguageTag = request.getParameter(LEGACY_LANG_PARAM);

        // Set before any branch below writes, so every answer this endpoint gives carries them.
        applySecretUrlHeaders(response);

        if (isBlank(languageTag) && !isBlank(legacyLanguageTag)) {
            // A URL still carrying `l` cannot be served in place: the render chain reads `l` off
            // the original request, which no wrapper of ours reaches. Bounce it to the canonical
            // form so the second request arrives without the reserved name.
            redirectToCanonicalForm(response, contentKey, contentType, legacyLanguageTag);
            return;
        }
        Locale locale = toLocale(languageTag);

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

        String assetPath = request.getParameter(ASSET_PARAM);
        if (assetPath != null) {
            serveAsset(assetPath, request.getParameter(SIGNATURE_PARAM), canonicalType, contentKey,
                    locale, response);
            return;
        }

        // Each kind is looked up in its own workspace. A key lives in one property or the other,
        // so a request can only ever match one of them.
        for (LinkKind kind : LinkKind.values()) {
            try {
                if (Boolean.TRUE.equals(serve(kind, canonicalType, contentKey, locale, request, response))) {
                    return;
                }
            } catch (ServeFailure e) {
                throw e.getCause();
            } catch (RepositoryException e) {
                LOGGER.error("Unable to serve a {} link of type {}", kind, canonicalType, e);
                sendServerError(response);
                return;
            }
        }

        sendNotFound(response);
    }

    /**
     * Looks the key up as a link of {@code kind} and serves the node if it matches.
     *
     * <p>Everything that touches the node stays INSIDE the callback. JCRTemplate logs the session
     * out as soon as the callback returns, and a JCRNodeWrapper handed out past that point throws
     * "This session has been closed" on first use.</p>
     *
     * @return {@code true} when this kind matched and the response was written
     */
    private Boolean serve(LinkKind kind, String canonicalType, String contentKey, Locale locale,
            HttpServletRequest request, HttpServletResponse response) throws RepositoryException {
        return jcrTemplate.doExecuteWithSystemSessionAsUser(null, kind.workspace, locale,
                session -> {
                    JCRNodeWrapper node = findSharedNode(session, kind, canonicalType, contentKey);
                    if (node == null) {
                        return Boolean.FALSE;
                    }
                    try {
                        if (node.isNodeType(Constants.JAHIANT_FILE)) {
                            streamFile(node, response);
                        } else {
                            renderContent(node, kind, canonicalType, contentKey, request, response);
                        }
                    } catch (IOException e) {
                        throw new ServeFailure(e);
                    }
                    return Boolean.TRUE;
                });
    }

    /**
     * Streams one file of a review rendering.
     *
     * <p>A review rendering comes out of the authoring workspace, so every image, stylesheet and
     * script in it is addressed under {@value #EDIT_FILES_PREFIX}, which a reviewer may not read:
     * the page would arrive as text with nothing else loading. Those addresses are rewritten to
     * come back here, where the same key that bought the page buys its files.</p>
     *
     * <p>The signature is what keeps this from becoming a reader for the whole authoring
     * workspace. It is computed with the key as the secret, so only a caller holding the key can
     * produce one -- and such a caller could already read the page that lists these paths, so the
     * signature grants nothing the key did not. The node type and the site are checked as well,
     * so a signature cannot be spent on something that is not a file of the shared node's site.</p>
     */
    private void serveAsset(String assetPath, String signature, String canonicalType,
            String contentKey, Locale locale, HttpServletResponse response) throws IOException {
        if (!ASSET_PATH.matcher(assetPath).matches() || assetPath.contains("..")) {
            LOGGER.debug("Rejecting asset request: malformed path");
            sendNotFound(response);
            return;
        }
        if (signature == null || !constantTimeEquals(sign(contentKey, assetPath), signature)) {
            LOGGER.debug("Rejecting asset request: signature does not match");
            sendNotFound(response);
            return;
        }

        try {
            Boolean served = jcrTemplate.doExecuteWithSystemSessionAsUser(null,
                    LinkKind.REVIEW.workspace, locale, session -> {
                        // Re-resolved every time, so an expired or withdrawn link stops serving
                        // files at the same moment it stops serving the page.
                        JCRNodeWrapper shared = findSharedNode(session, LinkKind.REVIEW, canonicalType, contentKey);
                        if (shared == null) {
                            return Boolean.FALSE;
                        }
                        JCRNodeWrapper asset = assetOfSameSite(session, shared, assetPath);
                        if (asset == null) {
                            return Boolean.FALSE;
                        }
                        try {
                            streamFile(asset, response);
                        } catch (IOException e) {
                            throw new ServeFailure(e);
                        }
                        return Boolean.TRUE;
                    });
            if (!Boolean.TRUE.equals(served)) {
                sendNotFound(response);
            }
        } catch (ServeFailure e) {
            throw e.getCause();
        } catch (RepositoryException e) {
            LOGGER.error("Unable to serve an asset of a review link", e);
            sendServerError(response);
        }
    }

    /**
     * The file at {@code assetPath}, when it is a file and it belongs to the same site as the
     * shared node. {@code null} otherwise, which the caller answers as a miss.
     */
    private static JCRNodeWrapper assetOfSameSite(JCRSessionWrapper session, JCRNodeWrapper shared,
            String assetPath) throws RepositoryException {
        JCRNodeWrapper asset;
        try {
            asset = session.getNode(assetPath);
        } catch (PathNotFoundException e) {
            return null;
        }
        if (!asset.isNodeType(Constants.JAHIANT_FILE)) {
            LOGGER.debug("Rejecting asset request: {} is not a file", assetPath);
            return null;
        }
        String site = shared.getResolveSite().getPath();
        if (!asset.getPath().startsWith(site + "/")) {
            LOGGER.warn("Rejecting asset request: {} is outside {}", assetPath, site);
            return null;
        }
        return asset;
    }

    /**
     * Rewrites every authoring-workspace file address in a review rendering so that it comes back
     * through this endpoint, signed.
     *
     * <p>A plain scan of the whole document on purpose: these addresses turn up in {@code src},
     * in {@code srcset}, in inline {@code url()} and in the data a client island hydrates from,
     * and all of them have to be reachable for the page to look like the page.</p>
     *
     * <p>Any sizing query Jahia appended is dropped, so the reviewer gets the file as stored
     * rather than a resized variant.</p>
     */
    static String withProxiedAssets(String markup, String contentKey, String canonicalType) {
        Matcher matcher = EDIT_FILE_URL.matcher(markup);
        StringBuilder out = new StringBuilder(markup.length());
        while (matcher.find()) {
            String path = matcher.group(1);
            String replacement;
            try {
                replacement = "/modules/share?c=" + URLEncoder.encode(contentKey, StandardCharsets.UTF_8.name())
                        + "&t=" + URLEncoder.encode(canonicalType, StandardCharsets.UTF_8.name())
                        + "&" + ASSET_PARAM + "=" + URLEncoder.encode(path, StandardCharsets.UTF_8.name())
                        + "&" + SIGNATURE_PARAM + "=" + sign(contentKey, path);
            } catch (UnsupportedEncodingException e) {
                throw new IllegalStateException("UTF-8 is always available", e);
            }
            matcher.appendReplacement(out, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(out);
        return out.toString();
    }

    /**
     * Signs one asset path with the sharing key.
     *
     * <p>The key is the secret because it is already the credential: whoever holds it can read the
     * page that names these paths. Signing with it means a path this endpoint will serve can only
     * come from a rendering it produced, without the module keeping any state between the two
     * requests.</p>
     */
    static String sign(String contentKey, String assetPath) {
        try {
            Mac mac = Mac.getInstance(HMAC);
            mac.init(new SecretKeySpec(contentKey.getBytes(StandardCharsets.UTF_8), HMAC));
            byte[] digest = mac.doFinal(assetPath.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(32);
            for (int i = 0; i < 16; i++) {
                hex.append(String.format("%02x", digest[i]));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new IllegalStateException(HMAC + " is required of every JRE", e);
        }
    }

    /** Carries an {@link IOException} out of a {@link JCRCallback}, which may only throw {@link RepositoryException}. */
    private static final class ServeFailure extends RuntimeException {
        private static final long serialVersionUID = 1L;

        private ServeFailure(IOException cause) {
            super(cause);
        }

        @Override
        public synchronized IOException getCause() {
            return (IOException) super.getCause();
        }
    }

    @Override
    protected void doPost(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
        response.setHeader("Allow", "GET, HEAD");
        response.sendError(HttpServletResponse.SC_METHOD_NOT_ALLOWED);
    }

    /**
     * Resolves the single node of {@code canonicalType} whose key of this {@code kind} matches,
     * or {@code null}.
     *
     * <p>Takes the live session rather than opening its own, so the returned node stays valid for
     * as long as the caller's callback runs.</p>
     *
     * @param canonicalType a name {@link NodeTypeRegistry} produced, safe for the identifier slot
     * @param contentKey    a key that matched {@link #KEY_PATTERN}, escaped again here for the literal slot
     */
    private JCRNodeWrapper findSharedNode(JCRSessionWrapper session, LinkKind kind,
            String canonicalType, String contentKey) throws RepositoryException {
        if (kind == LinkKind.REVIEW) {
            JCRNodeWrapper owner = findReviewLinkOwner(session, canonicalType, contentKey);
            if (owner != null) {
                return owner;
            }
            // Review links made before 2.5.0 hold the key on the node itself, read below. They
            // keep working until they expire or are revoked.
        }

        String statement = "SELECT * FROM [" + canonicalType + "] AS node"
                + " WHERE node.[" + kind.keyProperty + "] = '" + JCRContentUtils.sqlEncode(contentKey) + "'";

        JCRNodeIteratorWrapper nodes = session.getWorkspace().getQueryManager()
                .createQuery(statement, Query.JCR_SQL2)
                .execute()
                .getNodes();

        while (nodes.hasNext()) {
            JCRNodeWrapper candidate = (JCRNodeWrapper) nodes.next();
            if (!candidate.isNodeType(kind.mixin)) {
                continue;
            }
            // The query already filtered on equality; re-comparing keeps an index quirk
            // (case folding, normalisation) from widening the match.
            if (!constantTimeEquals(contentKey, candidate.getPropertyAsString(kind.keyProperty))) {
                continue;
            }
            if (kind.expiryRequired && !candidate.hasProperty(kind.expiryProperty)) {
                // Refused rather than served forever. The visitor sees the same answer as any
                // other miss; this line is how the contributor finds out.
                LOGGER.warn("{} on {} has no {} and is refused: this kind of link must expire",
                        kind, candidate.getPath(), kind.expiryProperty);
                continue;
            }
            if (isExpired(candidate, kind.expiryProperty)) {
                LOGGER.info("{} for {} has expired", kind, candidate.getPath());
                continue;
            }
            return candidate;
        }
        return null;
    }

    /**
     * Resolves the node a review link opens, or {@code null}.
     *
     * <p>The link must be named after the session's language, carry an expiry date that has not
     * passed, sit in the {@value #REVIEW_LINKS_CONTAINER} container directly under the node, and
     * name that node in {@value #LINK_OWNER}. The last check is what a copy fails: copying a page
     * copies its links, owner value included, and the copy's identifier is another one.</p>
     */
    private JCRNodeWrapper findReviewLinkOwner(JCRSessionWrapper session, String canonicalType,
            String contentKey) throws RepositoryException {
        String statement = "SELECT * FROM [" + REVIEW_LINK_TYPE + "] AS link"
                + " WHERE link.[" + LINK_KEY + "] = '" + JCRContentUtils.sqlEncode(contentKey) + "'";

        JCRNodeIteratorWrapper links = session.getWorkspace().getQueryManager()
                .createQuery(statement, Query.JCR_SQL2)
                .execute()
                .getNodes();

        String language = session.getLocale().toString();
        while (links.hasNext()) {
            JCRNodeWrapper link = (JCRNodeWrapper) links.next();
            if (!constantTimeEquals(contentKey, link.getPropertyAsString(LINK_KEY))
                    || !language.equals(link.getName())) {
                continue;
            }
            if (!link.hasProperty(LINK_EXPIRY) || isExpired(link, LINK_EXPIRY)) {
                LOGGER.info("Review link {} has expired", link.getPath());
                continue;
            }
            JCRNodeWrapper container = link.getParent();
            if (!REVIEW_LINKS_CONTAINER.equals(container.getName())) {
                continue;
            }
            JCRNodeWrapper owner = container.getParent();
            if (!owner.getIdentifier().equals(link.getPropertyAsString(LINK_OWNER))) {
                LOGGER.info("Review link {} was copied with its node and opens nothing", link.getPath());
                continue;
            }
            if (owner.isNodeType(canonicalType)) {
                return owner;
            }
        }
        return null;
    }

    /** {@code true} when the node carries an expiry date that is already in the past. */
    private static boolean isExpired(JCRNodeWrapper node, String expiryProperty) throws RepositoryException {
        if (!node.hasProperty(expiryProperty)) {
            return false;
        }
        Calendar expiry = node.getProperty(expiryProperty).getDate();
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
        if (isBlank(type)) {
            return null;
        }
        try {
            ExtendedNodeType nodeType = NodeTypeRegistry.getInstance().getNodeType(type);
            boolean shareable = canCarry(nodeType, SHARED_MIXIN) || canCarry(nodeType, REVIEW_MIXIN)
                    || canCarry(nodeType, REVIEW_LINKS_MIXIN);
            return shareable ? nodeType.getName() : null;
        } catch (NoSuchNodeTypeException e) {
            return null;
        }
    }

    /**
     * {@code true} when {@code nodeType} satisfies one of the {@code extends} constraints declared
     * by {@code mixinName}, i.e. a node of that type is allowed to carry that mixin at all.
     */
    private boolean canCarry(ExtendedNodeType nodeType, String mixinName) {
        try {
            ExtendedNodeType mixin = NodeTypeRegistry.getInstance().getNodeType(mixinName);
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
            LOGGER.warn("Mixin {} is not registered", mixinName);
        }
        return false;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static boolean isValidKey(String key) {
        return key != null && KEY_PATTERN.matcher(key).matches();
    }

    private static Locale toLocale(String languageTag) {
        if (isBlank(languageTag) || !LANGUAGE_PATTERN.matcher(languageTag).matches()) {
            return Locale.ENGLISH;
        }
        Locale locale = Locale.forLanguageTag(languageTag);
        return isBlank(locale.getLanguage()) ? Locale.ENGLISH : locale;
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

    /**
     * Sends a legacy {@code l=} link to the same resource addressed with {@link #LANG_PARAM}.
     *
     * <p>Temporary, never cached: the secret-URL headers are already set on this response.
     * Validation is left to the redirected request, so a bad key still ends in the one uniform
     * 404 and the redirect itself tells a caller nothing.</p>
     */
    private static void redirectToCanonicalForm(HttpServletResponse response,
            String contentKey, String contentType, String languageTag) throws IOException {
        // Query-only relative target. Building it from getRequestURI() would carry whatever path
        // the caller sent, and a URI beginning "//host" turns the Location into a protocol-relative
        // redirect to that host. A bare query string has no authority to steer, and the three
        // values are percent-encoded, so it can only ever point back at this endpoint.
        StringBuilder target = new StringBuilder("?");
        appendParameter(target, "c", contentKey);
        appendParameter(target, "t", contentType);
        appendParameter(target, LANG_PARAM, languageTag);
        response.setStatus(HttpServletResponse.SC_MOVED_TEMPORARILY);
        response.setHeader("Location", target.toString());
    }

    private static void appendParameter(StringBuilder target, String name, String value)
            throws UnsupportedEncodingException {
        if (value == null) {
            return;
        }
        if (target.charAt(target.length() - 1) != '?') {
            target.append('&');
        }
        target.append(name).append('=').append(URLEncoder.encode(value, StandardCharsets.UTF_8.name()));
    }

    /** Sends a 500 unless the response is already on the wire, where sendError would throw. */
    private static void sendServerError(HttpServletResponse response) throws IOException {
        if (!response.isCommitted()) {
            response.sendError(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
        }
    }

    /** One answer for every non-hit, so the endpoint says nothing about which keys exist. */
    private static void sendNotFound(HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_NOT_FOUND);
        response.setContentType("text/html; charset=UTF-8");
        response.getWriter().println("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
                + "<title>Not found</title></head><body><h1>This link is no longer available</h1>"
                + "</body></html>");
    }

    private void renderContent(JCRNodeWrapper node, LinkKind kind, String canonicalType,
            String contentKey, HttpServletRequest request, HttpServletResponse response)
            throws RepositoryException, IOException {
        Resource resource = new Resource(node, "html", "default", "page");
        RenderContext renderContext = new RenderContext(unwrapRequest(request), response,
                JCRSessionFactory.getInstance().getCurrentUser());
        // Order matters: site, then workspace, then servlet path, then main resource.
        JCRSiteNode site = node.getResolveSite();
        renderContext.setSite(site);
        renderContext.setSiteInfo(new SiteInfo(site));
        renderContext.setWorkspace(kind.workspace);
        renderContext.setServletPath(Render.getRenderServletPath());
        renderContext.setMainResource(resource);
        renderContext.setEditMode(false);
        renderContext.setURLGenerator(new URLGenerator(renderContext, resource));

        // Lets the site's own template recognise a shared rendering. A page renders with its
        // chrome, and a visitor holding one link cannot follow the navigation in it, so a site
        // that wants to leave that chrome out branches on this.
        request.setAttribute(SHARED_RENDERING_ATTRIBUTE, Boolean.TRUE);

        String markup;
        try {
            markup = renderService.render(resource, renderContext);
        } catch (RenderException e) {
            LOGGER.error("Unable to render shared node {}", node.getPath(), e);
            sendServerError(response);
            return;
        }

        if (kind == LinkKind.REVIEW) {
            markup = withProxiedAssets(markup, contentKey, canonicalType);
        }

        if (!Boolean.TRUE.equals(request.getAttribute(NOTICE_RENDERED_ATTRIBUTE))) {
            markup = withSharedLinkNotice(markup, kind.noticeKey, renderContext.getMainResourceLocale());
        }

        response.setContentType("text/html; charset=UTF-8");
        response.getWriter().write(markup);
    }

    /**
     * Puts a short notice at the top of a shared rendering.
     *
     * <p>A shared page renders through the site's own template, navigation included, and a visitor
     * holding one link can open nothing else it points at. The module cannot leave that chrome out
     * on its own -- the template owns it, and a template of ours applying to every page would take
     * over ordinary rendering too -- so the default is to say so rather than to let the visitor
     * discover it by clicking. A site that would rather render a shared page without its chrome
     * branches on {@value #SHARED_RENDERING_ATTRIBUTE} and sets
     * {@value #NOTICE_RENDERED_ATTRIBUTE}.</p>
     *
     * <p>Styling is inline because the notice must read the same on a site whose stylesheet it has
     * never seen. If the markup has no {@code body} element the page is returned untouched: a
     * missing notice is a smaller problem than a broken page.</p>
     */
    static String withSharedLinkNotice(String markup, String noticeKey, Locale locale) {
        Matcher body = BODY_TAG.matcher(markup);
        if (!body.find()) {
            return markup;
        }

        String text;
        try {
            text = ResourceBundle.getBundle(BUNDLE, locale).getString(noticeKey);
        } catch (MissingResourceException e) {
            LOGGER.warn("No {} string for {}", noticeKey, locale, e);
            return markup;
        }

        String notice = "<div role=\"status\" style=\"padding:12px 16px;margin:0;"
                + "font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;"
                + "color:#2b2f33;background:#fff6e0;border-bottom:1px solid #e8c97a;"
                + "text-align:center\">" + escapeHtml(text) + "</div>";

        return markup.substring(0, body.end()) + notice + markup.substring(body.end());
    }

    /** Escapes the five characters that matter in HTML text. */
    static String escapeHtml(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;").replace("'", "&#39;");
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
