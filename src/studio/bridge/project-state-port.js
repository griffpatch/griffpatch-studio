import {canonicalJson} from '../validation/canonical-json';
import {firstJsonDifference} from '../validation/first-json-difference';
import {
    projectAuthoredState,
    projectStructuralState
} from '../validation/project-state-projection';

const bytesToHex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');

const defaultDigest = bytes => crypto.subtle.digest('SHA-256', bytes);

const hashJson = async (value, digest) => {
    const bytes = new TextEncoder().encode(canonicalJson(value));
    const result = await digest(bytes);
    return bytesToHex(new Uint8Array(result));
};

/**
 * Hash the VM's semantic project JSON with stable object-key ordering.
 * Asset bytes are represented by their project asset identifiers.
 *
 * @param {object} options port dependencies
 * @param {object} options.vm TurboWarp VM
 * @param {Function} [options.digest] SHA-256-compatible digest function
 * @returns {object} project-state port
 */
const createProjectStatePort = ({vm, digest = defaultDigest}) => {
    const capture = async ({hashKind = null} = {}) => {
        const project = JSON.parse(vm.toJSON());
        if (hashKind === 'full-project-v1') {
            return {
                hash: await hashJson(project, digest),
                project
            };
        }
        const structuralProject = projectStructuralState(project, {
            includeMonitorValues: hashKind === 'structural-v1',
            normalizeAssetReferences: hashKind === 'structural-v3' || hashKind === 'structural-v4' ||
                hashKind === 'structural-v5' || hashKind === 'structural-v6' ||
                hashKind === 'structural-v7' || hashKind === 'structural-v8' || hashKind === 'structural-v9' ||
                hashKind === 'structural-v10' || hashKind === null,
            normalizeBlockReferences: hashKind === 'structural-v4' || hashKind === 'structural-v5' ||
                hashKind === 'structural-v6' || hashKind === 'structural-v7' || hashKind === 'structural-v8' ||
                hashKind === 'structural-v9' || hashKind === 'structural-v10' || hashKind === null,
            // structural-v4 shipped before real VM tuple references were
            // normalized. Preserve that exact projection for existing take
            // hashes; structural-v5 is the corrected, compatibility-safe form.
            normalizeTupleInputReferences: hashKind === 'structural-v5' || hashKind === 'structural-v6' ||
                hashKind === 'structural-v7' || hashKind === 'structural-v8' || hashKind === 'structural-v9' ||
                hashKind === 'structural-v10' || hashKind === null,
            // Procedure prototypes and calls use regenerated argument IDs as
            // input keys. V6 treats their positional meaning as authored and
            // keeps the shipped V5 projection available for existing takes.
            normalizeProcedureArgumentIds: hashKind === 'structural-v6' || hashKind === 'structural-v7' ||
                hashKind === 'structural-v8' || hashKind === 'structural-v9' || hashKind === 'structural-v10' ||
                hashKind === null,
            // Disconnecting the last child can leave an inert [kind, null]
            // tuple behind, while a fresh flyout clone omits the same empty
            // socket. The block opcode/mutation owns the visible socket, so
            // these two VM serializations have identical authored meaning.
            normalizeEmptyInputs: hashKind === 'structural-v7' || hashKind === 'structural-v8' ||
                hashKind === 'structural-v9' || hashKind === 'structural-v10' || hashKind === null,
            // Backpack JSON can omit the second element of [value, null]
            // field tuples. V8 preserves V7 hashes while recognizing those
            // equivalent serializations for newly recorded takes.
            normalizeNullFieldIds: hashKind === 'structural-v8' || hashKind === 'structural-v9' ||
                hashKind === 'structural-v10' || hashKind === null,
            // Workspace transforms can produce subpixel coordinates, while an
            // SB3 save/load persists the same top-level block at integer
            // precision. V9 compares the authored position at that durable
            // Scratch boundary.
            normalizeBlockCoordinates: hashKind === 'structural-v9' || hashKind === 'structural-v10' ||
                hashKind === null,
            // A Backpack import can transiently encode [live child, null
            // shadow] as a kind-3 input; SB3 reload durably stores the same
            // connection as kind 2. A real third-slot shadow remains authored.
            normalizeInertInputShadows: hashKind === 'structural-v10' || hashKind === null
        });
        if (hashKind === 'structural-v1' || hashKind === 'structural-v2' || hashKind === 'structural-v3' ||
            hashKind === 'structural-v4' || hashKind === 'structural-v5' || hashKind === 'structural-v6' ||
            hashKind === 'structural-v7' || hashKind === 'structural-v8' || hashKind === 'structural-v9' ||
            hashKind === 'structural-v10') {
            return {
                structural: {
                    hash: await hashJson(structuralProject, digest),
                    project: structuralProject
                }
            };
        }
        const authoredState = projectAuthoredState(project);
        const [hash, structuralHash, authoredHash] = await Promise.all([
            hashJson(project, digest),
            hashJson(structuralProject, digest),
            hashJson(authoredState, digest)
        ]);
        return {
            hash,
            project,
            structural: {
                hash: structuralHash,
                project: structuralProject
            },
            authored: {
                hash: authoredHash,
                state: authoredState
            }
        };
    };
    return {
        capture,
        difference: firstJsonDifference,
        hash: async () => (await capture({hashKind: 'full-project-v1'})).hash,
        preferredHashKind: 'structural-v10'
    };
};

export {createProjectStatePort};
