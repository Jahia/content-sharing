import React from 'react';
import * as PropTypes from 'prop-types';
import {useTranslation} from 'react-i18next';
import styles from './SharedURLGenerator.css';

import {IconButton, Input/* , Toggle */} from '@jahia/design-system-kit';

import {Grid/* , FormControlLabel, withStyles */} from '@material-ui/core';
import {Button, Reload, Typography} from '@jahia/moonstone';
// Const styles = () => ({
//     switchLabel: {
//         '& >span:last-child': {
//             color: 'black'
//             // FontSize: '1rem'
//         }
//     },
//     container: {
//         padding: '.5rem',
//         boxShadow: '0px 2px 10px -5px #000000, 2px 5px 15px 5px rgba(0,0,0,0);'
//     },
//     toggle: {
//         margin: 0
//     }
// });

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
        mask += '~`!@#$%^&*()_+-={}[]:";\'<>?,./|\\';
    }

    let result = '';
    for (let i = length; i > 0; --i) {
        result += mask[Math.floor(Math.random() * mask.length)];
    }

    return result;
};

const getURL = ({key, nodeTypeName, lang}) => {
    if (!key) {
        return;
    }

    const url = new URL('/modules/share', window.location.origin);
    url.searchParams.append('c', key);
    url.searchParams.append('t', nodeTypeName);
    url.searchParams.append('l', lang);
    return encodeURIComponent(url.toString());
};

export const SharedURLGenerator = ({field, value, onChange, editorContext}) => {
    const length = field.selectorOptions.find(option => option.name === 'length') || 24;
    const format = field.selectorOptions.find(option => option.name === 'length') || 'aA#!';
    const {nodeTypeName, lang} = editorContext;
    const {t} = useTranslation('content-sharing');

    if (!value) {
        const newValue = getRandomString({length, format});
        onChange(newValue);
    }

    const url = getURL({
        key: value,
        nodeTypeName,
        lang
    });
    const handleNewKey = () => onChange(getRandomString({length, format}));

    return (
        <div className="flexRow_nowrap">
            <Typography component="label"
                        className={styles.fieldSetDescription}
                        variant="caption"
                        weight="bold"
            >
                {url || t('label.url.generateKey')}
            </Typography>
            <Button className={styles.syncButton}
                    data-sel-role="syncSystemName"
                    variant="outlined"
                    size="big"
                    color="accent"
                    label={t('label.btn.generateKey')}
                    icon={<Reload/>}
                    onClick={handleNewKey}
            />
        </div>
    );
};

SharedURLGenerator.propTypes = {
    field: PropTypes.object,
    value: PropTypes.string,
    onChange: PropTypes.func.isRequired,
    editorContext: PropTypes.object.isRequired
};

// Export const QnAJson = withStyles(styles)(SharedURLGenerator);
// SharedURLGenerator.displayName = 'QnAJsonCmp';
