import {cloneJson} from '../lib/clone-json';
import {canonicalJson} from './canonical-json';

const TARGET_AUTHORED_PROPERTIES = [
    'currentCostume',
    'volume',
    'layerOrder',
    'tempo',
    'videoTransparency',
    'videoState',
    'textToSpeechLanguage',
    'visible',
    'x',
    'y',
    'size',
    'direction',
    'draggable',
    'rotationStyle'
];

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const variableDefinition = value => {
    const definition = {name: value[0]};
    if (value[2]) definition.isCloud = true;
    return definition;
};

const normalizedAssetReference = source => {
    const asset = {...source};
    // Scratch VM may omit this redundant value for a freshly added library
    // asset, then reconstruct it while loading the exact same project. The
    // authored identity is already retained by assetId + dataFormat.
    delete asset.md5ext;
    return asset;
};

const procedureArgumentIds = source => {
    if (!source || !source.mutation || typeof source.mutation.argumentids !== 'string') return null;
    try {
        const ids = JSON.parse(source.mutation.argumentids);
        return Array.isArray(ids) && ids.every(id => typeof id === 'string') ? ids : null;
    } catch (error) {
        return null;
    }
};

const normalizedProcedureInputName = (source, name, normalizeProcedureArgumentIds) => {
    if (!normalizeProcedureArgumentIds) return name;
    const argumentIds = procedureArgumentIds(source);
    const argumentIndex = argumentIds ? argumentIds.indexOf(name) : -1;
    return argumentIndex < 0 ? name : `procedure-argument-${argumentIndex + 1}`;
};

const isSemanticallyEmptyInput = input => Array.isArray(input) && input.length === 2 &&
    (input[0] === 1 || input[0] === 2) && input[1] === null;

const normalizedFieldValues = fields => Object.keys(fields || {}).reduce((result, name) => {
    const value = fields[name];
    // Scratch's Backpack round trip may omit the optional field ID when it is
    // null. Retain every authored value and every non-null identity.
    result[name] = Array.isArray(value) && value.length === 2 && value[1] === null ?
        [value[0]] : value;
    return result;
}, {});

const normalizedInputTuple = (input, normalizeInertInputShadows) => (
    normalizeInertInputShadows && Array.isArray(input) && input.length === 3 &&
    input[0] === 3 && input[2] === null ? [2, input[1]] : input
);

const orderedBlockInputs = (
    source,
    normalizeProcedureArgumentIds,
    normalizeEmptyInputs = false
) => Object.keys(source.inputs || {})
    .filter(name => !normalizeEmptyInputs || !isSemanticallyEmptyInput(source.inputs[name]))
    .map(name => ({
        name,
        normalizedName: normalizedProcedureInputName(source, name, normalizeProcedureArgumentIds)
    }))
    .sort((left, right) => left.normalizedName.localeCompare(right.normalizedName) ||
        left.name.localeCompare(right.name));

const mutationWithoutTransientBlockIds = (source, normalizeProcedureArgumentIds = true) => {
    if (!source || typeof source !== 'object') return source;
    const mutation = {...source};
    if (normalizeProcedureArgumentIds && typeof mutation.argumentids === 'string') {
        try {
            const ids = JSON.parse(mutation.argumentids);
            if (Array.isArray(ids)) mutation.argumentids = JSON.stringify(ids.map((unused, index) => index));
        } catch (error) { // eslint-disable-line no-empty
            // Preserve malformed authored mutation data so validation still rejects a change.
        }
    }
    return mutation;
};

const referencedInputBlockIds = (input, blocks, normalizeTupleInputReferences) => {
    if (Array.isArray(input)) {
        if (!normalizeTupleInputReferences) return [];
        // Scratch project JSON stores inputs as [kind, block] or
        // [kind, block, shadow]. Inline primitive shadows are arrays rather
        // than block IDs, so only strings which resolve in this target are
        // graph references. Visit an obscured shadow before its live block to
        // retain the canonical ordering used by Blockly's object form.
        const references = input.slice(1)
            .filter(value => typeof value === 'string' && blocks[value]);
        return input[0] === 3 && references.length > 1 ? references.reverse() : references;
    }
    if (!input || typeof input !== 'object') return [];
    return [input.shadow, input.block].filter(id => id && blocks[id]);
};

const fingerprintInput = (
    input,
    blocks,
    fingerprint,
    normalizeTupleInputReferences,
    normalizeInertInputShadows
) => {
    input = normalizedInputTuple(input, normalizeInertInputShadows);
    if (Array.isArray(input)) {
        if (!normalizeTupleInputReferences) return {block: null, shadow: null};
        return input.map((value, index) => (
            index > 0 && typeof value === 'string' && blocks[value] ?
                {block: fingerprint(value)} : value
        ));
    }
    if (!input || typeof input !== 'object') return input;
    return {
        block: fingerprint(input.block),
        shadow: fingerprint(input.shadow)
    };
};

