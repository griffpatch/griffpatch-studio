import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import VM from 'scratch-vm';
import {clearUndoState} from 'scratch-paint/src/reducers/undo';
import PaintEditor from '../lib/tw-scratch-paint';
import {inlineSvgFonts, sanitizeSvg} from '@turbowarp/scratch-svg-renderer';
import ErrorBoundaryHOC from '../lib/error-boundary-hoc.jsx';
import {openFontsModal} from '../reducers/modals';

import {connect} from 'react-redux';
import {Theme} from '../lib/themes/index.js';
import {paintBrushStyleFromState} from '../studio/bridge/paint-brush-style';
import {createPaintGestureCapture} from '../studio/bridge/paint-gesture-capture';
import {runStudioProjectOperationSource} from '../studio/bridge/project-operation-capture';
import {
    beginStudioProjectEditSession,
    endStudioProjectEditSession,
    runStudioProjectEditMutation
} from '../studio/bridge/project-edit-session';

class PaintEditorWrapper extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleUpdateImage',
            'handleUpdateName',
            'handleUpdateFonts',
            'fontInlineFn',
            'setPaintEditorElement',
            'beginPaintEditSession',
            'endPaintEditSession'
        ]);
        this.paintEditorElement = null;
        this.paintGestureCapture = null;
        this.paintEditSession = null;
        this.state = {
            fonts: this.props.vm.runtime.fontManager.getFonts(),
            paintReady: false
        };
    }
    componentDidMount () {
        this.props.vm.runtime.fontManager.on('change', this.handleUpdateFonts);
        // PaperCanvas seeds its baseline snapshot when it mounts. Clear the
        // previous visit first, then mount it on the next render so native
        // Paint undo cannot cross an already-recorded Studio session boundary.
        this.props.onClearPaintUndo();
        if (this.paintEditorElement) {
            this.paintGestureCapture = createPaintGestureCapture({root: this.paintEditorElement});
        }
        this.beginPaintEditSession();
        // The deliberate second render mounts PaperCanvas only after its old
        // global undo reducer has been cleared.
        // eslint-disable-next-line react/no-did-mount-set-state
        this.setState({paintReady: true});
    }
    shouldComponentUpdate (nextProps, nextState) {
        return this.props.imageId !== nextProps.imageId ||
            this.props.editFormat !== nextProps.editFormat ||
            this.props.rtl !== nextProps.rtl ||
            this.props.name !== nextProps.name ||
            this.props.theme !== nextProps.theme ||
            this.props.customStageSize !== nextProps.customStageSize ||
            this.props.paintBrushStyle !== nextProps.paintBrushStyle ||
            this.props.paintCanUndo !== nextProps.paintCanUndo ||
            this.props.paintCanRedo !== nextProps.paintCanRedo ||
            this.props.targetId !== nextProps.targetId ||
            this.state.fonts !== nextState.fonts ||
            this.state.paintReady !== nextState.paintReady;
    }
    componentDidUpdate (previousProps) {
        if (previousProps.targetId !== this.props.targetId) {
            this.endPaintEditSession();
            this.beginPaintEditSession();
        }
        if (this.paintGestureCapture && (previousProps.imageId !== this.props.imageId ||
            previousProps.editFormat !== this.props.editFormat)) {
            this.paintGestureCapture.reset();
            this.paintGestureCapture.refresh();
        }
    }
    componentWillUnmount () {
        this.props.vm.runtime.fontManager.off('change', this.handleUpdateFonts);
        if (this.paintGestureCapture) this.paintGestureCapture.detach();
        this.endPaintEditSession();
    }
    beginPaintEditSession () {
        this.paintEditSession = beginStudioProjectEditSession(this.props.vm, {
            type: this.props.targetIsStage ? 'backdrop-edit-session' : 'costume-edit-session',
            targetId: this.props.targetId,
            targetRef: {
                isStage: this.props.targetIsStage,
                name: this.props.targetName
            }
        });
    }
    endPaintEditSession () {
        const token = this.paintEditSession;
        this.paintEditSession = null;
        if (token) endStudioProjectEditSession(this.props.vm, token).catch(() => {});
    }
    handleUpdateFonts () {
        this.setState({
            fonts: this.props.vm.runtime.fontManager.getFonts()
        });
    }
    handleUpdateName (name) {
        return runStudioProjectEditMutation(this.props.vm, this.paintEditSession, () => (
            this.props.vm.renameCostume(this.props.selectedCostumeIndex, name)
        ));
    }
    handleUpdateImage (isVector, image, rotationCenterX, rotationCenterY) {
        const paintGesture = this.paintGestureCapture && this.paintGestureCapture.consume();
        const update = () => {
            if (isVector) {
                return this.props.vm.updateSvg(
                    this.props.selectedCostumeIndex,
                    image,
                    rotationCenterX,
                    rotationCenterY);
            }
            return this.props.vm.updateBitmap(
                this.props.selectedCostumeIndex,
                image,
                rotationCenterX,
                rotationCenterY,
                2 /* bitmapResolution */);
        };
        return runStudioProjectEditMutation(this.props.vm, this.paintEditSession, () => (
            paintGesture ? runStudioProjectOperationSource(this.props.vm, {
                kind: 'paint-brush-stroke',
                gesture: paintGesture
            }, update) : update()
        ));
    }
    fontInlineFn (svgString) {
        return inlineSvgFonts(svgString, this.props.vm.renderer.customFonts);
    }
    setPaintEditorElement (element) {
        this.paintEditorElement = element;
    }
    render () {
        if (!this.props.imageId) return null;
        const {
            editFormat,
            selectedCostumeIndex,
            paintBrushStyle,
            paintCanRedo,
            paintCanUndo,
            targetId: _targetId,
            targetIsStage: _targetIsStage,
            targetName: _targetName,
            vm,
            ...componentProps
        } = this.props;
        const costume = vm.getCostume(selectedCostumeIndex);
        return (
            <div
                data-studio-target="costume-editor"
                data-studio-brush-style={paintBrushStyle || null}
                data-studio-edit-format={editFormat}
                data-studio-paint-can-redo={paintCanRedo ? 'true' : 'false'}
                data-studio-paint-can-undo={paintCanUndo ? 'true' : 'false'}
                ref={this.setPaintEditorElement}
                style={{display: 'contents'}}
            >
                {this.state.paintReady ?
                    <PaintEditor
                        {...componentProps}
                        image={this.props.imageFormat === 'svg' ? sanitizeSvg.sanitizeSvgText(costume) : costume}
                        onUpdateImage={this.handleUpdateImage}
                        onUpdateName={this.handleUpdateName}
                        fontInlineFn={this.fontInlineFn}
                        theme={this.props.theme.isDark() ? 'dark' : 'light'}
                        customFonts={this.state.fonts}
                        width={this.props.customStageSize.width}
                        height={this.props.customStageSize.height}
                    /> : null}
            </div>
        );
    }
}

