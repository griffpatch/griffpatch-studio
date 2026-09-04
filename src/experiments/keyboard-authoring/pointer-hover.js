import {blockAtPointerTarget} from '../../addons/libraries/common/cs/block-pointer-target';

const updateBlockHover = (current, next, className) => {
    if (current === next) return current;
    const currentRoot = current && current.getSvgRoot();
    if (currentRoot) {
        currentRoot.classList.remove(className);
        currentRoot.removeAttribute('data-keyboard-hovered');
    }
    const nextRoot = next && next.getSvgRoot();
    if (nextRoot) {
        nextRoot.classList.add(className);
        nextRoot.setAttribute('data-keyboard-hovered', 'true');
    }
    return next || null;
};

export {blockAtPointerTarget, updateBlockHover};