const normalizeInputReferences = (
    input,
    blocks,
    alias,
    normalizeTupleInputReferences,
    normalizeInertInputShadows
) => {
    input = normalizedInputTuple(input, normalizeInertInputShadows);
    if (Array.isArray(input)) {
        if (!normalizeTupleInputReferences) return {...input, block: null, shadow: null};
        return input.map((value, index) => (
            index > 0 && typeof value === 'string' && blocks[value] ? alias(value) : value
        ));
    }
    if (!input || typeof input !== 'object') return input;
    return {
        ...input,
        block: alias(input.block),
        shadow: alias(input.shadow)
    };
};

const blockShapeFingerprints = (
    blocks,
    normalizeTupleInputReferences,
    normalizeProcedureArgumentIds,
    normalizeEmptyInputs,
    normalizeNullFieldIds,
    normalizeInertInputShadows
) => {
    const memo = new Map();
    const visiting = new Set();
    const fingerprint = id => {
        if (!id || !blocks[id]) return null;
        if (memo.has(id)) return memo.get(id);
        if (visiting.has(id)) return '[cycle]';
        visiting.add(id);
        const source = blocks[id];
        const scalar = {...source};
        delete scalar.next;
        delete scalar.parent;
        delete scalar.inputs;
        delete scalar.x;
        delete scalar.y;
        if (normalizeNullFieldIds) scalar.fields = normalizedFieldValues(scalar.fields);
        if (scalar.mutation) {
            scalar.mutation = mutationWithoutTransientBlockIds(
                scalar.mutation,
                normalizeProcedureArgumentIds
            );
        }
        const inputs = orderedBlockInputs(source, normalizeProcedureArgumentIds, normalizeEmptyInputs)
            .reduce((result, {name, normalizedName}) => {
                result[normalizedName] = fingerprintInput(
                    source.inputs[name],
                    blocks,
                    fingerprint,
                    normalizeTupleInputReferences,
                    normalizeInertInputShadows
                );
                return result;
            }, {});
        const value = canonicalJson({scalar, inputs, next: fingerprint(source.next)});
        visiting.delete(id);
        memo.set(id, value);
        return value;
    };
    return fingerprint;
};

const numericCoordinate = value => (Number.isFinite(value) ? value : Number.POSITIVE_INFINITY);

/**
 * Scratch Blocks may allocate different block IDs when the same native
 * flyout gesture is replayed after a checkpoint restore. Project validation
 * cares about the authored graph, not those transient identity strings.
 * Canonical IDs follow visual root order and then the ordered input/next graph.
 *
 * @param {object} sourceTarget serialized VM target
 * @returns {object} target with canonical block keys and references
 */
const normalizedBlockReferences = (
    sourceTarget,
    {
        normalizeTupleInputReferences = true,
        normalizeProcedureArgumentIds = true,
        normalizeEmptyInputs = false,
        normalizeNullFieldIds = false,
        normalizeBlockCoordinates = false,
        normalizeInertInputShadows = false
    } = {}
) => {
    const blocks = sourceTarget.blocks || {};
    const fingerprint = blockShapeFingerprints(
        blocks,
        normalizeTupleInputReferences,
        normalizeProcedureArgumentIds,
        normalizeEmptyInputs,
        normalizeNullFieldIds,
        normalizeInertInputShadows
    );
    const compareIds = (leftId, rightId) => {
        const left = blocks[leftId];
        const right = blocks[rightId];
        const coordinate = value => numericCoordinate(
            normalizeBlockCoordinates && Number.isFinite(value) ? Math.round(value) : value
        );
        return coordinate(left.y) - coordinate(right.y) ||
            coordinate(left.x) - coordinate(right.x) ||
            fingerprint(leftId).localeCompare(fingerprint(rightId)) ||
            leftId.localeCompare(rightId);
    };
    const roots = Object.keys(blocks)
        .filter(id => {
            const block = blocks[id];
            return block.topLevel || !block.parent || !blocks[block.parent];
        })
        .sort(compareIds);
    const aliases = new Map();
    const assign = id => {
        if (!id || !blocks[id] || aliases.has(id)) return;
        aliases.set(id, `block-${aliases.size + 1}`);
        const inputs = blocks[id].inputs || {};
        orderedBlockInputs(blocks[id], normalizeProcedureArgumentIds, normalizeEmptyInputs)
            .forEach(({name}) => {
                referencedInputBlockIds(inputs[name], blocks, normalizeTupleInputReferences).forEach(assign);
            });
        assign(blocks[id].next);
    };
    roots.forEach(assign);
    Object.keys(blocks)
        .filter(id => !aliases.has(id))
        .sort(compareIds)
        .forEach(assign);

    const alias = id => (id && aliases.get(id)) || id || null;
    const normalizedBlocks = {};
    [...aliases.entries()]
        .sort((left, right) => {
            const number = value => Number(value.slice('block-'.length));
            return number(left[1]) - number(right[1]);
        })
        .forEach(([id, canonicalId]) => {
            const source = blocks[id];
            const block = {...source};
            if (normalizeBlockCoordinates) {
                if (Number.isFinite(block.x)) block.x = Math.round(block.x);
                if (Number.isFinite(block.y)) block.y = Math.round(block.y);
            }
            block.next = alias(source.next);
            block.parent = alias(source.parent);
            if (normalizeNullFieldIds) block.fields = normalizedFieldValues(source.fields);
            block.inputs = orderedBlockInputs(source, normalizeProcedureArgumentIds, normalizeEmptyInputs)
                .reduce((result, {name, normalizedName}) => {
                    result[normalizedName] = normalizeInputReferences(
                        source.inputs[name],
                        blocks,
                        alias,
                        normalizeTupleInputReferences,
                        normalizeInertInputShadows
                    );
                    return result;
                }, {});
            if (source.mutation && typeof source.mutation === 'object') {
                block.mutation = {...source.mutation};
                if (normalizeProcedureArgumentIds) {
                    block.mutation = mutationWithoutTransientBlockIds(block.mutation);
                } else if (typeof source.mutation.argumentids === 'string') {
                    try {
                        const ids = JSON.parse(source.mutation.argumentids);
                        if (Array.isArray(ids)) block.mutation.argumentids = JSON.stringify(ids.map(alias));
                    } catch (error) { // eslint-disable-line no-empty
                        // Keep malformed authored data unchanged for strict comparison.
                    }
                }
            }
            normalizedBlocks[canonicalId] = block;
        });
    const target = {...sourceTarget, blocks: normalizedBlocks};
    if (sourceTarget.comments) {
        target.comments = Object.keys(sourceTarget.comments).reduce((comments, id) => {
            const comment = sourceTarget.comments[id];
            comments[id] = comment && comment.blockId ? {...comment, blockId: alias(comment.blockId)} : comment;
            return comments;
        }, {});
    }
    return target;
};

