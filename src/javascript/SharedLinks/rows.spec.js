import {describe, expect, it} from 'vitest';
import {
    aliasFor, COPY, isExpired, isInert, isNotYetLive, isPendingRevocation, PUBLISHED, REVIEW,
    revocationPlan, state, toRows
} from './rows';

const LANGUAGES = ['en', 'fr'];

/**
 * A node as the server returns it: one aliased property per language and per key, which is what
 * `linksQuery` asks for. Translation children are deliberately absent -- the instance returns none.
 */
const node = (uuid, path, keys = {}) => {
    const built = {
        uuid,
        path,
        displayName: path.split('/').pop(),
        primaryNodeType: {name: 'jnt:page'},
        __typename: 'GenericJCRNode'
    };
    Object.entries(keys).forEach(([language, fields]) => {
        Object.entries(fields).forEach(([field, value]) => {
            built[aliasFor(language) + '__' + field] = value === null ? null : {value};
        });
    });
    return built;
};

const answer = ({shared = [], review = [], liveShared = []} = {}) => ({
    authoring: {shared: {nodes: shared}, review: {nodes: review}},
    live: {shared: {nodes: liveShared}}
});

const rowsOf = (data, languages = LANGUAGES) => toRows(data, languages);

describe('toRows', () => {
    it('reports one row per language, each with its own key and expiry', () => {
        const rows = rowsOf(answer({
            shared: [node('u1', '/sites/demo/home', {
                en: {sharedKey: 'AAA', sharedExpiry: '2027-01-01T00:00:00.000Z'},
                fr: {sharedKey: 'BBB', sharedExpiry: '2027-02-01T00:00:00.000Z'}
            })]
        }));

        expect(rows).toHaveLength(2);
        expect(rows.map(r => r.language)).toEqual(['en', 'fr']);
        expect(rows.map(r => r.expiry)).toEqual(['2027-01-01T00:00:00.000Z', '2027-02-01T00:00:00.000Z']);
    });

    it('leaves out a language that carries no key', () => {
        const rows = rowsOf(answer({
            shared: [node('u1', '/sites/demo/home', {en: {sharedKey: 'AAA'}, fr: {sharedKey: null}})]
        }));

        expect(rows).toHaveLength(1);
        expect(rows[0].language).toBe('en');
    });

    it('reports a page the server answered with, which is what the panel failed to do', () => {
        // The shape of the real answer from molex: pages found, keys on the node under their
        // per-language aliases. Reading them anywhere else reported nothing at all.
        const rows = rowsOf(answer({
            review: [
                node('u1', '/sites/molex-classic/home/about', {en: {reviewKey: 'RRR', reviewExpiry: '2027-01-01T00:00:00.000Z'}}),
                node('u2', '/sites/molex-classic/home/trends', {en: {reviewKey: 'SSS'}})
            ],
            liveShared: [node('u1', '/sites/molex-classic/home/about')]
        }));

        expect(rows.map(r => r.path)).toEqual([
            '/sites/molex-classic/home/about',
            '/sites/molex-classic/home/trends'
        ]);
        expect(rows[0].kind).toBe(REVIEW);
    });

    it('does not let a node present in both workspaces cancel itself out', () => {
        // The live copy of a review-shared page carries no key. It must not remove the row.
        const rows = rowsOf(answer({
            review: [node('u1', '/sites/demo/home', {en: {reviewKey: 'RRR'}})],
            liveShared: [node('u1', '/sites/demo/home')]
        }));

        expect(rows).toHaveLength(1);
        expect(rows[0].stillLive).toBeNull();
    });

    it('reports both kinds for the same node and language, as separate links', () => {
        const rows = rowsOf(answer({
            shared: [node('u1', '/sites/demo/home', {en: {sharedKey: 'AAA'}})],
            review: [node('u1', '/sites/demo/home', {en: {reviewKey: 'RRR'}})]
        }));

        expect(rows.map(r => r.kind)).toEqual([PUBLISHED, REVIEW]);
        expect(new Set(rows.map(r => r.id)).size).toBe(2);
    });

    it('merges the two workspaces into one row rather than two', () => {
        const rows = rowsOf(answer({
            shared: [node('u1', '/sites/demo/home', {en: {sharedKey: 'AAA'}})],
            liveShared: [node('u1', '/sites/demo/home', {en: {sharedKey: 'AAA'}})]
        }));

        expect(rows).toHaveLength(1);
        expect(rows[0].inAuthoring).toBe(true);
        expect(rows[0].stillLive).toBe(true);
    });

    it('keeps reporting a link whose key was cleared in authoring while live still serves it', () => {
        const rows = rowsOf(answer({
            liveShared: [node('u1', '/sites/demo/home', {
                en: {sharedKey: 'AAA', sharedExpiry: '2027-01-01T00:00:00.000Z'}
            })]
        }));

        expect(rows).toHaveLength(1);
        expect(rows[0].inAuthoring).toBe(false);
        expect(rows[0].stillLive).toBe(true);
        expect(rows[0].expiry).toBe('2027-01-01T00:00:00.000Z');
        expect(isPendingRevocation(rows[0])).toBe(true);
    });

    it('tells a link not yet published from one still live after a revocation', () => {
        const rows = rowsOf(answer({
            shared: [node('u1', '/sites/demo/alpha', {en: {sharedKey: 'AAA'}})],
            liveShared: [node('u2', '/sites/demo/beta', {en: {sharedKey: 'BBB'}})]
        }));

        const alpha = rows.find(r => r.path === '/sites/demo/alpha');
        const beta = rows.find(r => r.path === '/sites/demo/beta');
        expect(isNotYetLive(alpha)).toBe(true);
        expect(isPendingRevocation(beta)).toBe(true);
    });

    it('matches the two workspaces per language, not per node', () => {
        const rows = rowsOf(answer({
            shared: [node('u1', '/sites/demo/home', {en: {sharedKey: 'AAA'}, fr: {sharedKey: 'BBB'}})],
            liveShared: [node('u1', '/sites/demo/home', {en: {sharedKey: 'AAA'}})]
        }));

        expect(rows.find(r => r.language === 'en').stillLive).toBe(true);
        expect(rows.find(r => r.language === 'fr').stillLive).toBe(false);
    });

    it('reads a language whose code is not a valid GraphQL alias', () => {
        const rows = rowsOf(
            answer({shared: [node('u1', '/sites/demo/home', {'pt-BR': {sharedKey: 'AAA'}})]}),
            ['pt-BR']
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].language).toBe('pt-BR');
    });

    it('carries the key of the workspace that serves the link', () => {
        const rows = rowsOf(answer({
            shared: [node('u1', '/sites/demo/a', {en: {sharedKey: 'NEW'}}), node('u2', '/sites/demo/b', {en: {sharedKey: 'DRAFT'}})],
            review: [node('u3', '/sites/demo/c', {en: {reviewKey: 'REVIEW'}})],
            liveShared: [node('u1', '/sites/demo/a', {en: {sharedKey: 'OLD'}}), node('u4', '/sites/demo/d', {en: {sharedKey: 'GONE'}})]
        }), ['en']);
        const key = path => rows.find(r => r.path === path).key;

        // Regenerated in authoring, not published: visitors still hold the live key.
        expect(key('/sites/demo/a')).toBe('OLD');
        // Never published: the authoring key, which the state says does not work yet.
        expect(key('/sites/demo/b')).toBe('DRAFT');
        // A review link is served from authoring.
        expect(key('/sites/demo/c')).toBe('REVIEW');
        // Cleared in authoring, still live: the key that still works.
        expect(key('/sites/demo/d')).toBe('GONE');
    });

    it('sorts by path, then kind, then language', () => {
        const rows = rowsOf(answer({
            shared: [
                node('u2', '/sites/demo/zebra', {en: {sharedKey: 'A'}}),
                node('u1', '/sites/demo/alpha', {en: {sharedKey: 'C'}, fr: {sharedKey: 'B'}})
            ],
            review: [node('u1', '/sites/demo/alpha', {en: {reviewKey: 'D'}})]
        }));

        expect(rows.map(r => r.path + ' ' + r.kind + ' ' + r.language)).toEqual([
            '/sites/demo/alpha published en',
            '/sites/demo/alpha published fr',
            '/sites/demo/alpha review en',
            '/sites/demo/zebra published en'
        ]);
    });

    it('reports nothing, and throws nothing, when a workspace answered with no nodes', () => {
        expect(toRows({authoring: null, live: null}, LANGUAGES)).toEqual([]);
        expect(toRows({authoring: {}, live: {}}, LANGUAGES)).toEqual([]);
        expect(toRows({authoring: {}, live: {}})).toEqual([]);
    });

    it('reports nothing when it was given no languages, rather than guessing one', () => {
        const rows = toRows(answer({shared: [node('u1', '/sites/demo/home', {en: {sharedKey: 'AAA'}})]}), []);
        expect(rows).toEqual([]);
    });
});

