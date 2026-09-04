import React from 'react';
import {shallow} from 'enzyme';

import {createSortableWrapper} from '../../src/lib/sortable-hoc.jsx';

const Wrapped = () => null;
const SortableWrapper = createSortableWrapper(Wrapped);

const item = name => ({name, url: `${name}.svg`});
const box = (top, bottom) => ({top, bottom, left: 0, right: 100});

test('commits a completed reorder after the drag-end frame', () => {
    const onDrop = jest.fn();
    const idleDrag = {
        dragging: false,
        currentOffset: null,
        dragType: 'COSTUME',
        index: 1
    };
    const activeDrag = {...idleDrag, dragging: true, currentOffset: {x: 50, y: 25}};
    const wrapper = shallow(<SortableWrapper
        dragInfo={idleDrag}
        items={[item('one'), item('two')]}
        onDrop={onDrop}
    />);
    const instance = wrapper.instance();
    instance.ref = {getBoundingClientRect: () => box(0, 100)};
    instance.sortableRefs = [
        {getBoundingClientRect: () => box(0, 50)},
        {getBoundingClientRect: () => box(50, 100)}
    ];

    wrapper.setProps({dragInfo: activeDrag});
    expect(onDrop).not.toHaveBeenCalled();

    wrapper.setProps({dragInfo: idleDrag});
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({
        dragging: true,
        dragType: 'COSTUME',
        index: 1,
        newIndex: 0
    }));
});
