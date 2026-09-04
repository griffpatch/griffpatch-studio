const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {sourcePlan,renderDraft,stageDraft,publicNotices} = require('../../scripts/release-notice-draft.cjs');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

test('source plan retains unrepresented and development dependencies without claiming acquisition', () => {
    const lock = {packages:{'':{},'node_modules/a':{version:'1',resolved:'git+https://github.com/a/a#abc'},
        'node_modules/b':{version:'2',dev:true,integrity:'sha512-example',resolved:'https://registry.npmjs.org/b.tgz'}}};
    const rows=sourcePlan(lock,[{location:'node_modules/a'}]);
    assert.equal(rows.length,2);
    assert.equal(rows[1].representedInDirectBundleMap,false);
    assert.equal(rows[1].developmentOnly,true);
    assert.equal(rows[1].integrity,'sha512-example');
    for(const r of rows) assert.match(r.status,/consult the separate verified acquisition manifests/);
});
test('notice draft preserves original text and clearly labels unresolved and later notices', () => {
    const text='Copyright Original\r\nFull terms\r\n';
    const inventory={lockfileSha256:'lock',packages:[{location:'node_modules/a',name:'a',version:'1',
        license:'MIT',issues:['Review this'],notices:[{path:'LICENSE',text,sha256:hash(text)}]}]};
    const bundle={buildHash:'build',packages:[{location:'node_modules/a'}]};
    const extra={label:'Later',status:'Not historical evidence',url:'https://example.invalid/LICENSE',
        text:'Supplement',sha256:hash('Supplement')};
    const out=renderDraft(inventory,bundle,[extra]);
    assert.ok(out.includes(text));
    assert.match(out,/NOT APPROVED FOR PUBLICATION/);
    assert.match(out,/OPEN REVIEW: Review this/);
    assert.match(out,/Not historical evidence/);
    assert.throws(()=>renderDraft(inventory,bundle,[{...extra,text:'tampered'}]),/hash mismatch/);
    assert.throws(()=>renderDraft(inventory,{packages:[{location:'missing'}]},[]),/Missing inventory/);
});
test('existing destination is refused before any inventory or writes', () => {
    assert.throws(()=>stageDraft(process.cwd(),'missing-stats',process.cwd()),/refusing overwrite/);
});
test('later evidence preserves the actual notice text, dates and manifest pins', () => {
    const fs=require('fs');
    const e=require('../../docs/release/later-notice-evidence.json');
    assert.equal(e.entries.length,4);
    for(const row of e.entries){
        assert.equal(hash(row.notice.text),row.notice.sha256);
        assert.equal(hash(fs.readFileSync(`node_modules/${row.name}/package.json`)),row.packageManifestSha256);
        assert.match(row.notice.url,new RegExp('/'+row.notice.revision+'/LICENSE$'));
        assert.match(row.status,/later upstream notice/);
        assert.match(row.introduced.date,/^20(18|19|20)-/);
    }
});

test('public notice download is current and retains font, data, package and later notices', () => {
    const fs = require('fs');
    const output = publicNotices(process.cwd());
    assert.equal(fs.readFileSync('static/licenses/third-party-notices.txt', 'utf8'), output);
    for (const expected of ['GNU GENERAL PUBLIC LICENSE', 'Apache License', 'Grand9K Pixel',
        'creativecommons.org/licenses/by-sa/3.0/', 'SIL OPEN FONT LICENSE', 'UNICODE LICENSE V3',
        'valadaptive', 'Chart.js Contributors', 'Brian Grinstead', 'Nathan Friedly',
        'get-user-media-promise 1.1.4', 'published later', 'Common MIT permission']) {
        assert.ok(output.includes(expected), expected);
    }
    const credits = fs.readFileSync('src/playground/credits/credits.jsx', 'utf8');
    assert.ok(credits.includes('licenses/third-party-notices.txt'));
    assert.ok(!output.includes('NOT APPROVED FOR PUBLICATION'));
    assert.ok(output.includes('Author (package metadata)'));
});

test('public issue forms are concise and never ask for private contact details', () => {
    const fs = require('fs');
    const yaml = require('js-yaml');
    for (const name of ['bug', 'idea']) {
        const form = yaml.load(fs.readFileSync(`.github/ISSUE_TEMPLATE/${name}.yml`, 'utf8'));
        assert.ok(form.name && form.description && form.body.length);
        assert.ok(form.body.some(row => row.type === 'markdown' && /public/i.test(row.attributes.value)));
        assert.ok(form.body.some(row => row.validations && row.validations.required));
        assert.ok(!form.body.some(row => row.id === 'contact' || row.id === 'email'));
    }
    const config = yaml.load(fs.readFileSync('.github/ISSUE_TEMPLATE/config.yml', 'utf8'));
    assert.equal(config.blank_issues_enabled, false);
    assert.equal(config.contact_links[0].url, 'mailto:studio@griffpatch.academy');
});
