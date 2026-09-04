// Acquire pinned public Git dependency source archives, never execute or extract.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const tar = require('tar-stream');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function pinnedArchive(resolved) {
    const match = /^git\+(?:ssh:\/\/git@|https:\/\/)github\.com\/([\w-]+)\/([\w.-]+?)(?:\.git)?#([a-f0-9]{40})$/.exec(resolved);
    if (!match) throw new Error('Expected an exact public GitHub commit, not a branch or arbitrary URL');
    const [,owner,repo,revision] = match;
    return {owner,repo,revision,url:`https://codeload.github.com/${owner}/${repo}/tar.gz/${revision}`};
}
function inspectArchive(bytes,entry) {
    return new Promise((resolve,reject)=>{
        const extract=tar.extract();
        const gunzip=zlib.createGunzip();
        const prefix=entry.archivePrefix || `${entry.repo}-${entry.revision}/`;
        const result={files:0,noticePaths:[],linksForReview:[],packageManifest:null};
        let expanded=0;
        gunzip.on('data',chunk=>{
            expanded+=chunk.length;
            if(expanded>512*1024*1024)gunzip.destroy(new Error('Expanded archive exceeds review limit'));
        });
        gunzip.on('error',reject);
        extract.on('error',reject);
        extract.on('entry',(header,stream,next)=>{
            const name=header.name;
            const rootDirectory=header.type==='directory' && name===prefix.slice(0,-1);
            if((!rootDirectory&&!name.startsWith(prefix))||name.includes('\\')||name.split('/').includes('..')){
                stream.resume();extract.destroy(new Error('Unexpected source archive path'));return;
            }
            result.files++;
            if(/(^|\/)(licen[sc]e[^/]*|copying|notice[^/]*)$/i.test(name))result.noticePaths.push(name);
            if(['symlink','link'].includes(header.type))result.linksForReview.push({path:name,target:header.linkname});
            if(name===prefix+'package.json'){
                if(header.size>1024*1024){extract.destroy(new Error('Oversized package manifest'));stream.resume();return;}
                const parts=[];
                stream.on('data',chunk=>parts.push(chunk));
                stream.on('end',()=>{
                    try{result.packageManifest=JSON.parse(Buffer.concat(parts));next();}catch(e){extract.destroy(e);}
                });
            }else{stream.on('end',next);stream.resume();}
        });
        extract.on('finish',()=>{
            if(!result.packageManifest)return reject(new Error('Source archive has no root package.json'));
            resolve(result);
        });
        gunzip.pipe(extract);
        gunzip.end(bytes);
    });
}
async function stage(root, destination, fetcher=fetch) {
    const lockBytes = fs.readFileSync(path.join(root,'package-lock.json'));
    const lock = JSON.parse(lockBytes);
    if (!lock.packages) throw new Error('Lockfile packages map required');
    const entries = Object.entries(lock.packages).filter(([,p]) => /^git\+/.test(p.resolved || ''))
        .map(([location,p]) => ({location,version:p.version,resolved:p.resolved,...pinnedArchive(p.resolved)}));
    if (!entries.length) throw new Error('No pinned Git dependencies');
    if (fs.existsSync(destination)) throw new Error('Output must be new; refusing overwrite');
    fs.mkdirSync(destination);
    const report = {scope:'Pinned upstream source downloads, not complete corresponding source or publication approval',
        lockfileSha256:hash(lockBytes),archives:[]};
    for (const entry of entries) {
        const response = await fetcher(entry.url,{redirect:'error',signal:AbortSignal.timeout(120000)});
        if (!response.ok) throw new Error(`Source download failed: ${entry.repo} ${response.status}`);
        const chunks=[];
        let size=0;
        for await (const chunk of response.body) {
            size+=chunk.length;
            if (size>128*1024*1024) throw new Error('Source archive exceeds review size limit');
            chunks.push(chunk);
        }
        const bytes=Buffer.concat(chunks);
        if(bytes[0]!==0x1f || bytes[1]!==0x8b) throw new Error('Source endpoint did not return gzip');
        const inspected=await inspectArchive(bytes,entry);
        const filename=`${entry.owner}-${entry.repo}-${entry.revision}.tar.gz`;
        const file=path.join(destination,filename);
        fs.writeFileSync(file,bytes,{flag:'wx'});
        if(hash(fs.readFileSync(file))!==hash(bytes)) throw new Error('Archive write verification failed');
        report.archives.push({...entry,file:filename,bytes:size,sha256:hash(bytes),inspected,
            role:entry.location==='node_modules/scratch-blocks' ?
                'Locked upstream reference ONLY; the actual build uses the separately packaged modified Blocks source' :
                'Locked upstream source; source-to-installed/build correspondence still requires review'});
        // Preserve progress for an interrupted download without implying completion.
        fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify({...report,complete:false},null,2));
    }
    report.complete=true;
    fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(report,null,2));
    return report;
}
if(require.main===module){
    const args=process.argv.slice(2);
    if(args.length!==2)throw new Error('Usage: release-git-dependency-stage.cjs root new-output');
    stage(...args).then(r=>console.log(JSON.stringify({archives:r.archives.length,bytes:r.archives.reduce((n,a)=>n+a.bytes,0),complete:r.complete})))
        .catch(e=>{console.error(e);process.exitCode=1;});
}
module.exports={pinnedArchive,inspectArchive,stage};
