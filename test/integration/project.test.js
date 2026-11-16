'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const T=require('../../src/model/time');
const {createProject}=require('../../src/model/project');
const {saveProject,loadProject,relinkAsset}=require('../../src/model/storage');
test('project round trip, missing and changed media, invalid file and safe save',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'project-test-'));
 try {
  const media=path.join(dir,'원본.webm'), file=path.join(dir,'edit.json'); await fs.writeFile(media,'media'); const stat=await fs.stat(media);
  const p=createProject({width:640,height:480,fps:T.rational(30),sampleRate:48000,channels:2});
  p.assets.push({id:'a',uri:'원본.webm',duration:T.rational(1),fingerprint:{size:String(stat.size),modified:stat.mtimeMs},streams:[{index:0,kind:'video'}]});
  await saveProject(file,p); let loaded=await loadProject(file); assert.deepEqual(loaded.project,p); assert.equal(loaded.assets[0].status,'available');
  await assert.rejects(saveProject(media,p),/media source/); assert.equal(await fs.readFile(media,'utf8'),'media');
  await fs.writeFile(media,'changed'); loaded=await loadProject(file); assert.equal(loaded.assets[0].status,'changed');
  await fs.unlink(media); loaded=await loadProject(file); assert.equal(loaded.assets[0].status,'missing');
  const replacement=path.join(dir,'replacement.webm'); await fs.writeFile(replacement,'new');
  await assert.rejects(relinkAsset(file,p,'a',replacement,async()=>({duration:T.rational(1),streams:[]})),/streams/);
  const relinked=await relinkAsset(file,p,'a',replacement,async()=>({duration:T.rational(1),streams:[{index:0,kind:'video'}]}));
  assert.equal(relinked.assets[0].uri,'replacement.webm'); assert.equal(p.assets[0].uri,'원본.webm');
  await saveProject(file,relinked); assert.equal((await loadProject(file)).assets[0].status,'available');
  await fs.writeFile(file,'{"version":99}'); await assert.rejects(loadProject(file),/version/); assert.equal(await fs.readFile(file,'utf8'),'{"version":99}');
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
