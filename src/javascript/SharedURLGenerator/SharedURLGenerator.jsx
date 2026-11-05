import React from 'react';
import * as PropTypes from 'prop-types';
import {useTranslation} from 'react-i18next';
import {Button, Reload, Copy, Typography} from '@jahia/moonstone';

import {defaultOrigin, shareUrl} from '../shareUrl';
import {getRandomString} from '../key';
import styles from './SharedURLGenerator.module.css';

const SharedURLGeneratorCMP = ({field, value, onChange, editorContext}) => {
    const length = field.selectorOptions.find(option => option.name === 'length')?.value || 24;
    const format = field.selectorOptions.find(option => option.name === 'format')?.value || 'aA#';
    const origin = field.selectorOptions.find(option => option.name === 'origin')?.value || defaultOrigin();
    const {nodeTypeName, lang} = editorContext;
    const {t} = useTranslation('content-sharing');

    // No key is made unless the editor asks for one. The field used to fill itself whenever it
    // opened empty, so a link revoked from the Shared links panel came back with a new key, and
    // its old expiry date, the next time anyone saved the page for any reason.
    const url = shareUrl({key: value, nodeType: nodeTypeName, language: lang, base: origin});
    const handleNewKey = () => onChange(getRandomString({length, format}));
    const handleCopy = () => navigator.clipboard.writeText(url);

    return (
        <>
            {/* The box is its own element: Moonstone's typography class outranks its padding. */}
            <div className={styles.urlBox}>
                <Typography component="span">{url || t('label.url.generateKey')}</Typography>
            </div>
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
                    isDisabled={!url}
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
