const test=require('node:test');
const assert=require('node:assert/strict');
const {pinnedArchive}=require('../../scripts/release-git-dependency-stage.cjs');
const {inspectArchive}=require('../../scripts/release-git-dependency-stage.cjs');
const tar=require('tar-stream');
const zlib=require('zlib');
async function archive(name,text,rootDirectory){
    const pack=tar.pack(),chunks=[];
    const complete=new Promise(resolve=>{pack.on('data',b=>chunks.push(b));pack.on('end',()=>resolve(zlib.gzipSync(Buffer.concat(chunks))));});
    if(rootDirectory)pack.entry({name:rootDirectory,type:'directory'});
    pack.entry({name},text);pack.finalize();return complete;
}
test('source URLs use HTTPS codeload and exact commits without git execution',()=>{
    const sha='a'.repeat(40);
    const a=pinnedArchive(`git+ssh://git@github.com/TurboWarp/scratch-paint.git#${sha}`);
    assert.equal(a.repo,'scratch-paint');
    assert.equal(a.url,`https://codeload.github.com/TurboWarp/scratch-paint/tar.gz/${sha}`);
    assert.deepEqual(pinnedArchive(`git+https://github.com/TurboWarp/scratch-paint#${sha}`),a);
});
test('archive inspection reads manifests in memory and refuses malformed or unexpected trees',async()=>{
    const entry={repo:'test',revision:'a'.repeat(40)};
    const prefix=`test-${entry.revision}/`;
    const result=await inspectArchive(await archive(prefix+'package.json','{"name":"test"}'),entry);
    assert.equal(result.packageManifest.name,'test');
    const npm=await inspectArchive(await archive('package/package.json','{}','package'),{archivePrefix:'package/'});
    assert.equal(npm.files,2);
    await assert.rejects(inspectArchive(await archive(prefix+'../package.json','{}'),entry),/Unexpected/);
    await assert.rejects(inspectArchive(await archive(prefix+'README','readme'),entry),/no root/);
    await assert.rejects(inspectArchive(Buffer.from('invalid'),entry));
});
test('unpinned, credentialed, external and path-traversal source URLs are rejected',()=>{
    for(const url of ['git+ssh://git@github.com/a/b#main','https://evil.invalid/archive',
        'git+https://user:password@github.com/a/b#'+'a'.repeat(40),
        'git+https://github.com/a/../../x#'+'a'.repeat(40)])assert.throws(()=>pinnedArchive(url));
});
