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
export const getRandomString = ({length, format}) => {
    const mask = buildMask(format);
    const limit = Math.floor(256 / mask.length) * mask.length;
    let result = '';

    while (result.length < length) {
        const bytes = new Uint8Array(length - result.length);
        globalThis.crypto.getRandomValues(bytes);
        for (const byte of bytes) {
            if (byte < limit) {
                result += mask[byte % mask.length];
            }
        }
    }

    return result;
};

/** A key with the selector's defaults: 24 characters of letters and digits. */
export const newKey = () => getRandomString({length: 24, format: 'aA#'});
