/*
 * 2.4 -> 2.5 review links. RUN AFTER DEPLOYING 2.5.0.
 *
 * Moves every review link still stored the 2.4 way (the cshmix:reviewUrl mixin: a key and an expiry
 * date per language on the node) to the 2.5 storage: a cshnt:reviewLink node named after the
 * language, in a cshareReviewLinks container under the node, never published. The key and the
 * expiry date are kept, so an address already handed to a reviewer keeps working.
 *
 * - A key with no expiry date, or one already expired, opened nothing: it is cleared, not moved.
 * - A language that already has a 2.5 link keeps it; the old key is cleared.
 * - The old properties and the mixin are removed from the node, in the authoring workspace only.
 *   The node then shows as modified. It is NOT published: a stale copy of the old key may remain in
 *   live, where it opens nothing, until the node is next published for its own reasons.
 *
 * Run from Administration > Server > Tools > Groovy console, or via the provisioning API
 * (`executeScript`). Run with DRY_RUN = true, read every line, then with false, then once more:
 * the second real run must report 0 node(s).
 */
import org.jahia.services.content.*
import javax.jcr.query.Query

final boolean DRY_RUN = true

final OLD_MIXIN = "cshmix:reviewUrl"
final OLD_KEY = "cshare:reviewUrl"
final OLD_EXPIRY = "cshare:reviewUrlExpiry"
final CONTAINER = "cshareReviewLinks"
final CONTAINER_TYPE = "cshnt:reviewLinks"
final LINK_TYPE = "cshnt:reviewLink"
final HOLDER_MIXIN = "cshmix:reviewLinks"

def say = { String line -> println line; log.info("content-sharing review link migration: " + line) }
def counts = [nodes: 0, moved: 0, kept: 0, dropped: 0, failed: 0]
// Fully qualified: the Groovy console imports org.quartz.*, whose Calendar would win.
def now = java.util.Calendar.getInstance()

say(DRY_RUN ? "DRY RUN - nothing is written" : "WRITING")

JCRTemplate.instance.doExecuteWithSystemSession(null, "default", { JCRSessionWrapper session ->
    def ids = []
    def found = session.workspace.queryManager
            .createQuery("SELECT * FROM [" + OLD_MIXIN + "]", Query.JCR_SQL2).execute().nodes
    while (found.hasNext()) {
        ids << ((JCRNodeWrapper) found.next()).identifier
    }

    ids.each { id ->
        JCRNodeWrapper node = session.getNodeByIdentifier(id)
        counts.nodes++
        try {
            if (node.hasProperty("j:lockTypes")) {
                say("WARN ${node.path} is locked by an editor; the system session writes through the lock")
            }
            def translations = node.getNodes("j:translation_*").toList().findAll { it.hasProperty(OLD_KEY) || it.hasProperty(OLD_EXPIRY) }
            translations.each { translation ->
                String language = translation.getProperty("jcr:language").string
                String key = translation.hasProperty(OLD_KEY) ? translation.getProperty(OLD_KEY).string : null
                java.util.Calendar expiry = translation.hasProperty(OLD_EXPIRY) ? translation.getProperty(OLD_EXPIRY).date : null
                String where = "${node.path} [${language}]"

                if (key == null) {
                    say("clear  ${where}: an expiry date without a key")
                } else if (expiry == null) {
                    counts.dropped++
                    say("drop   ${where}: no expiry date, this link never opened anything")
                } else if (expiry.before(now)) {
                    counts.dropped++
                    say("drop   ${where}: expired ${expiry.time}")
                } else if (node.hasNode(CONTAINER) && node.getNode(CONTAINER).hasNode(language)) {
                    counts.kept++
                    say("keep   ${where}: a 2.5 link already exists in this language, the old key is cleared")
                } else {
                    counts.moved++
                    say("move   ${where}: same key, expires ${expiry.time}")
                    if (!DRY_RUN) {
                        if (!node.isNodeType("jnt:page") && !node.isNodeType(HOLDER_MIXIN)) {
                            node.addMixin(HOLDER_MIXIN)
                        }
                        JCRNodeWrapper container = node.hasNode(CONTAINER)
                                ? node.getNode(CONTAINER) : node.addNode(CONTAINER, CONTAINER_TYPE)
                        JCRNodeWrapper link = container.addNode(language, LINK_TYPE)
                        link.setProperty("cshare:key", key)
                        link.setProperty("cshare:expiry", expiry)
                        link.setProperty("cshare:owner", node.identifier)
                    }
                }

                if (!DRY_RUN) {
                    [OLD_KEY, OLD_EXPIRY].each { name ->
                        if (translation.hasProperty(name)) {
                            translation.getProperty(name).remove()
                        }
                    }
                }
            }
            if (!DRY_RUN) {
                node.removeMixin(OLD_MIXIN)
                session.save()
            }
        } catch (Exception e) {
            counts.failed++
            session.refresh(false)
            say("FAILED ${node.path}: ${e.message}")
        }
    }
    return null
} as JCRCallback)

say("${counts.nodes} node(s): ${counts.moved} link(s) moved, ${counts.kept} kept (already 2.5), " +
        "${counts.dropped} dropped (expired or no expiry), ${counts.failed} failed")
if (!DRY_RUN && counts.nodes > 0) {
    say("Run again: it must report 0 node(s). The nodes above now show as modified; nothing was published.")
}
