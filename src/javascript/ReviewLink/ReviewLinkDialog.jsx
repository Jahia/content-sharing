import React, {useEffect, useRef, useState} from 'react';
import PropTypes from 'prop-types';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';
import {useMutation, useQuery} from '@apollo/client';
import {
    Button, Chip, Copy, Delete, Dropdown, Loader, Modal, ModalBody, ModalFooter, ModalHeader, OpenInNew,
    Typography
} from '@jahia/moonstone';

import {ADD_CONTAINER, ADD_LINK, ADD_MIXIN, DELETE_LINK, REVIEW_LINK, UPDATE_LINK} from './queries';
import {DEFAULT_DAYS, DURATIONS, expiryAfter, languageName, readLink, writePlan} from './reviewLink';
import {newKey} from '../key';
import {defaultOrigin, shareUrl} from '../shareUrl';
import styles from './ReviewLinkDialog.module.css';

const MODULE = 'content-sharing';

/**
 * The review link of one node in one language: create it, copy it, open it as a reviewer would,
 * move its expiry date, revoke it.
 *
 * The link is stored under the node in a child that is never published, so none of this changes
 * the node's publication status, and the key never reaches live.
 */
export const ReviewLinkDialog = ({path, language, onClose}) => {
    const {t} = useTranslation(MODULE);
    const uiLanguage = useSelector(state => state.uilang);
    const label = (key, options) => t(MODULE + ':' + key, options);

    const [days, setDays] = useState(String(DEFAULT_DAYS));
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const [copied, setCopied] = useState(false);
    const [confirmRevoke, setConfirmRevoke] = useState(false);
    const durationRef = useRef(null);

    const result = useQuery(REVIEW_LINK, {variables: {path, language}, fetchPolicy: 'network-only'});
    const [addMixin] = useMutation(ADD_MIXIN);
    const [addContainer] = useMutation(ADD_CONTAINER);
    const [addLink] = useMutation(ADD_LINK);
    const [updateLink] = useMutation(UPDATE_LINK);
    const [deleteLink] = useMutation(DELETE_LINK);

    const node = result.data && result.data.jcr && result.data.jcr.nodeByPath;
    const link = node ? readLink(node) : null;
    const url = link && shareUrl({
        key: link.key,
        nodeType: node.primaryNodeType.name,
        language,
        base: defaultOrigin()
    });

    // "Copied" reads on the button for a moment, then the button offers to copy again.
    useEffect(() => {
        if (!copied) {
            return undefined;
        }

        const timer = setTimeout(() => setCopied(false), 2000);
        return () => clearTimeout(timer);
    }, [copied]);

    // Moonstone's Dropdown takes no label: its list box is named here, after the text beside it.
    useEffect(() => {
        const box = durationRef.current && durationRef.current.querySelector('[role="listbox"], [aria-haspopup]');
        if (box) {
            box.setAttribute('aria-label', label('review.validFor'));
        }
    });

    const run = async write => {
        setBusy(true);
        setFailed(false);
        try {
            await write();
            await result.refetch();
        } catch (e) {
            console.error('content-sharing: the review link could not be saved', e);
            setFailed(true);
        } finally {
            setBusy(false);
            setConfirmRevoke(false);
        }
    };

    // Creates the link, moves its expiry date, or makes a link a copy brought along this node's own
    // with a key of its own. Nothing is deleted on the way.
    const onSave = () => run(async () => {
        const plan = writePlan(node);
        const expiry = expiryAfter(Number(days));
        if (plan.addMixin) {
            await addMixin({variables: {path: node.path}});
        }

        if (plan.addContainer) {
            await addContainer({variables: {path: node.path}});
        }

        if (!plan.linkPath) {
            await addLink({variables: {path: plan.containerPath, language, key: newKey(), expiry, owner: node.uuid}});
            return;
        }

        const properties = [{name: 'cshare:expiry', value: expiry, type: 'DATE'}];
        if (!link) {
            properties.push({name: 'cshare:key', value: newKey()}, {name: 'cshare:owner', value: node.uuid});
        }

        await updateLink({variables: {path: plan.linkPath, properties}});
    });

    const onRevoke = () => {
        if (!confirmRevoke) {
            setConfirmRevoke(true);
            return;
        }

        run(() => deleteLink({variables: {path: link.path}}));
    };

    const onCopy = () => navigator.clipboard.writeText(url).then(() => setCopied(true));

    const durations = DURATIONS.map(count => ({label: label('review.duration.' + count), value: String(count)}));
    const selected = durations.find(option => option.value === days);
    const date = link && link.expiry && new Date(link.expiry).toLocaleDateString(undefined, {dateStyle: 'long'});

    const body = () => {
        if (result.loading && !node) {
            return <Loader size="big"/>;
        }

        if (!node) {
            return <Typography isNowrap={false}>{label('review.error')}</Typography>;
        }

        return (
            <div className={styles.body}>
                <Typography isNowrap={false}>
                    {label('review.intro', {name: node.displayName, interpolation: {escapeValue: false}})}
                </Typography>
                {/* A box of its own: Moonstone's typography class outranks a padding given to it. */}
                <div className={styles.warning}>
                    <Typography variant="caption" isNowrap={false}>
                        {label(node.isPage ? 'review.everythingPage' : 'review.everything')}
                    </Typography>
                </div>
                <Typography variant="caption">
                    {label('review.language', {language: languageName(language, uiLanguage)})}
                </Typography>
                {link && (
                    <>
                        <div className={styles.state}>
                            <Chip
                                label={label(link.expired ? 'review.expired' : 'review.active')}
                                color={link.expired ? 'danger' : 'success'}
                            />
                            <Typography variant="caption" isNowrap={false}>
                                {label(link.expired ? 'review.expiredOn' : 'review.worksUntil', {date})}
                            </Typography>
                        </div>
                        <div className={styles.urlBox}>
                            <Typography variant="caption" isNowrap={false} className={styles.url} data-cs-role="review-url">
                                {url}
                            </Typography>
                            <Button
                                size="default"
                                variant="outlined"
                                icon={<Copy/>}
                                label={label(copied ? 'review.copied' : 'review.copy')}
                                onClick={onCopy}
                            />
                        </div>
                    </>
                )}
                <div ref={durationRef} className={styles.expiry}>
                    <Typography variant="caption">{label(link ? 'review.newExpiry' : 'review.validFor')}</Typography>
                    <Dropdown
                        data={durations}
                        value={days}
                        label={selected && selected.label}
                        isDisabled={busy}
                        onChange={(event, item) => setDays(item.value)}
                    />
                    {link && (
                        <Button
                            size="default"
                            variant="outlined"
                            label={label('review.setExpiry')}
                            isDisabled={busy}
                            onClick={onSave}
                        />
                    )}
                </div>
                {failed && (
                    <Typography isNowrap={false} className={styles.error} role="alert">
                        {label('review.failed')}
                    </Typography>
                )}
            </div>
        );
    };

    return (
        <Modal isOpen size="large" data-cs-role="review-link-dialog" onOpenChange={open => !open && onClose()}>
            <div>
                <ModalHeader title={label('review.title')}/>
                <ModalBody>{body()}</ModalBody>
                <ModalFooter>
                    {link ? (
                        <>
                            <Button
                                size="big"
                                variant="outlined"
                                color="danger"
                                icon={<Delete/>}
                                label={label(confirmRevoke ? 'review.confirmRevoke' : 'review.revoke')}
                                isDisabled={busy}
                                onClick={onRevoke}
                            />
                            <Button
                                size="big"
                                variant="outlined"
                                icon={<OpenInNew/>}
                                label={label('review.open')}
                                isDisabled={link.expired}
                                onClick={() => globalThis.open(url, '_blank', 'noopener,noreferrer')}
                            />
                            <Button size="big" color="accent" label={label('review.close')} onClick={onClose}/>
                        </>
                    ) : (
                        <>
                            <Button size="big" label={label('review.cancel')} onClick={onClose}/>
                            <Button
                                size="big"
                                color="accent"
                                label={label('review.create')}
                                isDisabled={busy || !node}
                                data-cs-role="create-review-link"
                                onClick={onSave}
                            />
                        </>
                    )}
                </ModalFooter>
            </div>
        </Modal>
    );
};

ReviewLinkDialog.propTypes = {
    path: PropTypes.string.isRequired,
    language: PropTypes.string.isRequired,
    onClose: PropTypes.func.isRequired
};
