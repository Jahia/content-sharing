/*
 * Phase 2 of the 1.x -> 2.x namespace migration. RUN AFTER DEPLOYING 2.x.
 *
 * Takes the JSON produced by 1-export-keys.groovy, applies the new `cshmix:sharedUrl` mixin and
 * writes each key back under `cshare:`. Nodes are addressed by identifier, so a node moved
 * between the two phases still migrates.
 *
 * Paste the exported JSON into EXPORTED below. Idempotent: a node that already carries the new
 * key with the same value is skipped, so it is safe to re-run after fixing a failure.
 *
 * It does NOT publish. Review the result in jContent, then publish deliberately: a sharing key
 * only takes effect once it reaches the live workspace.
 */
import org.jahia.services.content.*
import groovy.json.JsonSlurper

final EXPORTED = '''
[]
'''

final NEW_MIXIN = "cshmix:sharedUrl"
final NEW_KEY = "cshare:sharedUrl"
final NEW_EXPIRY = "cshare:sharedUrlExpiry"

def rows = new JsonSlurper().parseText(EXPORTED)
def migrated = 0, skipped = 0, failed = 0

JCRTemplate.instance.doExecuteWithSystemSession(null, "default", { JCRSessionWrapper session ->
    rows.each { row ->
        try {
            // A locale-scoped session is what makes setProperty write the right translation node.
            JCRTemplate.instance.doExecuteWithSystemSession(null, "default",
                    Locale.forLanguageTag(row.language), { JCRSessionWrapper localised ->
                JCRNodeWrapper node = localised.getNodeByIdentifier(row.identifier)
                if (node.hasProperty(NEW_KEY) && node.getProperty(NEW_KEY).string == row.key) {
                    skipped++
                    return null
                }
                if (!node.isNodeType(NEW_MIXIN)) {
                    node.addMixin(NEW_MIXIN)
                }
                node.setProperty(NEW_KEY, row.key)
                if (row.expiry != null) {
                    node.setProperty(NEW_EXPIRY, row.expiry)
                }
                localised.save()
                migrated++
                return null
            } as JCRCallback)
        } catch (Exception e) {
            failed++
            println "FAILED ${row.path} [${row.language}]: ${e.message}"
        }
    }
    return null
} as JCRCallback)

println "content-sharing migration: ${migrated} migrated, ${skipped} already done, ${failed} failed"
println failed == 0 ? "OK - review in jContent, then publish." : "Re-run after fixing the failures above."
