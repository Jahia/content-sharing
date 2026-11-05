import {gql} from '@apollo/client';

/**
 * Whether the action shows on a node: the module is on for its site, the node is something a
 * review link can open, and the person may write what a link needs. A content item or a file
 * without the mixin also needs to manage its node types.
 */
export const REVIEW_LINK_ACCESS = gql`
    query ContentSharingReviewLinkAccess($path: String!) {
        jcr(workspace: EDIT) {
            nodeByPath(path: $path) {
                uuid
                workspace
                shareable: isNodeType(type: {types: ["jnt:page", "jmix:mainResource", "jnt:file"]})
                isPage: isNodeType(type: {types: ["jnt:page"]})
                hasMixin: isNodeType(type: {types: ["cshmix:reviewLinks"]})
                canAddChildren: hasPermission(permissionName: "jcr:addChildNodes")
                canManageTypes: hasPermission(permissionName: "jcr:nodeTypeManagement")
                site {
                    uuid
                    workspace
                    installed: property(name: "j:installedModules") { values }
                }
            }
        }
    }
`;

/** The node and its link in one language, which is all the dialog shows. */
export const REVIEW_LINK = gql`
    query ContentSharingReviewLink($path: String!, $language: String!) {
        jcr(workspace: EDIT) {
            nodeByPath(path: $path) {
                uuid
                workspace
                path
                displayName(language: $language)
                primaryNodeType { name }
                isPage: isNodeType(type: {types: ["jnt:page"]})
                hasMixin: isNodeType(type: {types: ["cshmix:reviewLinks"]})
                container: children(names: ["cshareReviewLinks"]) {
                    nodes {
                        uuid
                        workspace
                        path
                        link: children(names: [$language]) {
                            nodes {
                                uuid
                                workspace
                                path
                                key: property(name: "cshare:key") { value }
                                expiry: property(name: "cshare:expiry") { value }
                                owner: property(name: "cshare:owner") { value }
                            }
                        }
                    }
                }
            }
        }
    }
`;

// Every node carries uuid and workspace: jContent's Apollo cache keys JCR nodes on both.

/*
 * Every write runs as the signed-in user, so the repository decides who may share what. None of
 * them touches the node's own properties: the links live in a child that is never published.
 */
export const ADD_MIXIN = gql`
    mutation ContentSharingReviewLinkMixin($path: String!) {
        jcr { mutateNode(pathOrId: $path) { addMixins(mixins: ["cshmix:reviewLinks"]) } }
    }
`;

export const ADD_CONTAINER = gql`
    mutation ContentSharingReviewLinkContainer($path: String!) {
        jcr { mutateNode(pathOrId: $path) { addChild(name: "cshareReviewLinks", primaryNodeType: "cshnt:reviewLinks") { uuid } } }
    }
`;

export const ADD_LINK = gql`
    mutation ContentSharingReviewLinkAdd($path: String!, $language: String!, $key: String!, $expiry: String!, $owner: String!) {
        jcr {
            mutateNode(pathOrId: $path) {
                addChild(name: $language, primaryNodeType: "cshnt:reviewLink", properties: [
                    {name: "cshare:key", value: $key},
                    {name: "cshare:expiry", value: $expiry, type: DATE},
                    {name: "cshare:owner", value: $owner}
                ]) { uuid }
            }
        }
    }
`;

/** Changes a link in place: a new expiry date, or a link a copy brought along made this node's own. */
export const UPDATE_LINK = gql`
    mutation ContentSharingReviewLinkUpdate($path: String!, $properties: [InputJCRProperty]!) {
        jcr { mutateNode(pathOrId: $path) { setPropertiesBatch(properties: $properties) { path } } }
    }
`;

/** Revokes a link. The container stays: deleting it would mark the node as modified. */
export const DELETE_LINK = gql`
    mutation ContentSharingReviewLinkDelete($path: String!) {
        jcr { deleteNode(pathOrId: $path) }
    }
`;
