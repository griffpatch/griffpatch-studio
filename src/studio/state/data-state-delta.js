import {canonicalJson} from '../validation/canonical-json';
import {cloneJson} from '../lib/clone-json';

const sameValue = (left, right) => canonicalJson(left) === canonicalJson(right);

const targetKey = reference => (reference.isStage ? 'stage' : `sprite:${reference.name}`);

const targetMap = state => new Map(state.targets.map(target => [targetKey(target.targetRef), target]));

const assertSameKeys = (beforeKeys, afterKeys, label) => {
    beforeKeys = [...beforeKeys].sort();
    afterKeys = [...afterKeys].sort();
    if (!sameValue(beforeKeys, afterKeys)) {
        throw new Error(
            `Cannot diff authored data with changed ${label} definitions ` +
            `(before ${JSON.stringify(beforeKeys)}, after ${JSON.stringify(afterKeys)})`
        );
    }
};

const createListSplice = (before, after) => {
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && sameValue(before[prefix], after[prefix])) {
        prefix++;
    }

    let suffix = 0;
    const remainingBefore = before.length - prefix;
    const remainingAfter = after.length - prefix;
    while (suffix < remainingBefore && suffix < remainingAfter &&
        sameValue(before[before.length - 1 - suffix], after[after.length - 1 - suffix])) {
        suffix++;
    }

    return {
        index: prefix,
        removed: cloneJson(before.slice(prefix, before.length - suffix)),
        inserted: cloneJson(after.slice(prefix, after.length - suffix))
    };
};

/**
 * Describe one direct list-monitor edit without capturing unrelated project
 * data or copying the unchanged list tail.
 *
 * @param {object} targetRef durable target reference
 * @param {string} listId Scratch variable ID
 * @param {Array} before value before the editor gesture
 * @param {Array} after value after the editor gesture
 * @returns {object} durable data delta
 */
const createListValueDelta = (targetRef, listId, before, after) => {
    if (sameValue(before, after)) return null;
    return {
        schemaVersion: 1,
        targets: [{
            targetRef: cloneJson(targetRef),
            variables: {},
            lists: {
                [listId]: createListSplice(before, after)
            },
            properties: {}
        }]
    };
};

/**
 * Describe one direct scalar-monitor gesture without capturing unrelated
 * runtime data.
 *
 * @param {object} targetRef durable target reference
 * @param {string} variableId Scratch variable ID
 * @param {*} before value before the editor gesture
 * @param {*} after value after the editor gesture
 * @returns {?object} durable data delta
 */
const createVariableValueDelta = (targetRef, variableId, before, after) => {
    if (sameValue(before, after)) return null;
    return {
        schemaVersion: 1,
        targets: [{
            targetRef: cloneJson(targetRef),
            variables: {
                [variableId]: {
                    before: cloneJson(before),
                    after: cloneJson(after)
                }
            },
            lists: {},
            properties: {}
        }]
    };
};

const createTargetPropertyDelta = (targetRef, before, after) => {
    const properties = Object.keys(before).reduce((changes, property) => {
        if (!sameValue(before[property], after[property])) {
            changes[property] = {
                before: cloneJson(before[property]),
                after: cloneJson(after[property])
            };
        }
        return changes;
    }, {});
    return Object.keys(properties).length ? {
        schemaVersion: 1,
        targets: [{
            targetRef: cloneJson(targetRef),
            variables: {},
            lists: {},
            properties
        }]
    } : null;
};

/**
 * Combine related target-property mutations into one authored transaction.
 * Layer changes are inherently project-wide: bringing one sprite forward
 * shifts the layer indices of its peers too.
 *
 * @param {Array<object>} edits targetRef/before/after property snapshots
 * @returns {?object} durable multi-target data delta
 */
const createTargetPropertiesDelta = edits => {
    const targets = edits.reduce((changedTargets, edit) => {
        const delta = createTargetPropertyDelta(edit.targetRef, edit.before, edit.after);
        if (delta) changedTargets.push(...delta.targets);
        return changedTargets;
    }, []);
    return targets.length ? {schemaVersion: 1, targets} : null;
};

/**
 * Compare authored scalar/list state at two visible history boundaries.
 * Lists use one minimal prefix/suffix splice so middle insertions and deletions
 * do not copy the unchanged tail.
 *
 * @param {object} before authored state before the dirty interval
 * @param {object} after authored state after the dirty interval
 * @returns {?object} durable data delta, or null when data did not change
 */
