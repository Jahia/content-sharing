import {describe, expect, it} from 'vitest';
import {defuse, fileName, toCsv, toJson} from './exports';

const row = overrides => ({
    path: '/sites/demo/home',
    displayName: 'Home',
    nodeType: 'jnt:page',
    kind: 'published',
    language: 'en',
    expiry: '2027-01-31T23:00:00.000Z',
    inAuthoring: true,
    stillLive: true,
    ...overrides
});

describe('defuse', () => {
    it('leaves an ordinary cell alone', () => {
        expect(defuse('/sites/demo/home')).toBe('/sites/demo/home');
        expect(defuse('Home')).toBe('Home');
    });

    it('prefixes every character a spreadsheet would run as a formula', () => {
        ['=', '+', '-', '@', '\t', '\r'].forEach(start => {
            expect(defuse(start + 'HYPERLINK("http://x")')).toBe('\'' + start + 'HYPERLINK("http://x")');
        });
    });

    it('prefixes a node name an editor chose', () => {
        // A page may legitimately be named "-draft": the quote is what keeps it text.
        expect(defuse('-draft')).toBe('\'-draft');
    });
});

describe('toCsv', () => {
    it('opens with a byte order mark and ends every line with CRLF', () => {
        const csv = toCsv([row()]);
        expect(csv.charCodeAt(0)).toBe(0xFEFF);
        expect(csv.split('\r\n')).toHaveLength(3);
        expect(csv.endsWith('\r\n')).toBe(true);
    });

    it('quotes every cell and doubles an inner quote', () => {
        const csv = toCsv([row({displayName: 'The "big" one'})]);
        expect(csv).toContain('"The ""big"" one"');
        expect(csv.split('\r\n')[1].split('","')).toHaveLength(7);
    });

    it('keeps a comma inside its cell', () => {
        const csv = toCsv([row({displayName: 'Home, sweet home'})]);
        expect(csv).toContain('"Home, sweet home"');
    });

    it('defuses a cell before quoting it', () => {
        const csv = toCsv([row({displayName: '=cmd|\' /c calc\'!A0'})]);
        expect(csv).toContain('"\'=cmd');
        expect(csv).not.toContain('"=cmd');
    });

    it('writes an empty cell for a missing value', () => {
        const csv = toCsv([row({expiry: null})]);
        const cells = csv.split('\r\n')[1].slice(1, -1).split('","');
        expect(cells[5]).toBe('');
    });

    it('reports the same state word the table shows', () => {
        expect(toCsv([row()])).toContain('"live"');
        expect(toCsv([row({inAuthoring: false})])).toContain('"pendingRevocation"');
        expect(toCsv([row({stillLive: false})])).toContain('"notYetLive"');
        expect(toCsv([row({kind: 'review', stillLive: null})])).toContain('"authoring"');
    });

    it('writes the header alone when there is nothing to report', () => {
        expect(toCsv([]).split('\r\n')).toHaveLength(2);
    });
});

describe('toJson', () => {
    it('reports the site, the count and the moment it was produced', () => {
        const report = JSON.parse(toJson([row()], 'demo'));
        expect(report.site).toBe('demo');
        expect(report.count).toBe(1);
        expect(Number.isNaN(Date.parse(report.producedAt))).toBe(false);
    });

    it('carries the reported columns and nothing the query added', () => {
        const report = JSON.parse(toJson([row({__typename: 'GenericJCRNode', uuid: 'abc'})], 'demo'));
        expect(Object.keys(report.links[0])).toEqual(
            ['path', 'displayName', 'nodeType', 'kind', 'language', 'expiry', 'state']
        );
    });
});

describe('fileName', () => {
    it('names the feature, the site, the language and the day', () => {
        expect(fileName('demo', 'en', 'csv')).toMatch(/^content-sharing-links-demo-en-\d{4}-\d{2}-\d{2}\.csv$/);
    });
});
