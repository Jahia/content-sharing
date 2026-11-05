import React from 'react';
import {registry} from '@jahia/ui-extender';
import {Link, Share} from '@jahia/moonstone';
import {SharedURLGenerator} from './SharedURLGenerator';
import {SharedLinksPanel} from './SharedLinks/SharedLinksPanel';
import {ReviewLinkAction} from './ReviewLink/ReviewLinkAction';

import i18next from 'i18next';

export default function () {
    registry.add('callback', 'contentSharing', {
        targets: ['jahiaApp-init:20'],
        callback: async () => {
            // Before anything registers: without it every label renders as its own key.
            await i18next.loadNamespaces('content-sharing');

            registry.add('selectorType', 'SharedURLGenerator', {
                cmp: SharedURLGenerator,
                supportMultiple: false
            });

            // In the Preview menu of a page, where an editor looks at the draft they want to show,
            // and in the menus of a content item or a file in jContent's lists.
            registry.add('action', 'contentSharingReviewLink', {
                buttonIcon: <Share/>,
                buttonLabel: 'content-sharing:review.action',
                targets: ['openInPreviewMenu:10', 'contentItemActions:16', 'contentItemContextActions:16'],
                component: ReviewLinkAction
            });

            registry.add('adminRoute', 'settings/contentSharingLinks', {
                targets: ['administration-sites:60'],
                requireModuleInstalledOnSite: 'content-sharing',
                icon: <Link/>,
                label: 'content-sharing:panel.title',
                isSelectable: true,
                render: () => <SharedLinksPanel/>
            });
        }
    });
}