PaintEditorWrapper.propTypes = {
    customStageSize: PropTypes.shape({
        width: PropTypes.number,
        height: PropTypes.number
    }),
    editFormat: PropTypes.oneOf(['svg', 'bitmap']).isRequired,
    onManageFonts: PropTypes.func.isRequired,
    paintCanRedo: PropTypes.bool.isRequired,
    paintCanUndo: PropTypes.bool.isRequired,
    paintBrushStyle: PropTypes.string,
    imageFormat: PropTypes.string.isRequired,
    imageId: PropTypes.string.isRequired,
    onClearPaintUndo: PropTypes.func.isRequired,
    theme: PropTypes.instanceOf(Theme),
    name: PropTypes.string,
    rotationCenterX: PropTypes.number,
    rotationCenterY: PropTypes.number,
    rtl: PropTypes.bool,
    selectedCostumeIndex: PropTypes.number.isRequired,
    targetId: PropTypes.string.isRequired,
    targetIsStage: PropTypes.bool.isRequired,
    targetName: PropTypes.string.isRequired,
    vm: PropTypes.instanceOf(VM)
};

const mapStateToProps = (state, {selectedCostumeIndex}) => {
    const targetId = state.scratchGui.vm.editingTarget.id;
    const target = state.scratchGui.vm.editingTarget;
    const sprite = target.sprite;
    // Make sure the costume index doesn't go out of range.
    const index = selectedCostumeIndex < sprite.costumes.length ?
        selectedCostumeIndex : sprite.costumes.length - 1;
    const costume = state.scratchGui.vm.editingTarget.sprite.costumes[index];
    const editFormat = costume && costume.dataFormat === 'svg' ? 'svg' : 'bitmap';
    const brushStyle = paintBrushStyleFromState(state.scratchPaint, editFormat);
    const undoState = state.scratchPaint.undo || {pointer: -1, stack: []};
    return {
        customStageSize: state.scratchGui.customStageSize,
        name: costume && costume.name,
        rotationCenterX: costume && costume.rotationCenterX,
        rotationCenterY: costume && costume.rotationCenterY,
        imageFormat: costume && costume.dataFormat,
        editFormat,
        imageId: targetId && `${targetId}${costume.skinId}`,
        paintBrushStyle: brushStyle ? JSON.stringify(brushStyle) : null,
        paintCanUndo: undoState.pointer > 0,
        paintCanRedo: undoState.pointer > -1 && undoState.pointer < undoState.stack.length - 1,
        rtl: state.locales.isRtl,
        selectedCostumeIndex: index,
        theme: state.scratchGui.theme.theme,
        targetId,
        targetIsStage: Boolean(target.isStage),
        targetName: target.getName ? target.getName() : target.sprite.name,
        vm: state.scratchGui.vm,
        zoomLevelId: targetId
    };
};

const mapDispatchToProps = dispatch => ({
    onClearPaintUndo: () => dispatch(clearUndoState()),
    onManageFonts: () => dispatch(openFontsModal())
});

export default ErrorBoundaryHOC('paint')(connect(
    mapStateToProps,
    mapDispatchToProps
)(PaintEditorWrapper));
