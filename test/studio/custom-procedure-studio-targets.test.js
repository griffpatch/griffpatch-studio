import fs from 'fs';
import path from 'path';

test('keeps explicit language-neutral Studio targets on the custom procedure controls', () => {
    const source = fs.readFileSync(
        path.join(process.cwd(), 'src/components/custom-procedures/custom-procedures.jsx'),
        'utf8'
    );
    for (const target of [
        'custom-procedure-add-text-number',
        'custom-procedure-add-boolean',
        'custom-procedure-add-label',
        'custom-procedure-warp',
        'custom-procedure-cancel',
        'custom-procedure-ok'
    ]) {
        expect(source.match(new RegExp(`data-studio-target="${target}"`, 'g'))).toHaveLength(1);
    }
});
