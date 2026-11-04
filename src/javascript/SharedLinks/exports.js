import {state} from './rows';

const COLUMNS = ['path', 'displayName', 'nodeType', 'kind', 'language', 'expiry', 'state'];

/** The reported shape of a row, which the CSV and the JSON share. */
const reported = row => ({...row, state: state(row)});

/**
 * Prefixes a cell a spreadsheet would otherwise run as a formula.
 *
 * Paths, node names and titles are written by editors, so a cell can start with any character; a
 * leading `=`, `+`, `-`, `@`, tab or carriage return makes Excel and Sheets execute it when the
 * file is opened.
 */
export const defuse = cell => (/^[=+\-@\t\r]/.test(cell) ? '\'' + cell : cell);

/** Every cell quoted, inner quotes doubled: a path may contain a comma or a quote. */
const quote = cell => '"' + defuse(String(cell)).replace(/"/g, '""') + '"';

/**
 * One row per link. UTF-8 with a byte order mark and CRLF line endings, which is what Excel reads
 * correctly without being told anything.
 */
export const toCsv = rows => {
    const lines = [COLUMNS.map(quote).join(',')];
    rows.forEach(row => {
        const cells = reported(row);
        lines.push(COLUMNS.map(column => quote(cells[column] === null || cells[column] === undefined ? '' : cells[column])).join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
};

/** The report as it stands, with the moment it was produced. */
export const toJson = (rows, siteKey) => JSON.stringify({
    site: siteKey,
    producedAt: new Date().toISOString(),
    count: rows.length,
    links: rows.map(row => {
        const cells = reported(row);
        const copy = {};
        COLUMNS.forEach(column => {
            copy[column] = cells[column];
        });
        return copy;
    })
}, null, 2);

export const fileName = (siteKey, language, extension) =>
    'content-sharing-links-' + siteKey + '-' + language + '-' +
    new Date().toISOString().slice(0, 10) + '.' + extension;

/** Hands the file to the browser; nothing leaves the page. */
export const download = (content, name, mime) => {
    const url = URL.createObjectURL(new Blob([content], {type: mime}));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
