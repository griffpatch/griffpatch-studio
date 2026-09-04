// Preserve exact registry archives represented in a reviewed module map.
// No npm install, lifecycle scripts, extraction or publication.
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {inspectArchive}=require('./release-git-dependency-stage.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function verifyIntegrity(bytes,integrity){
    const tokens=String(integrity).split(/\s+/);
    const supported=tokens.map(t=>/^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/=]+)$/.exec(t)).filter(Boolean);
    if(!supported.length)throw new Error('Missing supported archive integrity');
    const strongest=['sha512','sha384','sha256','sha1'].find(a=>supported.some(t=>t[1]===a));
    if(!supported.filter(t=>t[1]===strongest).some(t=>crypto.createHash(strongest).update(bytes).digest('base64')===t[2])){
        throw new Error('Registry archive integrity mismatch');
    }
}
function archiveURL(value){
    const u=new URL(value);
    if(u.protocol!=='https:'||u.hostname!=='registry.npmjs.org'||u.username||u.password||u.port||u.search||u.hash){
        throw new Error('Only pinned public npm registry archive URLs are accepted');
    }
    return u.href;
}
async function stage(root,mapFile,destination){
    const lockBytes=fs.readFileSync(path.join(root,'package-lock.json')),lock=JSON.parse(lockBytes);
    const map=JSON.parse(fs.readFileSync(mapFile));
    if(map.lockfileSha256!==hash(lockBytes))throw new Error('Bundle map lockfile mismatch');
    if(fs.existsSync(destination))throw new Error('Output must be new');
    const entries=map.packages.map(p=>({location:p.location,name:p.name,...lock.packages[p.location]}))
        .filter(p=>!/^git\+/.test(p.resolved||''));
    for(const p of entries){archiveURL(p.resolved);if(!p.integrity)throw new Error('Unpinned registry archive');}
    fs.mkdirSync(destination);
    const report={scope:'Exact shipped-map package archives; not proof of complete original dependency source',
        lockfileSha256:hash(lockBytes),buildHash:map.buildHash,complete:false,archives:[]};
    for(const [index,p] of entries.entries()){
        const response=await fetch(archiveURL(p.resolved),{redirect:'error',signal:AbortSignal.timeout(60000)});
        if(!response.ok)throw new Error(`Download failed: ${p.name} ${response.status}`);
        const chunks=[];let size=0;
        for await(const b of response.body){size+=b.length;if(size>64*1024*1024)throw new Error('Archive too large');chunks.push(b);}
        const bytes=Buffer.concat(chunks);
        verifyIntegrity(bytes,p.integrity);
        const inspected=await inspectArchive(bytes,{archivePrefix:'package/'});
        if(inspected.packageManifest.name!==p.name||inspected.packageManifest.version!==p.version){
            throw new Error(`Archive identity mismatch: ${p.name}`);
        }
        const file=`${String(index+1).padStart(3,'0')}-${hash(Buffer.from(p.location)).slice(0,12)}.tgz`;
        fs.writeFileSync(path.join(destination,file),bytes,{flag:'wx'});
        if(hash(fs.readFileSync(path.join(destination,file)))!==hash(bytes))throw new Error('Archive write mismatch');
        report.archives.push({location:p.location,name:p.name,version:p.version,url:p.resolved,integrity:p.integrity,
            file,bytes:size,sha256:hash(bytes),inspected,
            sourceStatus:'Package distribution acquired; review original source for precompiled/embedded components'});
        fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(report,null,2));
        if((index+1)%25===0)console.log(`Verified ${index+1}/${entries.length} registry archives`);
    }
    report.complete=true;
    fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(report,null,2));
    return {archives:report.archives.length,bytes:report.archives.reduce((n,a)=>n+a.bytes,0),complete:true};
}
if(require.main===module){
    const args=process.argv.slice(2);if(args.length!==3)throw new Error('Usage: release-npm-archive-stage.cjs root bundle-map.json new-output');
    stage(...args).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});
}
module.exports={verifyIntegrity,archiveURL,stage};
