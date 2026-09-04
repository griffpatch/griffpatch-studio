import fs from 'fs';
import path from 'path';

test('keeps explicit language-neutral Studio targets on the variable prompt controls', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/components/prompt/prompt.jsx'), 'utf8');
    for (const target of [
        'prompt-variable-name',
        'prompt-scope-global',
        'prompt-scope-local',
        'prompt-cloud',
        'prompt-cancel',
        'prompt-ok'
    ]) {
        expect(source.match(new RegExp(`data-studio-target="${target}"`, 'g'))).toHaveLength(1);
    }
});
