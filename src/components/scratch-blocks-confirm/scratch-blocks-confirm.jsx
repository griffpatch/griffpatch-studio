import {FormattedMessage} from 'react-intl';
import PropTypes from 'prop-types';
import React from 'react';

import Box from '../box/box.jsx';
import Modal from '../../containers/modal.jsx';

import styles from './scratch-blocks-confirm.css';

const ScratchBlocksConfirm = props => (
    <Modal
        className={styles.modalContent}
        contentLabel={props.title}
        id="scratchBlocksConfirmModal"
        onRequestClose={props.onCancel}
    >
        <Box className={styles.body}>
            <Box className={styles.message}>
                {props.message}
            </Box>
            <Box className={styles.buttonRow}>
                <button
                    className={styles.cancelButton}
                    data-studio-target="blocks-confirm-cancel"
                    onClick={props.onCancel}
                >
                    <FormattedMessage
                        defaultMessage="Cancel"
                        description="Button in Scratch Blocks confirmation dialogs for cancelling the action"
                        id="gui.scratchBlocksConfirm.cancel"
                    />
                </button>
                <button
                    className={styles.okButton}
                    data-studio-target="blocks-confirm-ok"
                    onClick={props.onConfirm}
                >
                    <FormattedMessage
                        defaultMessage="OK"
                        description="Button in Scratch Blocks confirmation dialogs for confirming the action"
                        id="gui.scratchBlocksConfirm.ok"
                    />
                </button>
            </Box>
        </Box>
    </Modal>
);

ScratchBlocksConfirm.propTypes = {
    message: PropTypes.string.isRequired,
    onCancel: PropTypes.func.isRequired,
    onConfirm: PropTypes.func.isRequired,
    title: PropTypes.string.isRequired
};

export default ScratchBlocksConfirm;
