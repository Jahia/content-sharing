import {beforeEach, describe, expect, it, vi} from 'vitest';

// The action's hooks, replaced so the component can be called as a plain function
const query = {current: {loading: false}};
vi.mock('react', async () => {
    const actual = await vi.importActual('react');
    return {...actual, default: actual, useContext: () => ({render: vi.fn(), destroy: vi.fn()})};
});
vi.mock('react-redux', () => ({useSelector: () => 'en'}));
vi.mock('@apollo/client', () => ({useQuery: () => query.current, gql: () => ({})}));
vi.mock('@jahia/ui-extender', () => ({ComponentRendererContext: {}}));
vi.mock('./ReviewLinkDialog', () => ({ReviewLinkDialog: () => null}));

const {ReviewLinkAction} = await import('./ReviewLinkAction');

const Render = () => null;
const Loading = () => null;
const run = () => ReviewLinkAction({path: '/sites/s/contents/folder', render: Render, loading: Loading, id: 'x'});

const shareable = {
    shareable: true,
    canAddChildren: true,
    isPage: true,
    site: {installed: {values: ['content-sharing']}}
};

// jContent's menus show their items once none is loading: an action that rendered Loading must
// render Render afterwards, hidden or not. Returning null or false left the menu on placeholders.
describe('ReviewLinkAction in a jContent menu', () => {
    beforeEach(() => {
        query.current = {loading: false};
    });

    it('renders Loading while the access query runs', () => {
        query.current = {loading: true};
        expect(run().type).toBe(Loading);
    });

    it('hides itself through Render on a node that cannot be shared, such as a content folder', () => {
        query.current = {loading: false, data: {jcr: {nodeByPath: {...shareable, shareable: false}}}};
        const element = run();
        expect(element).toBeTruthy();
        expect(element.type).toBe(Render);
        expect(element.props.isVisible).toBe(false);
    });

    it('hides itself through Render when the query fails', () => {
        query.current = {loading: false, error: new Error('boom')};
        const element = run();
        expect(element.type).toBe(Render);
        expect(element.props.isVisible).toBe(false);
    });

    it('shows itself on a node that can be shared', () => {
        query.current = {loading: false, data: {jcr: {nodeByPath: shareable}}};
        const element = run();
        expect(element.type).toBe(Render);
        expect(element.props.isVisible).toBe(true);
    });
});
