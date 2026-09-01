/*
 * Phase 1 of the 1.x -> 2.x namespace migration. RUN BEFORE DEPLOYING 2.x.
 *
 * Reads every sharing key still stored under the old `se:` namespace and prints them as JSON.
 * Read-only: it writes nothing. Save the output, deploy 2.x, then feed it to 2-import-keys.groovy.
 *
 * Run from Administration > Server > Tools > Groovy console, or via the provisioning API
 * (`executeScript`). The output appears in the console / in jahia.log.
 *
 * The properties are internationalized, so the values live on the jnt:translation child nodes;
 * this walks them per language rather than reading the parent.
 */
import org.jahia.services.content.*
import javax.jcr.query.Query
import groovy.json.JsonOutput

final OLD_MIXIN = "semix:sharedUrl"
final OLD_KEY = "se:sharedUrl"
final OLD_EXPIRY = "se:sharedUrlExpiry"

def rows = []

JCRTemplate.instance.doExecuteWithSystemSession(null, "default", { JCRSessionWrapper session ->
    def nodes = session.workspace.queryManager
            .createQuery("SELECT * FROM [" + OLD_MIXIN + "]", Query.JCR_SQL2)
            .execute().nodes
    while (nodes.hasNext()) {
        JCRNodeWrapper node = (JCRNodeWrapper) nodes.next()
        node.getNodes("j:translation_*").each { translation ->
            if (!translation.hasProperty(OLD_KEY)) {
                return
            }
            rows << [
                    identifier: node.identifier,
                    path      : node.path,
                    language  : translation.getProperty("jcr:language").string,
                    key       : translation.getProperty(OLD_KEY).string,
                    expiry    : translation.hasProperty(OLD_EXPIRY)
                            ? translation.getProperty(OLD_EXPIRY).string : null
            ]
        }
    }
    return null
} as JCRCallback)

println "content-sharing migration export: ${rows.size()} key(s)"
println JsonOutput.prettyPrint(JsonOutput.toJson(rows))
