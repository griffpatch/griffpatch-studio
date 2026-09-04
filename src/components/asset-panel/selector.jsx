import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import SpriteSelectorItem from '../../containers/sprite-selector-item.jsx';
import Box from '../box/box.jsx';
import ActionMenu from '../action-menu/action-menu.jsx';
import SortableAsset from './sortable-asset.jsx';
import SortableHOC from '../../lib/sortable-hoc.jsx';
import DragConstants from '../../lib/drag-constants';

import styles from './selector.css';

const Selector = props => {
    const {
        buttons,
        containerRef,
        dragType,
        isRtl,
        items,
        selectedItemIndex,
        draggingIndex,
        draggingType,
        ordering,
        onAddSortable,
        onRemoveSortable,
        onDeleteClick,
        onDuplicateClick,
        onExportClick,
        onItemClick
    } = props;

    const isRelevantDrag = draggingType === dragType;

    let newButtonSection = null;

    if (buttons.length > 0) {
        const {img, title, onClick, studioTarget} = buttons[0];
        const moreButtons = buttons.slice(1);
        newButtonSection = (
            <Box className={styles.newButtons}>
                <ActionMenu
                    img={img}
                    moreButtons={moreButtons}
                    studioTarget={studioTarget}
                    title={title}
                    tooltipPlace={isRtl ? 'left' : 'right'}
                    onClick={onClick}
                />
            </Box>
        );
    }

    return (
        <Box
            className={styles.wrapper}
            componentRef={containerRef}
        >
            <Box className={styles.listArea}>
                {items.map((item, index) => (
                    <SortableAsset
                        id={item.name}
                        index={isRelevantDrag ? ordering.indexOf(index) : index}
                        key={item.name}
                        onAddSortable={onAddSortable}
                        onRemoveSortable={onRemoveSortable}
                    >
                        <SpriteSelectorItem
                            asset={item.asset}
                            className={classNames(styles.listItem, {
                                [styles.placeholder]: isRelevantDrag && index === draggingIndex
                            })}
                            costumeURL={item.url}
                            details={item.details}
                            dragPayload={item.dragPayload}
                            dragType={dragType}
                            id={index}
                            index={index}
                            name={item.name}
                            number={index + 1 /* 1-indexed */}
                            selected={index === selectedItemIndex}
                            studioTarget={item.studioTarget}
                            onClick={onItemClick}
                            onDeleteButtonClick={onDeleteClick}
                            onDuplicateButtonClick={onDuplicateClick}
                            onExportButtonClick={onExportClick}
                        />
                    </SortableAsset>
                ))}
            </Box>
            {newButtonSection}
        </Box>
    );
};

Selector.propTypes = {
    buttons: PropTypes.arrayOf(PropTypes.shape({
        title: PropTypes.string.isRequired,
        img: PropTypes.string.isRequired,
        studioTarget: PropTypes.string,
        onClick: PropTypes.func,
        fileAccept: PropTypes.string,
        fileChange: PropTypes.func,
        fileInput: PropTypes.func,
        fileMultiple: PropTypes.bool
    })),
    containerRef: PropTypes.func,
    dragType: PropTypes.oneOf(Object.keys(DragConstants)),
    draggingIndex: PropTypes.number,
    draggingType: PropTypes.oneOf(Object.keys(DragConstants)),
    isRtl: PropTypes.bool,
    items: PropTypes.arrayOf(PropTypes.shape({
        url: PropTypes.string,
        name: PropTypes.any, // modified by folders addon
        studioTarget: PropTypes.string
    })),
    onAddSortable: PropTypes.func,
    onDeleteClick: PropTypes.func,
    onDuplicateClick: PropTypes.func,
    onExportClick: PropTypes.func,
    onItemClick: PropTypes.func.isRequired,
    onRemoveSortable: PropTypes.func,
    ordering: PropTypes.arrayOf(PropTypes.number),
    selectedItemIndex: PropTypes.number.isRequired
};

export default SortableHOC(Selector);