const projectStructuralState = (
    project,
    {
        includeMonitorValues = false,
        normalizeAssetReferences = false,
        normalizeBlockReferences = false,
        normalizeTupleInputReferences = normalizeBlockReferences,
        normalizeProcedureArgumentIds = normalizeBlockReferences,
        normalizeEmptyInputs = false,
        normalizeNullFieldIds = false,
        normalizeBlockCoordinates = false,
        normalizeInertInputShadows = false
    } = {}
) => {
    const structural = {...project};
    structural.targets = project.targets.map(sourceTarget => {
        const target = normalizeBlockReferences ? normalizedBlockReferences(sourceTarget, {
            normalizeTupleInputReferences,
            normalizeProcedureArgumentIds,
            normalizeEmptyInputs,
            normalizeNullFieldIds,
            normalizeBlockCoordinates,
            normalizeInertInputShadows
        }) : {...sourceTarget};
        target.variables = Object.keys(sourceTarget.variables || {}).reduce((definitions, id) => {
            definitions[id] = variableDefinition(sourceTarget.variables[id]);
            return definitions;
        }, {});
        target.lists = Object.keys(sourceTarget.lists || {}).reduce((definitions, id) => {
            definitions[id] = {name: sourceTarget.lists[id][0]};
            return definitions;
        }, {});
        if (normalizeAssetReferences) {
            target.costumes = (sourceTarget.costumes || []).map(normalizedAssetReference);
            target.sounds = (sourceTarget.sounds || []).map(normalizedAssetReference);
        }
        TARGET_AUTHORED_PROPERTIES.forEach(property => delete target[property]);
        return target;
    });
    structural.monitors = (project.monitors || []).map(sourceMonitor => {
        const monitor = {...sourceMonitor};
        if (!includeMonitorValues) delete monitor.value;
        return monitor;
    });
    return structural;
};

const projectAuthoredState = project => ({
    schemaVersion: 1,
    targets: project.targets.map(target => {
        const variables = Object.keys(target.variables || {}).reduce((values, id) => {
            const variable = target.variables[id];
            if (!variable[2]) values[id] = cloneJson(variable[1]);
            return values;
        }, {});
        const lists = Object.keys(target.lists || {}).reduce((values, id) => {
            values[id] = cloneJson(target.lists[id][1]);
            return values;
        }, {});
        const properties = TARGET_AUTHORED_PROPERTIES.reduce((values, property) => {
            if (own(target, property)) values[property] = cloneJson(target[property]);
            return values;
        }, {});
        return {
            targetRef: {
                isStage: target.isStage,
                name: target.name
            },
            variables,
            lists,
            properties
        };
    })
});

export {
    TARGET_AUTHORED_PROPERTIES,
    normalizedBlockReferences,
    projectAuthoredState,
    projectStructuralState
};
