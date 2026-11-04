import React, {useEffect} from 'react';
import * as PropTypes from 'prop-types';
import {useTranslation} from 'react-i18next';
import {Button, Reload, Copy, Typography} from '@jahia/moonstone';

import styles from './SharedURLGenerator.module.css';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';

// Only characters that survive a URL query string unchanged are eligible; the legacy '!' class
// emitted '#', '?' and '%', which the servlet no longer accepts. The 24-character default over
// the 62-symbol alphabet is about 143 bits.
const SAFE_PUNCTUATION = '-._~';

const buildMask = format => {
    let mask = '';
    if (format.includes('a')) {
        mask += LOWER;
    }

    if (format.includes('A')) {
        mask += UPPER;
    }

    if (format.includes('#')) {
        mask += DIGITS;
    }

    if (format.includes('!')) {
        mask += SAFE_PUNCTUATION;
    }

    return mask || LOWER + UPPER + DIGITS;
};

/**
 * Draws `length` characters from `mask` using the platform CSPRNG.
 *
 * Rejection sampling, not modulo: `crypto.getRandomValues` yields bytes, and folding 256 values
 * onto a mask whose size does not divide 256 would make the first `256 % mask.length` symbols
 * more likely than the rest. Values at or above the largest whole multiple are drawn again.
 */
const getRandomString = ({length, format}) => {
    const mask = buildMask(format);
    const limit = Math.floor(256 / mask.length) * mask.length;
    let result = '';

    while (result.length < length) {
        const bytes = new Uint8Array(length - result.length);
        window.crypto.getRandomValues(bytes);
        for (const byte of bytes) {
            if (byte < limit) {
                result += mask[byte % mask.length];
            }
        }
    }

    return result;
};

const getURL = ({key, nodeTypeName, lang, origin}) => {
    if (!key) {
        return;
    }

    const url = new URL('/modules/share', origin);
    url.searchParams.append('c', key);
    url.searchParams.append('t', nodeTypeName);
    // 'lang', not 'l': Jahia's URL resolution reads 'l' as a version label.
    url.searchParams.append('lang', lang);
    return url.toString();
};

const SharedURLGeneratorCMP = ({field, value, onChange, editorContext}) => {
    const length = field.selectorOptions.find(option => option.name === 'length')?.value || 24;
    const format = field.selectorOptions.find(option => option.name === 'format')?.value || 'aA#';
    const origin = field.selectorOptions.find(option => option.name === 'origin')?.value || window.location.origin;
    const {nodeTypeName, lang} = editorContext;
    const {t} = useTranslation('content-sharing');

    // Seeding the field is a state mutation, so it belongs in an effect. From the render body it
    // fired on every re-render and, under StrictMode, twice per mount.
    useEffect(() => {
        if (!value) {
            onChange(getRandomString({length, format}));
        }
    }, [value, length, format, onChange]);

    const url = getURL({
        key: value,
        origin,
        nodeTypeName,
        lang
    });
    const handleNewKey = () => onChange(getRandomString({length, format}));
    const handleCopy = () => navigator.clipboard.writeText(url);

    return (
        <>
            <Typography component="div"
                        className={styles.urlBox}
            >
                {url || t('label.url.generateKey')}
            </Typography>
            <Button className={styles.generateButton}
                    data-sel-role="generateSharedUrl"
                    variant="outlined"
                    size="big"
                    color="accent"
                    label={t('label.btn.generateKey')}
                    icon={<Reload/>}
                    onClick={handleNewKey}
            />
            <Button className={styles.copyButton}
                    data-sel-role="copySharedUrl"
                    variant="outlined"
                    size="big"
                    color="accent"
                    label={t('label.btn.copyUrl')}
                    disabled={!url}
                    icon={<Copy/>}
                    onClick={handleCopy}
            />
        </>
    );
};

SharedURLGeneratorCMP.propTypes = {
    field: PropTypes.object,
    value: PropTypes.string,
    onChange: PropTypes.func.isRequired,
    editorContext: PropTypes.object.isRequired
};

export const SharedURLGenerator = SharedURLGeneratorCMP;
SharedURLGenerator.displayName = 'SharedURLGenerator';
