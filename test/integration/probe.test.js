'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runTool } = require('../../src/media/engine');
const { probeMedia } = require('../../src/media/probe');
const { rational } = require('../../src/model/time');
test('ffprobe reads real media and rejects invalid input', async () => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'probe-test-'));
 try {
  const media=path.join(dir,'영상 file.webm');
  await runTool('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=64x48:rate=10:duration=1','-c:v','libvpx-vp9','-y',media]);
  const result=await probeMedia(media); assert.deepEqual(result.duration,rational(1)); assert.equal(result.streams[0].kind,'video'); assert.equal(result.streams[0].codec,'vp9');
  const bad=path.join(dir,'bad.webm'); await fs.writeFile(bad,'invalid'); await assert.rejects(probeMedia(bad));
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
test('relink checks real probe metadata and preserves project on mismatch', async () => {
 const { createProject }=require('../../src/model/project');
 const { relinkAsset }=require('../../src/model/storage');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'relink-probe-'));
 try {
  const video=path.join(dir,'replacement.webm');
  await runTool('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=64x48:rate=10:duration=1','-c:v','libvpx-vp9','-y',video]);
  const p=createProject({width:640,height:480,fps:rational(30),sampleRate:48000,channels:2});
  p.assets.push({id:'a',uri:'missing.webm',duration:rational(1),fingerprint:{size:'1',modified:0},streams:[{index:0,kind:'audio'}]});
  const before=JSON.stringify(p);
  await assert.rejects(relinkAsset(path.join(dir,'p.json'),p,'a',video,probeMedia),/streams/);
  assert.equal(JSON.stringify(p),before);
  p.assets[0].streams=[{index:0,kind:'video'}];
  const updated=await relinkAsset(path.join(dir,'p.json'),p,'a',video,probeMedia);
  assert.equal(updated.assets[0].streams[0].codec,'vp9'); assert.equal(p.assets[0].uri,'missing.webm');
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
