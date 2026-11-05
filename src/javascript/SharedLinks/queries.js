import {gql} from '@apollo/client';

import {aliasFor} from './rows';

/** `en`, `fr`, `zh_CN`, `pt-BR`. Anything else never reaches a query document. */
const LANGUAGE_CODE = /^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*$/;

/**
 * What the panel needs before it can ask for anything: whether this site switched the module on,
 * and which languages it has. The languages decide the shape of the links query, so they have to
 * come back first.
 */
export const SITE_CONTEXT = gql`
    query ContentSharingSiteContext($sitePath: String!) {
        jcr(workspace: EDIT) {
            nodeByPath(path: $sitePath) {
                installed: property(name: "j:installedModules") { values }
                site {
                    languages { language }
                }
            }
        }
    }
`;

/**
 * Every key, in every language of the site.
 *
 * The keys are internationalized, so each one is read with an explicit `language` argument and an
 * alias of its own. Reading them through the `jnt:translation` children instead looks tidier and
 * does not work: on Jahia 8.2.3.2 / jContent 3.8.1 that child list comes back empty through
 * GraphQL, with no error, so every link went unreported (molex, 2026-11-04).
 *
 * Review links made since 2.5.0 are nodes of their own (`cshnt:reviewLink`) under the content they
 * open, read in one list; the language is the link's name and the content is its grandparent.
 *
 * Both kinds are read from the authoring workspace, which holds every node whether published or
 * not. The published kind is read from the live workspace as well, because that is the workspace
 * its links are served from: a key cleared in authoring but still live is still a working link,
 * and the panel has to be able to say so.
 */
export const linksDocumentText = languages => {
    const codes = languages.filter(language => LANGUAGE_CODE.test(language));
    const keys = codes.map(language => {
        const alias = aliasFor(language);
        return [
            ['sharedKey', 'cshare:sharedUrl'],
            ['sharedExpiry', 'cshare:sharedUrlExpiry'],
            ['reviewKey', 'cshare:reviewUrl'],
            ['reviewExpiry', 'cshare:reviewUrlExpiry']
        ].map(([field, property]) =>
            `${alias}__${field}: property(name: "${property}", language: "${language}") { value }`
        ).join('\n            ');
    }).join('\n            ');

    const node = `
            uuid
            path
            displayName(language: $displayLanguage)
            primaryNodeType { name }
            ${keys}`;

    const byType = (alias, type) => `
        ${alias}: nodesByCriteria(criteria: {
            nodeType: "${type}", paths: [$sitePath], pathType: ANCESTOR
        }) { nodes { ${node} } }`;

    return `
        query ContentSharingLinks($sitePath: String!, $displayLanguage: String!) {
            authoring: jcr(workspace: EDIT) {
                ${byType('shared', 'cshmix:sharedUrl')}
                ${byType('review', 'cshmix:reviewUrl')}
                reviewLinks: nodesByCriteria(criteria: {
                    nodeType: "cshnt:reviewLink", paths: [$sitePath], pathType: ANCESTOR
                }) {
                    nodes {
                        uuid
                        path
                        name
                        key: property(name: "cshare:key") { value }
                        expiry: property(name: "cshare:expiry") { value }
                        owner: property(name: "cshare:owner") { value }
                        parent { parent {
                            uuid
                            path
                            displayName(language: $displayLanguage)
                            primaryNodeType { name }
                        } }
                    }
                }
            }
            live: jcr(workspace: LIVE) {
                ${byType('shared', 'cshmix:sharedUrl')}
            }
        }
    `;
};

/** The document Apollo sends. Its text is built separately so that it can be parsed in a test. */
export const linksQuery = languages => gql(linksDocumentText(languages));

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

/**
 * Revokes a review link made since 2.5.0 by deleting it. Its container stays: deleting the
 * container would mark the content as modified.
 */
export const DELETE_LINK = gql`
    mutation ContentSharingDeleteLink($path: String!) {
        jcr { deleteNode(pathOrId: $path) }
    }
`;

/** Removes the sharing mixin once the node has no key of that kind left. */
export const REMOVE_MIXIN = gql`
    mutation ContentSharingRemoveMixin($pathOrId: String!, $mixin: String!) {
        jcr {
            mutateNode(pathOrId: $pathOrId) {
                removeMixins(mixins: [$mixin])
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
