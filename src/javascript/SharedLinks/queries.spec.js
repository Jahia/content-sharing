import {parse} from 'graphql';
import {describe, expect, it} from 'vitest';
import {linksDocumentText} from './queries';
import {aliasFor} from './rows';

const text = languages => linksDocumentText(languages);

describe('the links document', () => {
    it('is valid GraphQL for the languages a site can have', () => {
        [['en'], ['en', 'fr'], ['en', 'fr', 'de', 'es'], ['pt-BR', 'zh_CN']].forEach(languages => {
            expect(() => parse(text(languages)), languages.join(',')).not.toThrow();
        });
    });

    it('is still valid GraphQL when the site has no language', () => {
        // The panel skips the query in that case, but an unparseable document would throw on build.
        expect(() => parse(text([]))).not.toThrow();
    });

    it('asks for each key in each language, under the alias the rows are read by', () => {
        const document = text(['en', 'pt-BR']);
        ['sharedKey', 'sharedExpiry', 'reviewKey', 'reviewExpiry'].forEach(field => {
            expect(document).toContain(aliasFor('en') + '__' + field + ': property(');
            expect(document).toContain(aliasFor('pt-BR') + '__' + field + ': property(');
        });
        expect(document).toContain('language: "pt-BR"');
    });

    it('names an explicit language on every i18n property it reads', () => {
        // Without it the server answers null: the value lives on the translation node, and the
        // session the query runs in carries no locale.
        const reads = text(['en', 'fr']).match(/property\(name: "cshare:[^)]*\)/g) || [];
        // 4 keys x 2 languages x the 3 criteria blocks the document carries.
        expect(reads.length).toBe(24);
        reads.forEach(read => expect(read).toMatch(/language: "(en|fr)"/));
    });

    it('never reads the translation children, which come back empty', () => {
        expect(text(['en'])).not.toContain('jnt:translation');
    });

    it('leaves out anything that is not a language code', () => {
        const document = text(['en', 'fr") { value } evil: property(name: "x']);
        expect(() => parse(document)).not.toThrow();
        expect(document).not.toContain('evil');
        expect(document).toContain('language: "en"');
    });

    it('reads both kinds from authoring and the published kind from live', () => {
        const document = text(['en']);
        expect(document).toContain('jcr(workspace: EDIT)');
        expect(document).toContain('jcr(workspace: LIVE)');
        expect((document.match(/cshmix:sharedUrl/g) || []).length).toBe(2);
        expect((document.match(/cshmix:reviewUrl/g) || []).length).toBe(1);
    });
});
