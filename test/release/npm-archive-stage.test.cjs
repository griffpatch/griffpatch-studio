const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('crypto');
const {verifyIntegrity,archiveURL}=require('../../scripts/release-npm-archive-stage.cjs');
test('registry archives require exact strongest supported integrity',()=>{
    const bytes=Buffer.from('source');
    const sri=a=>a+'-'+crypto.createHash(a).update(bytes).digest('base64');
    verifyIntegrity(bytes,sri('sha512'));
    verifyIntegrity(bytes,sri('sha1')+' '+sri('sha512'));
    assert.throws(()=>verifyIntegrity(Buffer.from('changed'),sri('sha512')),/mismatch/);
    assert.throws(()=>verifyIntegrity(bytes,sri('sha1')+' sha512-YmFk'),/mismatch/);
    assert.throws(()=>verifyIntegrity(bytes,''),/Missing/);
});
test('registry source URLs cannot carry credentials or leave the public registry',()=>{
    assert.equal(archiveURL('https://registry.npmjs.org/a/-/a-1.tgz'),'https://registry.npmjs.org/a/-/a-1.tgz');
    for(const u of ['http://registry.npmjs.org/a','https://evil.invalid/a',
        'https://name:secret@registry.npmjs.org/a','https://registry.npmjs.org/a?token=secret'])assert.throws(()=>archiveURL(u));
});
