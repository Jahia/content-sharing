/** The container that holds a node's review links, one per language, named after it. */
export const CONTAINER = 'cshareReviewLinks';
export const CONTAINER_TYPE = 'cshnt:reviewLinks';
export const LINK_TYPE = 'cshnt:reviewLink';

/** What lets a content item or a file hold the container. A page holds it without. */
export const MIXIN = 'cshmix:reviewLinks';

/** What the dialog offers, in days. A review link always expires. */
export const DURATIONS = [1, 3, 7, 14, 30];
export const DEFAULT_DAYS = 7;

const DAY = 24 * 60 * 60 * 1000;

/** The expiry date `days` from `now`, as the repository stores dates. */
export const expiryAfter = (days, now = new Date()) => new Date(now.getTime() + (days * DAY)).toISOString();

/** `fr` as "French" in the interface's language, or the code itself where the browser cannot say. */
export const languageName = (language, uiLanguage) => {
    try {
        return new Intl.DisplayNames([uiLanguage || 'en'], {type: 'language'}).of(language.replace('_', '-')) || language;
    } catch (_) {
        return language;
    }
};

const value = property => (property && property.value) || null;

/**
 * The link the node holds in `language`, as the dialog shows it, or `null`.
 *
 * A link whose owner is another node came with a copy of that node: the endpoint refuses it, so
 * the dialog treats the node as having none, and creating one writes over it.
 */
export const readLink = (node, now = new Date()) => {
    const container = node && node.container && node.container.nodes && node.container.nodes[0];
    const link = container && container.link && container.link.nodes && container.link.nodes[0];
    if (!link || value(link.owner) !== node.uuid) {
        return null;
    }

    const expiry = value(link.expiry);
    return {
        path: link.path,
        key: value(link.key),
        expiry,
        expired: !expiry || new Date(expiry).getTime() < now.getTime()
    };
};

/**
 * What creating or changing a link has to write, in order.
 *
 * Nothing is ever deleted on the way: deleting the container would mark the node as modified,
 * which is what keeping the links out of the node's publication avoids. A link left by a copy is
 * written over in place.
 */
export const writePlan = node => {
    const container = node.container && node.container.nodes && node.container.nodes[0];
    const link = container && container.link && container.link.nodes && container.link.nodes[0];
    return {
        addMixin: !node.isPage && !node.hasMixin && !container,
        addContainer: !container,
        containerPath: node.path + '/' + CONTAINER,
        linkPath: link ? link.path : null
    };
};

const MODULE = 'content-sharing';

/**
 * Whether the action shows on a node: the module is on for its site, a review link can open the
 * node, and the person can write the link. Hiding is not the check: the repository refuses the
 * writes of someone who lacks the rights.
 */
export const mayShare = node => {
    if (!node || !node.shareable || !node.canAddChildren) {
        return false;
    }

    const installed = node.site && node.site.installed && node.site.installed.values;
    if (!installed || !installed.includes(MODULE)) {
        return false;
    }

    return Boolean(node.isPage || node.hasMixin || node.canManageTypes);
};
