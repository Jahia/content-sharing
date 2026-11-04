export const PUBLISHED = 'published';
export const REVIEW = 'review';

export const PROPERTY = {
    [PUBLISHED]: 'cshare:sharedUrl',
    [REVIEW]: 'cshare:reviewUrl'
};

const value = property => (property && property.value) || null;

const KEY_FIELD = {[PUBLISHED]: 'sharedKey', [REVIEW]: 'reviewKey'};
const EXPIRY_FIELD = {[PUBLISHED]: 'sharedExpiry', [REVIEW]: 'reviewExpiry'};

/**
 * Reads one workspace into the map, under one key per node, language and kind.
 *
 * `side` is `authoring` or `live`: an entry may end up with one side or both, and which sides it
 * has is the whole state of the link.
 */
const collect = (map, nodes, kind, side) => {
    (nodes || []).forEach(node => {
        ((node.translations && node.translations.nodes) || []).forEach(translation => {
            if (!value(translation[KEY_FIELD[kind]])) {
                return;
            }

            const language = value(translation.language);
            const id = node.uuid + '\u0000' + language + '\u0000' + kind;
            const entry = map.get(id) || {id, uuid: node.uuid, language, kind};
            entry[side] = {
                path: node.path,
                displayName: node.displayName || node.path.split('/').pop(),
                nodeType: (node.primaryNodeType && node.primaryNodeType.name) || '',
                expiry: value(translation[EXPIRY_FIELD[kind]])
            };
            map.set(id, entry);
        });
    });
};

/**
 * Turns what the query returns into one row per link: a node shared in three languages is three
 * links, each with its own key and its own expiry date, and each revoked on its own.
 *
 * The two workspaces are merged rather than filtered one by the other, because a published link
 * exists in whichever of them still carries its key:
 *
 * - authoring only -- the link is set but has not been published, so it does not work yet;
 * - both -- the link is set and working;
 * - live only -- the key has been cleared in authoring and that change has not been published,
 *   so the link is still working. This is the state revoking leaves behind, and the panel would
 *   hide the link at the exact moment it most needs to show it if it read authoring alone.
 *
 * A review link is served from authoring and never reaches live, so it only ever has one side.
 */
export const toRows = ({authoring, live}) => {
    const map = new Map();
    collect(map, authoring && authoring.shared && authoring.shared.nodes, PUBLISHED, 'authoring');
    collect(map, authoring && authoring.review && authoring.review.nodes, REVIEW, 'authoring');
    collect(map, live && live.shared && live.shared.nodes, PUBLISHED, 'live');

    const rows = [];
    map.forEach(entry => {
        const side = entry.authoring || entry.live;
        rows.push({
            id: entry.id,
            uuid: entry.uuid,
            kind: entry.kind,
            language: entry.language,
            path: side.path,
            displayName: side.displayName,
            nodeType: side.nodeType,
            expiry: side.expiry,
            inAuthoring: Boolean(entry.authoring),
            // Only a published link has a live side; a review link never reaches live.
            stillLive: entry.kind === PUBLISHED ? Boolean(entry.live) : null
        });
    });

    return rows.sort((a, b) =>
        a.path.localeCompare(b.path) ||
        a.kind.localeCompare(b.kind) ||
        a.language.localeCompare(b.language));
};

/** `null` when there is no expiry date, otherwise whether that date has passed. */
export const isExpired = row => {
    if (!row.expiry) {
        return null;
    }

    const date = new Date(row.expiry);
    return Number.isNaN(date.getTime()) ? null : date.getTime() < Date.now();
};

/**
 * A review link with no expiry date does not work: the endpoint refuses it. The panel says so,
 * because nothing else does -- the visitor sees the same answer as any other dead link.
 */
export const isInert = row => row.kind === REVIEW && !row.expiry;

/** The key is gone from authoring but live still serves it: one publication away from revoked. */
export const isPendingRevocation = row => !row.inAuthoring && row.stillLive === true;

/** Set in authoring, never published: the link does not work yet. */
export const isNotYetLive = row => row.kind === PUBLISHED && row.inAuthoring && row.stillLive === false;

export const LIVE = 'live';
export const PENDING_REVOCATION = 'pendingRevocation';
export const NOT_YET_LIVE = 'notYetLive';
export const AUTHORING = 'authoring';

/**
 * One word for where the link is served from, so the table, the CSV and the JSON all say the same
 * thing. A review link is always `authoring`: that is the workspace it is served from.
 */
export const state = row => {
    if (row.kind === REVIEW) {
        return AUTHORING;
    }

    if (isPendingRevocation(row)) {
        return PENDING_REVOCATION;
    }

    return row.stillLive ? LIVE : NOT_YET_LIVE;
};
