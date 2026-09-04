import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';
import {beginVariableValueEdit, setVariableValue} from '../lib/variable-utils';
import {connect} from 'react-redux';

import SliderMonitorComponent from '../components/monitor/slider-monitor.jsx';

class SliderMonitor extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleSliderGestureEnd',
            'handleSliderGestureStart',
            'handleSliderUpdate'
        ]);

        this.finishStudioValueEdit = null;

        this.state = {
            value: props.value
        };
    }
    componentWillReceiveProps (nextProps) {
        if (this.state.value !== nextProps.value) {
            this.setState({value: nextProps.value});
        }
    }
    componentWillUnmount () {
        this.handleSliderGestureEnd();
    }
    handleSliderGestureStart () {
        if (this.finishStudioValueEdit) return;
        const {vm, targetId, id: variableId} = this.props;
        this.finishStudioValueEdit = beginVariableValueEdit(vm, targetId, variableId);
    }
    handleSliderGestureEnd () {
        if (!this.finishStudioValueEdit) return;
        const finish = this.finishStudioValueEdit;
        this.finishStudioValueEdit = null;
        finish();
    }
    handleSliderUpdate (e) {
        const implicitGesture = !this.finishStudioValueEdit;
        if (implicitGesture) this.handleSliderGestureStart();
        this.setState({value: Number(e.target.value)});
        const {vm, targetId, id: variableId} = this.props;
        setVariableValue(vm, targetId, variableId, Number(e.target.value));
        if (implicitGesture) this.handleSliderGestureEnd();
    }
    render () {
        const {
            vm, // eslint-disable-line no-unused-vars
            value, // eslint-disable-line no-unused-vars
            ...props
        } = this.props;
        return (
            <SliderMonitorComponent
                {...props}
                value={this.state.value}
                onSliderBlur={this.handleSliderGestureEnd}
                onSliderGestureEnd={this.handleSliderGestureEnd}
                onSliderGestureStart={this.handleSliderGestureStart}
                onSliderUpdate={this.handleSliderUpdate}
            />
        );
    }
}

SliderMonitor.propTypes = {
    id: PropTypes.string,
    targetId: PropTypes.string,
    value: PropTypes.oneOfType([
        PropTypes.number,
        PropTypes.string
    ]),
    vm: PropTypes.instanceOf(VM)
};

const mapStateToProps = state => ({vm: state.scratchGui.vm});

export {SliderMonitor};
export default connect(mapStateToProps)(SliderMonitor);
