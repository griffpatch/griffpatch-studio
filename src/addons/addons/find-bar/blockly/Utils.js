import BlockInstance from "./BlockInstance.js";
import BlockFlasher from "./BlockFlasher.js";
import * as BlockScrolling from "../../../libraries/common/cs/block-scrolling.js";
import { getNavigationHistory } from "../../../libraries/common/cs/navigation-history.js";

export default class Utils {
  constructor(addon) {
    this.addon = addon;
    this.vm = addon.tab.traps.vm;
    this.navigationHistory = getNavigationHistory(this.vm, () => addon.tab.traps.getWorkspace());
    this.navigationHistory.bindInteractions(document);
    addon.tab.traps.getBlockly().then((blockly) => {
      this.blockly = blockly;
      BlockScrolling.initializeSmoothScrolling(blockly);
      this.navigationHistory.ensureWorkspace();
    });
    this.offsetX = 32;
    this.offsetY = 48;
  }

  getBlockId(block) {
    return block ? block.id || block.getId?.() || null : null;
  }

  getEditingTarget() {
    return this.vm.editingTarget || this.vm.runtime.getEditingTarget();
  }

  setEditingTarget(targetId) {
    if (this.getEditingTarget().id !== targetId) this.vm.setEditingTarget(targetId);
  }

  /** Resolve native identities again after switching sprites and after scrolling.
   * The shared history owns cancellation and captures the origin before either.
   */
  async scrollBlockIntoView(blockOrId, instant = false, onSpriteSwitch = null, isCurrent = () => true) {
    if (!isCurrent()) return;
    const targetId = blockOrId instanceof BlockInstance ? blockOrId.targetId : this.getEditingTarget().id;
    const history = this.navigationHistory;
    const operation = history?.beginNavigation(targetId);
    const current = () => isCurrent() && (!history || operation.request === history.request);
    let block;
    try {
      if (blockOrId instanceof BlockInstance) {
        const didSpriteSwitch = targetId !== this.getEditingTarget().id;
        if (this._cancelAnimation) {
          this._cancelAnimation();
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        if (!current()) return;
        if (didSpriteSwitch) {
          this.setEditingTarget(targetId);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        if (!current() || this.getEditingTarget().id !== targetId) return;
        block = this.addon.tab.traps.getWorkspace()?.getBlockById(blockOrId.id);
        if (didSpriteSwitch) {
          instant = true;
          if (block) onSpriteSwitch?.();
        }
      } else {
        const workspace = this.addon.tab.traps.getWorkspace();
        block = blockOrId?.id ? blockOrId : workspace?.getBlockById(blockOrId);
      }
      if (!block) return;
      const workspace = this.addon.tab.traps.getWorkspace();
      const scrolled = await this.scrollBlockIntoViewIfNeeded(workspace, block, instant, current);
      const live = () => current() && this.getEditingTarget().id === targetId &&
        this.addon.tab.traps.getWorkspace()?.getBlockById(block.id) === block;
      if (!live()) return;
      if (scrolled) this.blockly?.hideChaff();
      const destination = {blockId: block.id, targetId};
      history?.finishNavigation(operation, destination);
      setTimeout(() => { if (live()) BlockFlasher.selectionEffect(block); }, scrolled ? 50 : 0);
      return destination;
    } finally {
      if (history && history.operation === operation) history.operation = null;
    }
  }

  async scrollBlockIntoViewIfNeeded(workspace, block, instant = false, isCurrent = () => true) {
    const scroll = async () => {
      const result = await BlockScrolling.scrollBlockIntoViewIfNeeded(
        workspace, block, this.offsetX, this.offsetY, instant, isCurrent
      );
      return result.scrolled;
    };
    return this.navigationHistory ? this.navigationHistory.programmaticScroll(scroll) : scroll();
  }
}