const createDataStateDelta = (before, after) => {
    const beforeTargets = targetMap(before);
    const afterTargets = targetMap(after);
    assertSameKeys(beforeTargets.keys(), afterTargets.keys(), 'target');

    const targets = [];
    beforeTargets.forEach((beforeTarget, key) => {
        const afterTarget = afterTargets.get(key);
        assertSameKeys(Object.keys(beforeTarget.variables), Object.keys(afterTarget.variables), 'variable');
        assertSameKeys(Object.keys(beforeTarget.lists), Object.keys(afterTarget.lists), 'list');
        assertSameKeys(Object.keys(beforeTarget.properties), Object.keys(afterTarget.properties), 'property');

        const variables = Object.keys(beforeTarget.variables).reduce((changes, id) => {
            if (!sameValue(beforeTarget.variables[id], afterTarget.variables[id])) {
                changes[id] = {
                    before: cloneJson(beforeTarget.variables[id]),
                    after: cloneJson(afterTarget.variables[id])
                };
            }
            return changes;
        }, {});
        const lists = Object.keys(beforeTarget.lists).reduce((changes, id) => {
            if (!sameValue(beforeTarget.lists[id], afterTarget.lists[id])) {
                changes[id] = createListSplice(beforeTarget.lists[id], afterTarget.lists[id]);
            }
            return changes;
        }, {});
        const properties = Object.keys(beforeTarget.properties).reduce((changes, property) => {
            if (!sameValue(beforeTarget.properties[property], afterTarget.properties[property])) {
                changes[property] = {
                    before: cloneJson(beforeTarget.properties[property]),
                    after: cloneJson(afterTarget.properties[property])
                };
            }
            return changes;
        }, {});
        if (Object.keys(variables).length || Object.keys(lists).length || Object.keys(properties).length) {
            targets.push({
                targetRef: cloneJson(beforeTarget.targetRef),
                variables,
                lists,
                properties
            });
        }
    });

    return targets.length ? {schemaVersion: 1, targets} : null;
};

const directionalSplice = (splice, direction) => (direction === 'forward' ? {
    index: splice.index,
    expected: splice.removed,
    replacement: splice.inserted
} : {
    index: splice.index,
    expected: splice.inserted,
    replacement: splice.removed
});

const applyListSplice = (list, splice, direction) => {
    const {index, expected, replacement} = directionalSplice(splice, direction);
    const actual = list.slice(index, index + expected.length);
    if (!sameValue(actual, expected)) {
        throw new Error(`Cannot apply authored list splice at index ${index}`);
    }
    list.splice(index, expected.length, ...cloneJson(replacement));
};

/**
 * Apply a durable data delta to an authored state snapshot.
 *
 * @param {object} state authored state snapshot
 * @param {object} delta data delta
 * @param {'forward'|'backward'} direction replay direction
 * @returns {object} new authored state snapshot
 */
const applyDataStateDelta = (state, delta, direction) => {
    if (direction !== 'forward' && direction !== 'backward') {
        throw new Error(`Unknown data delta direction: ${direction}`);
    }
    if (delta.schemaVersion !== 1) {
        throw new Error(`Unsupported Studio data delta schema: ${delta.schemaVersion}`);
    }
    const next = cloneJson(state);
    const targets = targetMap(next);
    delta.targets.forEach(targetDelta => {
        const target = targets.get(targetKey(targetDelta.targetRef));
        if (!target) throw new Error(`Cannot apply data for target ${targetDelta.targetRef.name}`);
        Object.keys(targetDelta.variables || {}).forEach(id => {
            if (!Object.prototype.hasOwnProperty.call(target.variables, id)) {
                throw new Error(`Cannot apply authored variable ${id}`);
            }
            const change = targetDelta.variables[id];
            target.variables[id] = cloneJson(direction === 'forward' ? change.after : change.before);
        });
        Object.keys(targetDelta.lists || {}).forEach(id => {
            if (!Object.prototype.hasOwnProperty.call(target.lists, id)) {
                throw new Error(`Cannot apply authored list ${id}`);
            }
            applyListSplice(target.lists[id], targetDelta.lists[id], direction);
        });
        Object.keys(targetDelta.properties || {}).forEach(property => {
            if (!Object.prototype.hasOwnProperty.call(target.properties, property)) {
                throw new Error(`Cannot apply authored target property ${property}`);
            }
            const change = targetDelta.properties[property];
            target.properties[property] = cloneJson(direction === 'forward' ? change.after : change.before);
        });
    });
    return next;
};

export {
    applyDataStateDelta,
    createDataStateDelta,
    createListValueDelta,
    createTargetPropertyDelta,
    createTargetPropertiesDelta,
    createVariableValueDelta,
    directionalSplice
};
