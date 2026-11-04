import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const LOCALES = path.join(here, '..', 'main', 'resources', 'javascript', 'locales');
const SHIPPED = ['en', 'fr', 'de', 'es'];

const read = language => JSON.parse(fs.readFileSync(path.join(LOCALES, language + '.json'), 'utf8'));

const flatten = (object, prefix = '') => Object.entries(object).reduce((keys, [name, value]) => {
    const key = prefix ? prefix + '.' + name : name;
    return keys.concat(
        value && typeof value === 'object' && !Array.isArray(value) ? flatten(value, key) : [key]
    );
}, []);

/**
 * Every bundle key the front-end asks for, however it spells the call: `t('content-sharing:key')`,
 * `t(MODULE + ':key')` or the panel's own `label(t, 'key')` helper. The last assertion of this
 * file guards the list against a fourth spelling making the check vacuous.
 */
const asked = () => {
    const found = new Set();
    const walk = directory => {
        fs.readdirSync(directory, {withFileTypes: true}).forEach(entry => {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (/\.jsx?$/.test(entry.name) && !/\.spec\.jsx?$/.test(entry.name)) {
                const source = fs.readFileSync(full, 'utf8');
                const pattern = new RegExp(
                    '[\'"`]content-sharing:([\\w.]+)[\'"`]' +
                    '|MODULE \\+ [\'"`]:([\\w.]+)[\'"`]' +
                    '|label\\(t, [\'"`]([\\w.]+)[\'"`]',
                    'g'
                );
                let match = pattern.exec(source);
                while (match) {
                    found.add(match[1] || match[2] || match[3]);
                    match = pattern.exec(source);
                }
            }
        });
    };

    walk(here);
    return [...found].sort();
};

describe('the shipped locales', () => {
    const english = flatten(read('en')).sort();

    it('ships the four languages the module declares', () => {
        SHIPPED.forEach(language => {
            expect(fs.existsSync(path.join(LOCALES, language + '.json'))).toBe(true);
        });
    });

    SHIPPED.filter(language => language !== 'en').forEach(language => {
        it('carries in ' + language + ' every key English carries', () => {
            // A key missing from one file renders as its own key for anyone using that language.
            expect(flatten(read(language)).sort()).toEqual(english);
        });
    });

    const at = (bundle, key) => key.split('.').reduce((node, name) => node[name], bundle);

    SHIPPED.forEach(language => {
        it('has no empty label in ' + language, () => {
            const bundle = read(language);
            flatten(bundle).forEach(key => {
                const value = at(bundle, key);
                expect(typeof value, language + ':' + key).toBe('string');
                expect(value.trim(), language + ':' + key).not.toBe('');
            });
        });
    });

    it('answers every key the front-end asks for', () => {
        // A key built at render time (`panel.kind.` + the kind) is checked as a prefix: the
        // bundle must carry at least one label under it.
        const missing = asked().filter(key => (key.endsWith('.') ?
            !english.some(candidate => candidate.startsWith(key)) :
            !english.includes(key)));
        expect(missing).toEqual([]);
    });

    it('was read from files that actually hold the panel labels', () => {
        // Guards the test itself: a wrong path would make every assertion above vacuous.
        expect(english).toContain('panel.title');
        expect(asked().length).toBeGreaterThan(10);
    });
});
