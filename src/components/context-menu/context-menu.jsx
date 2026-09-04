import React from 'react';
import PropTypes from 'prop-types';
import {ContextMenu, MenuItem} from 'react-contextmenu';
import classNames from 'classnames';

import styles from './context-menu.css';

const StyledContextMenu = props => (
    <ContextMenu
        {...props}
        className={styles.contextMenu}
    />
);

const StyledMenuItem = ({attributes, ...props}) => (
    <MenuItem
        {...props}
        attributes={{
            ...attributes,
            className: classNames(styles.menuItem, attributes && attributes.className)
        }}
    />
);

const BorderedMenuItem = ({attributes, ...props}) => (
    <MenuItem
        {...props}
        attributes={{
            ...attributes,
            className: classNames(styles.menuItem, styles.menuItemBordered, attributes && attributes.className)
        }}
    />
);

const DangerousMenuItem = ({attributes, ...props}) => (
    <MenuItem
        {...props}
        attributes={{
            ...attributes,
            className: classNames(
                styles.menuItem,
                styles.menuItemBordered,
                styles.menuItemDanger,
                attributes && attributes.className
            )
        }}
    />
);

const menuItemPropTypes = {
    attributes: PropTypes.shape({
        className: PropTypes.string
    })
};

StyledMenuItem.propTypes = menuItemPropTypes;
BorderedMenuItem.propTypes = menuItemPropTypes;
DangerousMenuItem.propTypes = menuItemPropTypes;


export {
    BorderedMenuItem,
    DangerousMenuItem,
    StyledContextMenu as ContextMenu,
    StyledMenuItem as MenuItem
};
