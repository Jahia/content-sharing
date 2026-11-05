import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';
import {useMutation, useQuery} from '@apollo/client';
import {
    Button, Chip, Copy, DataTable, Delete, Download, Header, LayoutContent, Loader, Pagination,
    Paper, Publish, Reload, Typography
} from '@jahia/moonstone';

import {DELETE_LINK, linksQuery, PUBLISH, REMOVE_MIXIN, REVOKE, SITE_CONTEXT} from './queries';
import {
    COPY, isExpired, isInert, LIVE, NOT_YET_LIVE, PENDING_REVOCATION, revocationPlan, state, toRows
} from './rows';
import {download, fileName, toCsv, toJson} from './exports';
import {defaultOrigin, shareUrl} from '../shareUrl';
import styles from './sharedLinks.module.css';

const MODULE = 'content-sharing';
const PER_PAGE = [10, 25, 50, 100];

const label = (t, key, options) => t(MODULE + ':' + key, options);

/*
 * Chips and buttons never wrap, so the columns holding them are as wide as their longest label in
 * the four shipped languages, measured on Moonstone 2.20 plus the cell's 32 px of padding. Labels
 * are kept short for it: a date or an explanation goes under its chip, where it can wrap. The
 * content column, whose text wraps, takes what is left; under the table's minimum width the table
 * scrolls rather than cutting a label.
 */
const KIND_WIDTH = 160;
const LANGUAGE_WIDTH = 96;
const EXPIRY_WIDTH = 136;
const STATE_WIDTH = 192;
const ACTION_WIDTH = 160;
const CONTENT_WIDTH = `calc(100% - ${KIND_WIDTH + LANGUAGE_WIDTH + EXPIRY_WIDTH + STATE_WIDTH + ACTION_WIDTH}px)`;

/** A path that wraps after a slash, never inside a node name. */
const BreakablePath = ({path}) => path.split('/').map((part, index) => (
    // eslint-disable-next-line react/no-array-index-key -- segments repeat; their order is the key
    <React.Fragment key={index}>{index > 0 && <>/<wbr/></>}{part}</React.Fragment>
));

/** A row's sub-row: the address its link opens, shown when the row is expanded. */
const LINK_SUFFIX = '\u0000link';

/** When the link stops working, and whether it ever will. */
const ExpiryCell = ({row, t}) => {
    if (isInert(row)) {
        return (
            <span className={styles.stack}>
                <Chip label={label(t, 'panel.noExpiry')} color="warning"/>
                <Typography variant="caption" isNowrap={false}>{label(t, 'panel.noExpiryHint')}</Typography>
            </span>
        );
    }

    if (!row.expiry) {
        return <Typography variant="caption">{label(t, 'panel.never')}</Typography>;
    }

    const on = new Date(row.expiry).toLocaleDateString();
    return isExpired(row) ? (
        <span className={styles.stack}>
            <Chip label={label(t, 'panel.expired')} color="danger"/>
            <Typography variant="caption">{on}</Typography>
        </span>
    ) : <Typography variant="caption">{on}</Typography>;
};

/**
 * Which workspace serves the link. The one that matters is `pendingRevocation`: the key is gone
 * from authoring, so nothing in jContent shows it any more, and live still serves it.
 */
const StateCell = ({row, t}) => {
    const where = state(row);

    if (where === PENDING_REVOCATION) {
        return <Chip label={label(t, 'panel.state.pendingRevocation')} color="danger"/>;
    }

    if (where === COPY) {
        return <Chip label={label(t, 'panel.state.copy')} color="warning"/>;
    }

    if (where === LIVE) {
        return <Chip label={label(t, 'panel.state.live')} color="warning"/>;
    }

    return (
        <Typography variant="caption">
            {label(t, where === NOT_YET_LIVE ? 'panel.state.notYetLive' : 'panel.state.authoring')}
        </Typography>
    );
};

