/**
 * Where share links point when the form names no `origin`: this Jahia, under its context path.
 * Read when called, so a test or a server-side import never touches `window`.
 */
export const defaultOrigin = () => {
    const location = globalThis.location;
    const contextPath = (globalThis.contextJsParameters && globalThis.contextJsParameters.contextPath) || '';
    return location ? location.origin + contextPath : '';
};

/**
 * The address a visitor opens: the endpoint, the key, the node type and the language.
 *
 * Built in one place for the editor field and the Shared links panel, so both show the same
 * address. `base` is an origin with an optional path (a context path, a proxy prefix), kept as it
 * is: `new URL('/modules/share', base)` would drop that path and point every link at the wrong
 * place on a Jahia that is not served from the root.
 */
export const shareUrl = ({key, nodeType, language, base}) => {
    if (!key || !base) {
        return undefined;
    }

    const url = new URL(base.replace(/\/+$/, '') + '/modules/share');
    url.searchParams.append('c', key);
    url.searchParams.append('t', nodeType);
    // 'lang', not 'l': Jahia's URL resolution reads 'l' as a version label.
    url.searchParams.append('lang', language);
    return url.toString();
};
