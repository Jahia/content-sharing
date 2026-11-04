import React from 'react';
import {registry} from '@jahia/ui-extender';
import {Link} from '@jahia/moonstone';
import {SharedURLGenerator} from './SharedURLGenerator';
import {SharedLinksPanel} from './SharedLinks/SharedLinksPanel';

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
