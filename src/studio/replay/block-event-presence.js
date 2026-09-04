import {analyzeTransactionEffects} from './transaction-effects';

/**
 * Determine whether lifecycle events leave each recorded block present after
 * one directional transaction. An inverse create deletes every captured ID;
 * its earlier move is therefore redundant and unsafe to replay into the VM.
 *
 * @param {object} transaction Studio transaction
 * @param {'forward'|'backward'} direction replay direction
 * @returns {Map<string, boolean>} final presence by block ID
 */
const finalBlockPresence = (transaction, direction) => (
    analyzeTransactionEffects(transaction, direction).presence
);

export {finalBlockPresence};
