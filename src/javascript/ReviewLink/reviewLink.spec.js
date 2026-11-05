import {describe, expect, it} from 'vitest';

import {expiryAfter, languageName, mayShare, readLink, writePlan} from './reviewLink';

const NOW = new Date('2026-11-05T10:00:00.000Z');

const node = ({isPage = true, hasMixin = false, link} = {}) => ({
    uuid: 'owner-uuid',
    path: '/sites/s/home/about',
    isPage,
    hasMixin,
    container: {
        nodes: link === undefined ? [] : [{
            path: '/sites/s/home/about/cshareReviewLinks',
            link: {nodes: link ? [link] : []}
        }]
    }
});

const link = (owner, expiry) => ({
    path: '/sites/s/home/about/cshareReviewLinks/en',
    key: {value: 'abcdefghij0123456789ABCD'},
    expiry: expiry ? {value: expiry} : null,
    owner: {value: owner}
});

describe('expiryAfter', () => {
    it('counts whole days from now', () => {
        expect(expiryAfter(7, NOW)).toBe('2026-11-12T10:00:00.000Z');
    });
});

describe('readLink', () => {
    it('reads the link of the node', () => {
        expect(readLink(node({link: link('owner-uuid', '2026-11-12T10:00:00.000Z')}), NOW)).toEqual({
            path: '/sites/s/home/about/cshareReviewLinks/en',
            key: 'abcdefghij0123456789ABCD',
            expiry: '2026-11-12T10:00:00.000Z',
            expired: false
        });
    });

    it('says when the link has expired', () => {
        expect(readLink(node({link: link('owner-uuid', '2026-11-01T10:00:00.000Z')}), NOW).expired).toBe(true);
    });

    it('ignores a link that came with a copy of another node', () => {
        expect(readLink(node({link: link('another-uuid', '2026-11-12T10:00:00.000Z')}), NOW)).toBeNull();
    });

    it('is null with no container or no link in that language', () => {
        expect(readLink(node(), NOW)).toBeNull();
        expect(readLink(node({link: null}), NOW)).toBeNull();
    });
});

describe('writePlan', () => {
    it('adds only the container under a page', () => {
        expect(writePlan(node())).toEqual({
            addMixin: false,
            addContainer: true,
            containerPath: '/sites/s/home/about/cshareReviewLinks',
            linkPath: null
        });
    });

    it('adds the mixin first on a content item or a file', () => {
        expect(writePlan(node({isPage: false})).addMixin).toBe(true);
        expect(writePlan(node({isPage: false, hasMixin: true})).addMixin).toBe(false);
    });

    it('writes over a link left by a copy instead of deleting anything', () => {
        const plan = writePlan(node({link: link('another-uuid', '2026-11-12T10:00:00.000Z')}));
        expect(plan.addContainer).toBe(false);
        expect(plan.linkPath).toBe('/sites/s/home/about/cshareReviewLinks/en');
    });
});

describe('mayShare', () => {
    const access = overrides => ({
        shareable: true,
        isPage: true,
        hasMixin: false,
        canAddChildren: true,
        canManageTypes: false,
        site: {installed: {values: ['default', 'content-sharing']}},
        ...overrides
    });

    it('shows on a page of a site that enabled the module, to someone who can add children', () => {
        expect(mayShare(access())).toBe(true);
    });

    it('hides on a site without the module, on other types, and without the rights', () => {
        expect(mayShare(access({site: {installed: {values: ['default']}}}))).toBe(false);
        expect(mayShare(access({shareable: false}))).toBe(false);
        expect(mayShare(access({canAddChildren: false}))).toBe(false);
        expect(mayShare(null)).toBe(false);
    });

    it('needs node type management on a content item that has no link yet', () => {
        expect(mayShare(access({isPage: false}))).toBe(false);
        expect(mayShare(access({isPage: false, canManageTypes: true}))).toBe(true);
        expect(mayShare(access({isPage: false, hasMixin: true}))).toBe(true);
    });
});

describe('languageName', () => {
    it('names the language in the interface language', () => {
        expect(languageName('fr', 'en')).toBe('French');
        expect(languageName('en', 'fr')).toBe('anglais');
        expect(languageName('pt_BR', 'en')).toBe('Brazilian Portuguese');
    });

    it('falls back to the code', () => {
        expect(languageName('not a code', 'en')).toBe('not a code');
    });
});
