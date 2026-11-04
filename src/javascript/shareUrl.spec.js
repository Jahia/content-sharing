import {afterEach, describe, expect, it} from 'vitest';
import {defaultOrigin, shareUrl} from './shareUrl';

const link = {key: 'AbC123', nodeType: 'jnt:page', language: 'en'};

describe('shareUrl', () => {
    it('builds the address the endpoint reads', () => {
        expect(shareUrl({...link, base: 'https://example.org'}))
            .toBe('https://example.org/modules/share?c=AbC123&t=jnt%3Apage&lang=en');
    });

    it('keeps the path of the base, which a context path needs', () => {
        expect(shareUrl({...link, base: 'https://example.org/jahia'}))
            .toBe('https://example.org/jahia/modules/share?c=AbC123&t=jnt%3Apage&lang=en');
    });

    it('does not double a slash the base ends with', () => {
        expect(shareUrl({...link, base: 'https://example.org/jahia/'}))
            .toBe('https://example.org/jahia/modules/share?c=AbC123&t=jnt%3Apage&lang=en');
    });

    it('never writes the reserved parameter l', () => {
        expect(new URL(shareUrl({...link, base: 'https://example.org'})).searchParams.has('l')).toBe(false);
    });

    it('gives no address without a key, rather than a broken one', () => {
        expect(shareUrl({...link, key: null, base: 'https://example.org'})).toBeUndefined();
    });
});

describe('defaultOrigin', () => {
    afterEach(() => {
        delete globalThis.contextJsParameters;
        delete globalThis.location;
    });

    it('is this Jahia under the context path it runs under', () => {
        globalThis.location = {origin: 'https://example.org'};
        globalThis.contextJsParameters = {contextPath: '/jahia'};
        expect(defaultOrigin()).toBe('https://example.org/jahia');
    });

    it('is the bare origin at the web root', () => {
        globalThis.location = {origin: 'https://example.org'};
        globalThis.contextJsParameters = {contextPath: ''};
        expect(defaultOrigin()).toBe('https://example.org');
    });
});
