import React from 'react';
import * as PropTypes from 'prop-types';
import {useTranslation} from 'react-i18next';
import {withStyles} from '@material-ui/core';
import {Button, Reload, Copy, Typography} from '@jahia/moonstone';
const styles = theme => ({
    syncButton: {
        marginTop: 'var(--spacing-medium)'
    },
    copyButton: {
        marginLeft: 'var(--spacing-small)'
    },
    fieldSetDescription: {
        overflowWrap: 'anywhere',
        marginTop: 'var(--spacing-nano)',
        color: 'var(--color-dark60)',
        backgroundColor: theme.palette.ui.epsilon,
        width: '100%',
        /* Height: theme.spacing.unit * 9, */
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        border: '1px rgba(218, 218, 218, 0.4) solid',
        // Border: '1px var(--color-gray40) solid',
        // boxShadow: '1px 5px 6px rgba(64, 77, 86, 0.1)',
        borderRadius: '2px',
        padding: '6px'
    }
});

const getRandomString = ({length, format}) => {
    let mask = '';
    if (format.indexOf('a') > -1) {
        mask += 'abcdefghijklmnopqrstuvwxyz';
    }

    if (format.indexOf('A') > -1) {
        mask += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    }

    if (format.indexOf('#') > -1) {
        mask += '0123456789';
    }

    if (format.indexOf('!') > -1) {
        mask += '~!@#$%^()_+-{};<>?,.';
    }

    let result = '';
    for (let i = length; i > 0; --i) {
        result += mask[Math.floor(Math.random() * mask.length)];
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
    url.searchParams.append('l', lang);
    // Return encodeURIComponent(url.toString());
    return url.toString();
};

const SharedURLGeneratorCMP = ({classes, field, value, onChange, editorContext}) => {
    const length = field.selectorOptions.find(option => option.name === 'length')?.value || 24;
    const format = field.selectorOptions.find(option => option.name === 'format')?.value || 'aA#!';
    const origin = field.selectorOptions.find(option => option.name === 'origin')?.value || window.location.origin;
    const {nodeTypeName, lang} = editorContext;
    const {t} = useTranslation('content-sharing');

    if (!value) {
        onChange(getRandomString({length, format}));
    }

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
                        className={classes.fieldSetDescription}
            >
                {url || t('label.url.generateKey')}
            </Typography>
            <Button className={classes.syncButton}
                    data-sel-role="syncSystemName"
                    variant="outlined"
                    size="big"
                    color="accent"
                    label={t('label.btn.generateKey')}
                    icon={<Reload/>}
                    onClick={handleNewKey}
            />
            <Button className={classes.copyButton}
                    data-sel-role="syncSystemName"
                    variant="outlined"
                    size="big"
                    color="accent"
                    label={t('label.btn.copyUrl')}
                    icon={<Copy/>}
                    onClick={handleCopy}
            />
        </>
    );
};

SharedURLGeneratorCMP.propTypes = {
    classes: PropTypes.object.isRequired,
    field: PropTypes.object,
    value: PropTypes.string,
    onChange: PropTypes.func.isRequired,
    editorContext: PropTypes.object.isRequired
};

export const SharedURLGenerator = withStyles(styles)(SharedURLGeneratorCMP);
// SharedURLGenerator.displayName = 'QnAJsonCmp';
