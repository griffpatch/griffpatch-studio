import fs from 'fs';
import path from 'path';

const source = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

test('keeps language-neutral Studio targets on project-library controls and items', () => {
    expect(source('src/components/sprite-selector/sprite-selector.jsx'))
        .toContain('studioTarget="sprite-library-open"');
    expect(source('src/components/stage-selector/stage-selector.jsx'))
        .toContain('studioTarget="backdrop-library-open"');
    expect(source('src/components/stage-selector/stage-selector.jsx'))
        .toContain("studioTarget: 'backdrop-stage-upload-open'");
    expect(source('src/components/stage-selector/stage-selector.jsx'))
        .toContain("studioTarget: 'backdrop-stage-paint-create'");
    expect(source('src/containers/costume-tab.jsx'))
        .toContain("studioTarget: isStage ? 'backdrop-editor-menu-open' : 'costume-library-open'");
    expect(source('src/containers/costume-tab.jsx'))
        .toContain("'costume-library-open'");
    expect(source('src/containers/costume-tab.jsx'))
        .toContain("'costume-upload-open'");
    expect(source('src/containers/costume-tab.jsx'))
        .toContain("'backdrop-upload-open'");
    expect(source('src/containers/costume-tab.jsx'))
        .toContain("'costume-paint-create'");
    expect(source('src/containers/costume-tab.jsx'))
        .toContain("'backdrop-paint-create'");
    expect(source('src/containers/sound-tab.jsx'))
        .toContain("'sound-library-open'");
    expect(source('src/components/gui/gui.jsx'))
        .toContain('data-studio-target="tab-costumes"');
    expect(source('src/components/gui/gui.jsx'))
        .toContain('data-studio-target="tab-sounds"');
    expect(source('src/components/library/library.jsx'))
        .toContain('dataItem.md5ext || dataItem._md5 || dataItem.extensionId');
    expect(source('src/components/sound-editor/sound-editor.jsx'))
        .toContain('studioTarget="sound-effect:faster"');
    expect(source('src/containers/sound-tab.jsx'))
        .toContain('studioTarget: `sound-item:${index}:${sound.assetId}`');
    expect(source('src/containers/costume-tab.jsx'))
        .toContain("`${isStage ? 'backdrop' : 'costume'}-item:${index}:${costume.assetId}`");
    expect(source('src/containers/paint-editor-wrapper.jsx'))
        .toContain('data-studio-target="costume-editor"');
    expect(source('src/components/sound-editor/sound-editor.jsx'))
        .toContain('data-studio-target="sound-name-input"');
    expect(source('src/components/sprite-selector-item/sprite-selector-item.jsx'))
        .toContain('`${props.studioTarget}:duplicate`');
    expect(source('src/containers/sound-tab.jsx'))
        .toContain("studioTarget: 'sound-upload-open'");
    expect(source('src/components/action-menu/action-menu.jsx'))
        .toContain('data-studio-target={studioTarget}');
    expect(source('src/components/action-menu/action-menu.jsx'))
        .toContain('`${itemStudioTarget}-input`');
    expect(source('src/components/library-item/library-item.jsx').match(/data-studio-library-key/g))
        .toHaveLength(2);
    expect(source('src/components/sprite-selector-item/sprite-selector-item.jsx'))
        .toContain("'data-studio-sprite-name'");
});
