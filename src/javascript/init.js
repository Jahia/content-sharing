import {registry} from '@jahia/ui-extender';
import {SharedURLGenerator} from './SharedURLGenerator';

import i18next from 'i18next';

i18next.loadNamespaces('content-sharing');

export default function () {
    registry.add('callback', 'SharedURLGeneratorEditor', {
        targets: ['jahiaApp-init:20'],
        callback: () => {
            registry.add('selectorType', 'SharedURLGenerator', {cmp: SharedURLGenerator, supportMultiple: false});
            console.debug('%c SharedURLGenerator Editor Extensions  is activated', 'color: #3c8cba');
        }
    });
}
