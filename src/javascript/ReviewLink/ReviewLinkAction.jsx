import React, {useContext} from 'react';
import PropTypes from 'prop-types';
import {useSelector} from 'react-redux';
import {useQuery} from '@apollo/client';
import {ComponentRendererContext} from '@jahia/ui-extender';

import {REVIEW_LINK_ACCESS} from './queries';
import {mayShare} from './reviewLink';
import {ReviewLinkDialog} from './ReviewLinkDialog';

const DIALOG = 'contentSharingReviewLink';

/**
 * "Share for external review" in the Preview menu of a page and the menus of a content item or a
 * file. Opens the dialog through jContent's component renderer, so it outlives the menu that
 * opened it and keeps jContent's Apollo client, store and translations.
 */
export const ReviewLinkAction = ({path, render: Render, loading: Loading, ...others}) => {
    const componentRenderer = useContext(ComponentRendererContext);
    const language = useSelector(state => state.language);
    const access = useQuery(REVIEW_LINK_ACCESS, {variables: {path}, skip: !path});

    if (access.loading) {
        return (Loading && <Loading {...others}/>) || false;
    }

    if (access.error || !mayShare(access.data && access.data.jcr && access.data.jcr.nodeByPath)) {
        return false;
    }

    return (
        <Render
            {...others}
            onClick={() => componentRenderer.render(DIALOG, ReviewLinkDialog, {
                path,
                language,
                onClose: () => componentRenderer.destroy(DIALOG)
            })}
        />
    );
};

ReviewLinkAction.propTypes = {
    path: PropTypes.string,
    render: PropTypes.func.isRequired,
    loading: PropTypes.func
};
