import {gql} from '@apollo/client';

/**
 * Everything the panel lists, in one round trip.
 *
 * Both kinds are read from the authoring workspace, which holds every node whether published or
 * not. The published kind is read from the live workspace as well, because that is the workspace
 * its links are served from: a key cleared in authoring but still live is still a working link,
 * and the panel has to be able to say so.
 *
 * The keys are internationalized, so they live on the translation child nodes rather than on the
 * node itself. Reading those children gives every language in one query, with no alias built at
 * runtime: Apollo needs a static document.
 */
const TRANSLATIONS = `
    uuid
    path
    displayName(language: $displayLanguage)
    primaryNodeType { name }
    translations: children(typesFilter: {types: ["jnt:translation"]}) {
        nodes {
            language: property(name: "jcr:language") { value }
            sharedKey: property(name: "cshare:sharedUrl") { value }
            sharedExpiry: property(name: "cshare:sharedUrlExpiry") { value }
            reviewKey: property(name: "cshare:reviewUrl") { value }
            reviewExpiry: property(name: "cshare:reviewUrlExpiry") { value }
        }
    }
`;

export const SHARED_LINKS = gql`
    query ContentSharingLinks($sitePath: String!, $displayLanguage: String!) {
        authoring: jcr(workspace: EDIT) {
            shared: nodesByCriteria(criteria: {
                nodeType: "cshmix:sharedUrl", paths: [$sitePath], pathType: ANCESTOR
            }) { nodes { ${TRANSLATIONS} } }
            review: nodesByCriteria(criteria: {
                nodeType: "cshmix:reviewUrl", paths: [$sitePath], pathType: ANCESTOR
            }) { nodes { ${TRANSLATIONS} } }
        }
        live: jcr(workspace: LIVE) {
            shared: nodesByCriteria(criteria: {
                nodeType: "cshmix:sharedUrl", paths: [$sitePath], pathType: ANCESTOR
            }) { nodes { ${TRANSLATIONS} } }
        }
    }
`;

/** Whether this site switched the module on, checked in the component and not only on the route. */
export const MODULE_ON_SITE = gql`
    query ContentSharingOnSite($sitePath: String!) {
        jcr(workspace: EDIT) {
            nodeByPath(path: $sitePath) {
                installed: property(name: "j:installedModules") { values }
            }
        }
    }
`;

/**
 * Clears one key, in one language.
 *
 * Runs as the signed-in user, so the repository decides who may do it: someone who cannot write
 * the node cannot revoke its link, and no part of this panel asks for more rights than the person
 * using it already has.
 */
export const REVOKE = gql`
    mutation ContentSharingRevoke($pathOrId: String!, $property: String!, $language: String!) {
        jcr {
            mutateNode(pathOrId: $pathOrId) {
                mutateProperty(name: $property) { delete(language: $language) }
            }
        }
    }
`;

/** Sends a cleared key to the live workspace, where published links are served from. */
export const PUBLISH = gql`
    mutation ContentSharingPublish($pathOrId: String!, $languages: [String]!) {
        jcr {
            mutateNode(pathOrId: $pathOrId) {
                publish(languages: $languages)
            }
        }
    }
`;
