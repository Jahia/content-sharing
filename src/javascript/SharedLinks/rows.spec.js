import {describe, expect, it} from 'vitest';
import {
    isExpired, isInert, isNotYetLive, isPendingRevocation, PUBLISHED, REVIEW, toRows
} from './rows';

const translation = props => ({
    language: {value: props.language},
    sharedKey: props.sharedKey ? {value: props.sharedKey} : null,
    sharedExpiry: props.sharedExpiry ? {value: props.sharedExpiry} : null,
    reviewKey: props.reviewKey ? {value: props.reviewKey} : null,
    reviewExpiry: props.reviewExpiry ? {value: props.reviewExpiry} : null
});

const node = (uuid, path, translations) => ({
    uuid,
    path,
    displayName: path.split('/').pop(),
    primaryNodeType: {name: 'jnt:page'},
    translations: {nodes: translations}
});

const answer = ({shared = [], review = [], liveShared = []} = {}) => ({
    authoring: {shared: {nodes: shared}, review: {nodes: review}},
    live: {shared: {nodes: liveShared}}
});

describe('toRows', () => {
    it('reports one row per language, each with its own key and expiry', () => {
        const rows = toRows(answer({
            shared: [node('u1', '/sites/demo/home', [
                translation({language: 'en', sharedKey: 'AAA', sharedExpiry: '2027-01-01T00:00:00.000Z'}),
                translation({language: 'fr', sharedKey: 'BBB', sharedExpiry: '2027-02-01T00:00:00.000Z'})
            ])]
        }));

        expect(rows).toHaveLength(2);
        expect(rows.map(r => r.language)).toEqual(['en', 'fr']);
        expect(rows.map(r => r.expiry)).toEqual(['2027-01-01T00:00:00.000Z', '2027-02-01T00:00:00.000Z']);
    });

    it('leaves out a language that carries no key', () => {
        const rows = toRows(answer({
            shared: [node('u1', '/sites/demo/home', [
                translation({language: 'en', sharedKey: 'AAA'}),
                translation({language: 'fr'})
            ])]
        }));

        expect(rows).toHaveLength(1);
        expect(rows[0].language).toBe('en');
    });

    it('reports both kinds for the same node and language, as separate links', () => {
        const rows = toRows(answer({
            shared: [node('u1', '/sites/demo/home', [translation({language: 'en', sharedKey: 'AAA'})])],
            review: [node('u1', '/sites/demo/home', [translation({language: 'en', reviewKey: 'RRR'})])]
        }));

        expect(rows.map(r => r.kind)).toEqual([PUBLISHED, REVIEW]);
        expect(new Set(rows.map(r => r.id)).size).toBe(2);
    });

    it('merges the two workspaces into one row rather than two', () => {
        const page = [translation({language: 'en', sharedKey: 'AAA'})];
        const rows = toRows(answer({
            shared: [node('u1', '/sites/demo/home', page)],
            liveShared: [node('u1', '/sites/demo/home', page)]
        }));

        expect(rows).toHaveLength(1);
        expect(rows[0].inAuthoring).toBe(true);
        expect(rows[0].stillLive).toBe(true);
    });

    it('keeps reporting a link whose key was cleared in authoring while live still serves it', () => {
        // What revoking leaves behind. Reading authoring alone would drop the row at the one
        // moment the link is both unwanted and working.
        const rows = toRows(answer({
            liveShared: [node('u1', '/sites/demo/home', [
                translation({language: 'en', sharedKey: 'AAA', sharedExpiry: '2027-01-01T00:00:00.000Z'})
            ])]
        }));

        expect(rows).toHaveLength(1);
        expect(rows[0].inAuthoring).toBe(false);
        expect(rows[0].stillLive).toBe(true);
        expect(rows[0].path).toBe('/sites/demo/home');
        expect(rows[0].expiry).toBe('2027-01-01T00:00:00.000Z');
        expect(isPendingRevocation(rows[0])).toBe(true);
    });

    it('tells a link not yet published from one still live after a revocation', () => {
        const rows = toRows(answer({
            shared: [node('u1', '/sites/demo/alpha', [translation({language: 'en', sharedKey: 'AAA'})])],
            liveShared: [node('u2', '/sites/demo/beta', [translation({language: 'en', sharedKey: 'BBB'})])]
        }));

        const alpha = rows.find(r => r.path === '/sites/demo/alpha');
        const beta = rows.find(r => r.path === '/sites/demo/beta');
        expect(isNotYetLive(alpha)).toBe(true);
        expect(isPendingRevocation(alpha)).toBe(false);
        expect(isNotYetLive(beta)).toBe(false);
        expect(isPendingRevocation(beta)).toBe(true);
    });

    it('matches the two workspaces per language, not per node', () => {
        const rows = toRows(answer({
            shared: [node('u1', '/sites/demo/home', [
                translation({language: 'en', sharedKey: 'AAA'}),
                translation({language: 'fr', sharedKey: 'BBB'})
            ])],
            liveShared: [node('u1', '/sites/demo/home', [translation({language: 'en', sharedKey: 'AAA'})])]
        }));

        expect(rows.find(r => r.language === 'en').stillLive).toBe(true);
        expect(rows.find(r => r.language === 'fr').stillLive).toBe(false);
    });

    it('never claims a review link reached live', () => {
        const rows = toRows(answer({
            review: [node('u1', '/sites/demo/home', [translation({language: 'en', reviewKey: 'RRR'})])]
        }));

        expect(rows[0].stillLive).toBeNull();
        expect(isPendingRevocation(rows[0])).toBe(false);
        expect(isNotYetLive(rows[0])).toBe(false);
    });

    it('sorts by path, then kind, then language', () => {
        const rows = toRows(answer({
            shared: [
                node('u2', '/sites/demo/zebra', [translation({language: 'en', sharedKey: 'A'})]),
                node('u1', '/sites/demo/alpha', [
                    translation({language: 'fr', sharedKey: 'B'}),
                    translation({language: 'en', sharedKey: 'C'})
                ])
            ],
            review: [node('u1', '/sites/demo/alpha', [translation({language: 'en', reviewKey: 'D'})])]
        }));

        expect(rows.map(r => r.path + ' ' + r.kind + ' ' + r.language)).toEqual([
            '/sites/demo/alpha published en',
            '/sites/demo/alpha published fr',
            '/sites/demo/alpha review en',
            '/sites/demo/zebra published en'
        ]);
    });

    it('reports nothing, and throws nothing, when a workspace answered with no nodes', () => {
        expect(toRows({authoring: null, live: null})).toEqual([]);
        expect(toRows({authoring: {}, live: {}})).toEqual([]);
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