export const SharedLinksPanel = () => {
    const {t} = useTranslation(MODULE);
    const siteKey = useSelector(reduxState => reduxState.site);
    const language = useSelector(reduxState => reduxState.language) || 'en';
    const sitePath = '/sites/' + siteKey;

    const [busy, setBusy] = useState(null);
    const [copied, setCopied] = useState(null);
    const [expanded, setExpanded] = useState([]);
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(PER_PAGE[1]);

    // `no-cache` throughout: the same node comes back under `authoring` (EDIT) and `live` (LIVE)
    // with one uuid, so a normalized cache keyed on it would let one workspace overwrite the
    // other. A report also has no business reading a value the server did not just send.
    const onSite = useQuery(SITE_CONTEXT, {variables: {sitePath}, fetchPolicy: 'no-cache'});

    const siteNode = onSite.data && onSite.data.jcr && onSite.data.jcr.nodeByPath;
    const languages = useMemo(() => {
        const declared = (siteNode && siteNode.site && siteNode.site.languages) || [];
        return declared.map(entry => entry.language).filter(Boolean);
    }, [siteNode]);

    // The languages decide the shape of the document, so it is built once per set of them.
    const languageKey = languages.join(',');
    const document = useMemo(() => linksQuery(languageKey ? languageKey.split(',') : []), [languageKey]);

    const links = useQuery(document, {
        variables: {sitePath, displayLanguage: language},
        fetchPolicy: 'no-cache',
        skip: languages.length === 0
    });
    const [revoke] = useMutation(REVOKE);
    const [removeMixin] = useMutation(REMOVE_MIXIN);
    const [deleteLink] = useMutation(DELETE_LINK);
    const [publish] = useMutation(PUBLISH);

    // Each row carries the address its link opens, built as the editor field builds it.
    const rows = useMemo(() => {
        const base = defaultOrigin();
        return (links.data ? toRows(links.data, languages) : []).map(row => ({
            ...row,
            // A link a copy brought along opens nothing: no address to hand out.
            url: row.isCopy ? undefined : shareUrl({key: row.key, nodeType: row.nodeType, language: row.language, base})
        }));
    }, [links.data, languages]);

    // "Copied" reads on the button for a moment, then the button offers to copy again.
    useEffect(() => {
        if (!copied) {
            return undefined;
        }

        const timer = setTimeout(() => setCopied(null), 2000);
        return () => clearTimeout(timer);
    }, [copied]);

    // Moonstone opens a row on a click only: the row takes focus but ignores Enter and Space, and
    // says nothing of its state. Without this the link stays out of reach from the keyboard.
    const rowProps = useCallback(({id, data, meta}) => {
        if (!data.subRows || data.subRows.length === 0) {
            return {};
        }

        return {
            'aria-expanded': meta.isExpanded,
            onKeyDown: event => {
                if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) {
                    return;
                }

                event.preventDefault();
                setExpanded(open => (open.includes(id) ? open.filter(other => other !== id) : [...open, id]));
            }
        };
    }, []);

    const onCopy = useCallback(row => {
        navigator.clipboard.writeText(row.url).then(() => setCopied(row.rowId));
    }, []);

    // Revoking shortens the list; without this the panel can sit on a page that no longer exists.
    useEffect(() => {
        const pages = Math.max(1, Math.ceil(rows.length / perPage));
        if (page > pages) {
            setPage(pages);
        }
    }, [rows.length, perPage, page]);

    // Each row carries its address as a sub-row, which the table shows when the row is expanded.
    const shown = useMemo(
        () => rows.slice((page - 1) * perPage, page * perPage).map(row => ({
            ...row,
            subRows: row.url ? [{id: row.id + LINK_SUFFIX, isLink: true, url: row.url, rowId: row.id}] : []
        })),
        [rows, page, perPage]
    );

    const act = useCallback(async (row, run) => {
        setBusy(row.id);
        try {
            await run();
            await links.refetch();
        } finally {
            setBusy(null);
        }
    }, [links]);

    // A review link node is deleted. Otherwise the key, its expiry date, and the mixin once the
    // node has no other link of that kind.
    const onRevoke = useCallback(row => act(row, async () => {
        const plan = revocationPlan(row, rows);
        if (plan.deleteLink) {
            await deleteLink({variables: {path: plan.deleteLink}});
            return;
        }

        const pathOrId = row.uuid;
        await revoke({variables: {pathOrId, property: plan.property, language: row.language}});
        if (plan.expiryProperty) {
            await revoke({variables: {pathOrId, property: plan.expiryProperty, language: row.language}});
        }

        if (plan.mixin) {
            await removeMixin({variables: {pathOrId, mixin: plan.mixin}});
        }
    }), [act, revoke, removeMixin, deleteLink, rows]);

    const onPublish = useCallback(row => act(row, () => publish({
        variables: {pathOrId: row.uuid, languages: [row.language]}
    })), [act, publish]);

    // The route option only hides the menu entry: a direct URL, or switching site while the panel
    // is open, renders it on a site that never switched the module on.
    const installed = siteNode && siteNode.installed;
    const enabled = Boolean(installed && installed.values && installed.values.indexOf(MODULE) !== -1);

    // A link sub-row fills the content cell only; CSS spreads that cell over the whole row.
    const parentOnly = render => props => (props.data.isLink ? null : render(props));

    const columns = useMemo(() => [
        {
            key: 'displayName',
            label: label(t, 'panel.column.content'),
            width: CONTENT_WIDTH,
            render: ({data}) => (data.isLink ? (
                <span className={styles.linkLine}>
                    <Typography variant="caption" isNowrap={false} className={styles.link}>
                        {data.url}
                    </Typography>
                    <Button
                        size="small"
                        variant="ghost"
                        icon={<Copy/>}
                        label={label(t, copied === data.rowId ? 'panel.copied' : 'panel.copyLink')}
                        onClick={() => onCopy(data)}
                    />
                </span>
            ) : (
                <span className={styles.pathCell}>
                    <Typography isNowrap={false}>{data.displayName}</Typography>
                    <Typography variant="caption" isNowrap={false} className={styles.path}>
                        <BreakablePath path={data.path}/>
                    </Typography>
                </span>
            ))
        },
        {
            key: 'kind',
            label: label(t, 'panel.column.kind'),
            width: KIND_WIDTH + 'px',
            render: parentOnly(({data}) => <Chip label={label(t, 'panel.kind.' + data.kind)} color="default"/>)
        },
        {
            key: 'language',
            label: label(t, 'panel.column.language'),
            width: LANGUAGE_WIDTH + 'px',
            render: parentOnly(({data}) => <Typography variant="caption">{data.language}</Typography>)
        },
        {
            key: 'expiry',
            label: label(t, 'panel.column.expiry'),
            width: EXPIRY_WIDTH + 'px',
            render: parentOnly(({data}) => <ExpiryCell row={data} t={t}/>)
        },
        {
            key: 'state',
            label: label(t, 'panel.column.state'),
            width: STATE_WIDTH + 'px',
            render: parentOnly(({data}) => <StateCell row={data} t={t}/>)
        },
        {
            key: 'id',
            label: label(t, 'panel.column.action'),
            width: ACTION_WIDTH + 'px',
            render: parentOnly(({data}) => (state(data) === PENDING_REVOCATION ?
                <Button
                    size="default"
                    color="danger"
                    icon={<Publish/>}
                    label={label(t, 'panel.publishRevocation')}
                    isDisabled={busy !== null}
                    onClick={() => onPublish(data)}
                /> :
                <Button
                    size="default"
                    color="danger"
                    icon={<Delete/>}
                    label={label(t, 'panel.revoke')}
                    isDisabled={busy !== null}
                    onClick={() => onRevoke(data)}
                />))
        }
    ], [t, busy, copied, onCopy, onPublish, onRevoke]);

    const content = () => {
        if (onSite.loading || (links.loading && !links.data)) {
            return <Loader size="big"/>;
        }

        if (!enabled) {
            return <Typography isNowrap={false}>{label(t, 'panel.notOnSite')}</Typography>;
        }

        if (links.error) {
            return <Typography isNowrap={false}>{label(t, 'panel.error')}</Typography>;
        }

        if (rows.length === 0) {
            return <Typography isNowrap={false}>{label(t, 'panel.none')}</Typography>;
        }

        return (
            <>
                <div className={styles.tableBox}>
                    <DataTable
                        // Each row expands to its link. Controlled, so every row starts closed
                        // (Moonstone 2.20 opens them all) and stays as the editor left it when a
                        // revocation reloads the list.
                        isStructured
                        primaryKey="id"
                        data={shown}
                        columns={columns}
                        // The host's DataTable paginates by itself, 5 rows at a time, whatever the
                        // installed typings say. Its pagination also returns to page 1 every time
                        // the data changes, which revoking does, so the panel keeps its own.
                        enablePagination={false}
                        expandedRows={expanded}
                        rowProps={rowProps}
                        data-cs-role="links-table"
                        onExpandChange={setExpanded}
                    />
                </div>
                <div className={styles.paginationBox}>
                    <Pagination
                        currentPage={page}
                        itemsPerPage={perPage}
                        itemsPerPageOptions={PER_PAGE}
                        totalOfItems={rows.length}
                        i18n={{
                            itemsPerPage: label(t, 'panel.pagination.itemsPerPage'),
                            of: label(t, 'panel.pagination.of')
                        }}
                        onPageChange={setPage}
                        onItemsPerPageChange={setPerPage}
                    />
                </div>
            </>
        );
    };

    return (
        <div className={styles.root}>
            <LayoutContent
                hasPadding
                data-cs-role="shared-links-panel"
                header={
                    <Header
                        title={label(t, 'panel.title')}
                        mainActions={[
                            <Button
                                key="reload"
                                size="big"
                                variant="ghost"
                                icon={<Reload/>}
                                label={label(t, 'panel.reload')}
                                isDisabled={links.loading}
                                onClick={() => links.refetch()}
                            />,
                            <Button
                                key="csv"
                                size="big"
                                variant="outlined"
                                icon={<Download/>}
                                label={label(t, 'panel.exportCsv')}
                                isDisabled={rows.length === 0}
                                onClick={() => download(
                                    toCsv(rows),
                                    fileName(siteKey, language, 'csv'),
                                    'text/csv;charset=utf-8'
                                )}
                            />,
                            <Button
                                key="json"
                                size="big"
                                variant="outlined"
                                icon={<Download/>}
                                label={label(t, 'panel.exportJson')}
                                isDisabled={rows.length === 0}
                                onClick={() => download(
                                    toJson(rows, siteKey),
                                    fileName(siteKey, language, 'json'),
                                    'application/json'
                                )}
                            />
                        ]}
                    />
                }
            >
                <Paper hasPadding className={styles.card}>
                    <span className={styles.intro}>
                        <Typography isNowrap={false}>{label(t, 'panel.intro')}</Typography>
                        <Typography variant="caption" isNowrap={false}>
                            {label(t, 'panel.introLive')}
                        </Typography>
                    </span>
                    {content()}
                </Paper>
            </LayoutContent>
        </div>
    );
};

SharedLinksPanel.displayName = 'SharedLinksPanel';
