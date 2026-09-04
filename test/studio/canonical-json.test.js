import {createProjectStatePort} from '../../src/studio/bridge/project-state-port';
import {canonicalJson} from '../../src/studio/validation/canonical-json';

test('canonical JSON sorts object keys while preserving array order', () => {
    expect(canonicalJson({z: 1, a: {y: 2, x: 3}, list: [3, 2, 1]})).toBe(
        '{"a":{"x":3,"y":2},"list":[3,2,1],"z":1}'
    );
});

test('project hashes are stable across object insertion order', async () => {
    let project = {targets: [], z: 1, a: 2};
    const vm = {toJSON: () => JSON.stringify(project)};
    const digest = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const port = createProjectStatePort({vm, digest});
    const first = await port.hash();

    project = {a: 2, z: 1, targets: []};
    expect(await port.hash()).toBe(first);
});
