import React from 'react';
import {IntlProvider} from 'react-intl';
import {renderToStaticMarkup} from 'react-dom/server';
import {shallow} from 'enzyme';
import CloudVariableBadge from '../../../src/components/tw-cloud-variable-badge/cloud-variable-badge';

const markup = cloudHost => renderToStaticMarkup(
    <IntlProvider locale="en">
        <CloudVariableBadge cloudHost={cloudHost} />
    </IntlProvider>
);

test('default cloud service identifies TurboWarp and links its privacy information', () => {
    const html = markup('wss://clouddata.turbowarp.org');
    expect(html).toContain('Server provided by');
    expect(html).toContain('href="https://turbowarp.org/privacy.html"');
    expect(html).toContain('>TurboWarp</a>');
    expect(html).toContain('href="https://docs.turbowarp.org/cloud-variables"');
    expect(html).not.toContain('Using a custom cloud variable server');
});

test('a custom server is not attributed to TurboWarp', () => {
    const html = markup('wss://cloud.example.test');
    expect(html).toContain('Using a custom cloud variable server');
    expect(html).toContain('wss://cloud.example.test');
    expect(html).not.toContain('Server provided by');
    expect(html).not.toContain('href="https://turbowarp.org/privacy.html"');
});

test('provider attribution reuses the existing translated message', () => {
    const wrapper = shallow(<CloudVariableBadge cloudHost="wss://clouddata.turbowarp.org" />);
    const message = wrapper.findWhere(node => node.prop('id') === 'tw.cloudProvider');
    expect(message).toHaveLength(1);
    expect(message.prop('values').name.props.children).toBe('TurboWarp');
});