describe('isExpired', () => {
    it('says nothing when there is no date', () => {
        expect(isExpired({expiry: null})).toBeNull();
    });

    it('says nothing when the date cannot be read', () => {
        expect(isExpired({expiry: 'whenever'})).toBeNull();
    });

    it('tells a past date from a future one', () => {
        expect(isExpired({expiry: '2001-01-01T00:00:00.000Z'})).toBe(true);
        expect(isExpired({expiry: '2099-01-01T00:00:00.000Z'})).toBe(false);
    });
});

describe('isInert', () => {
    it('flags a review link with no expiry date, which the endpoint refuses', () => {
        expect(isInert({kind: REVIEW, expiry: null})).toBe(true);
        expect(isInert({kind: REVIEW, expiry: '2099-01-01T00:00:00.000Z'})).toBe(false);
    });

    it('leaves a published link alone, which works without one', () => {
        expect(isInert({kind: PUBLISHED, expiry: null})).toBe(false);
    });
});

describe('revocationPlan', () => {
    const link = (language, overrides = {}) => ({
        uuid: 'u1', kind: REVIEW, language, expiry: '2026-11-07T00:00:00.000Z', inAuthoring: true, ...overrides
    });

    it('removes the key, its expiry date and the mixin when it was the node\'s only link of that kind', () => {
        const row = link('en');
        expect(revocationPlan(row, [row])).toEqual({
            deleteLink: null,
            property: 'cshare:reviewUrl', expiryProperty: 'cshare:reviewUrlExpiry', mixin: 'cshmix:reviewUrl'
        });
    });

    it('keeps the mixin while another language still holds a key of that kind', () => {
        const row = link('en');
        expect(revocationPlan(row, [row, link('fr')]).mixin).toBeNull();
    });

    it('does not count a language whose key is only left in live', () => {
        const row = link('en', {kind: PUBLISHED});
        const stillLive = link('fr', {kind: PUBLISHED, inAuthoring: false});
        expect(revocationPlan(row, [row, stillLive]).mixin).toBe('cshmix:sharedUrl');
    });

    it('does not count the other kind of link on the same node', () => {
        const row = link('en');
        expect(revocationPlan(row, [row, link('en', {kind: PUBLISHED})]).mixin).toBe('cshmix:reviewUrl');
    });

    it('leaves the expiry date alone when there is none to remove', () => {
        const row = link('en', {expiry: null});
        expect(revocationPlan(row, [row]).expiryProperty).toBeNull();
    });
});

