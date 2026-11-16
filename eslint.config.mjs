import globals from 'globals';
import react from 'eslint-plugin-react';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';

const a11y = jsxA11y.flatConfigs.recommended.rules;

// The rules the SonarQube gate of the pull requests fails on, checked before the push. The gate
// accepts no new issue, so every rule here is an error. This is not a style guide: a rule is added
// when the gate reports it (its Sonar key is beside it), never for taste.
export default [
    {
        ignores: [
            'src/main/resources/javascript/**',
            '.yarn/**',
            'target/**',
            'node/**',
            'node_modules/**'
        ]
    },
    {
        files: ['src/javascript/**/*.{js,jsx}', '*.{js,mjs}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: {ecmaFeatures: {jsx: true}},
            globals: {...globals.browser, ...globals.node}
        },
        // Comments may name rules of sets this config does not load
        linterOptions: {reportUnusedDisableDirectives: 'off'},
        settings: {react: {version: 'detect'}},
        plugins: {react, 'jsx-a11y': jsxA11y, sonarjs, unicorn},
        rules: {
            'sonarjs/cognitive-complexity': ['error', 15], // S3776
            'sonarjs/no-nested-conditional': 'error', // S3358
            'sonarjs/no-nested-template-literals': 'error', // S4624
            'sonarjs/slow-regex': 'error', // S5852
            // The gate's S5852 on a pattern slow-regex let through (`[\W_]+$`, content-governance #64)
            'sonarjs/super-linear-regex': 'error',
            'sonarjs/duplicates-in-character-class': 'error', // S5869
            'sonarjs/anchor-precedence': 'error', // S5850
            'unicorn/prefer-string-replace-all': 'error', // S7781
            'unicorn/prefer-code-point': 'error', // S7758
            'unicorn/prefer-string-raw': 'error', // S7780
            'unicorn/prefer-at': 'error', // S7755
            'unicorn/prefer-export-from': 'error', // S7763
            'unicorn/prefer-single-call': 'error', // S7778
            'unicorn/prefer-set-has': 'error', // S7776
            'unicorn/prefer-global-this': 'error', // S7764
            'react/prop-types': 'error', // S6774
            'react/no-array-index-key': 'error', // S6479
            'jsx-a11y/prefer-tag-over-role': 'error', // S6819
            // The two below with the options of jsx-a11y's recommended set (a tabpanel takes focus, an
            // iframe or an image has onLoad): the gate raised nothing on the preview iframe's onLoad
            // when its lines changed (content-governance #49)
            'jsx-a11y/no-noninteractive-tabindex': a11y['jsx-a11y/no-noninteractive-tabindex'], // S6845
            'jsx-a11y/no-noninteractive-element-interactions': a11y['jsx-a11y/no-noninteractive-element-interactions'] // S6847
        }
    }
];