describe('review link nodes', () => {
    const linkNode = (language, owner = 'u1') => ({
        uuid: 'link-' + language,
        path: '/sites/demo/home/about/cshareReviewLinks/' + language,
        name: language,
        key: {value: 'KEY-' + language},
        expiry: {value: '2026-11-12T10:00:00.000Z'},
        owner: {value: owner},
        parent: {parent: {uuid: 'u1', path: '/sites/demo/home/about', displayName: 'About', primaryNodeType: {name: 'jnt:page'}}}
    });
    const withLinks = (links, review = []) => ({
        authoring: {shared: {nodes: []}, review: {nodes: review}, reviewLinks: {nodes: links}},
        live: {shared: {nodes: []}}
    });

    it('reports one row per link, for its content and its language', () => {
        const [row] = rowsOf(withLinks([linkNode('en')]));
        expect(row).toMatchObject({
            id: 'link-en', uuid: 'u1', kind: REVIEW, language: 'en', path: '/sites/demo/home/about',
            displayName: 'About', nodeType: 'jnt:page', key: 'KEY-en', isCopy: false,
            linkPath: '/sites/demo/home/about/cshareReviewLinks/en'
        });
    });

    it('flags a link that came with a copy of another node', () => {
        const [row] = rowsOf(withLinks([linkNode('en', 'someone-else')]));
        expect(row.isCopy).toBe(true);
        expect(state(row)).toBe(COPY);
    });

    it('revokes such a link by deleting it, and nothing else', () => {
        const [row] = rowsOf(withLinks([linkNode('en')]));
        expect(revocationPlan(row, [row])).toEqual({
            deleteLink: '/sites/demo/home/about/cshareReviewLinks/en', property: null, expiryProperty: null, mixin: null
        });
    });

    it('does not keep an old review mixin on the node because of a new link', () => {
        const rows = rowsOf(withLinks([linkNode('fr')], [node('u1', '/sites/demo/home/about', {
            en: {reviewKey: 'OLD', reviewExpiry: '2026-11-12T10:00:00.000Z'}
        })]));
        const legacy = rows.find(row => !row.linkPath);
        expect(revocationPlan(legacy, rows).mixin).toBe('cshmix:reviewUrl');
    });
});

