'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runTool } = require('../../src/media/engine');
const { indexFrames, decodeFrame } = require('../../src/media/frames');
test('indexes and extracts distinct frames from VFR media without changing source', async () => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'frames-test-'));
 try {
  const media=path.join(dir,'합성 source.webm'), target=path.join(dir,'frame.png');
  await runTool('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=64x48:rate=10:duration=1','-vf',"select='not(eq(mod(n,3),1))'",'-vsync','vfr','-c:v','libvpx-vp9','-lossless','1','-y',media]);
  const before=await fs.readFile(media), frames=await indexFrames(media,0);
  assert.ok(frames.length >= 5); assert.notEqual(Number(frames[2])-Number(frames[1]),Number(frames[1])-Number(frames[0]));
  const first=await decodeFrame(media,0,0,target), third=await decodeFrame(media,0,2,target);
  assert.notDeepEqual(first,third); assert.deepEqual(first.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
  assert.deepEqual(await fs.readFile(media),before);
  await assert.rejects(decodeFrame(media,0,999,target));
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
test('keyframe seeks match sequential decoding across fractional CFR and VFR timestamps', { timeout: 60000 }, async () => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'frames-seek-'));
 try {
  for (const variant of ['fractional','vfr','offset']) {
   const media=path.join(dir,variant+'.webm'), dest=path.join(dir,'frame.png');
   const args=['-v','error','-f','lavfi','-i','testsrc2=size=96x64:rate=30000/1001:duration=15'];
   if (variant==='vfr') args.push('-vf',"select='not(eq(mod(n,4),1))'",'-vsync','vfr');
   if (variant==='offset') args.push('-output_ts_offset','5');
   args.push('-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-g','30','-y',media);
   await runTool('ffmpeg',args,{timeoutMs:30000});
   const frames=await indexFrames(media,0); assert.ok(frames.length>250);
   const keys=frames.records.map((f,i)=>f.key?i:-1).filter(i=>i>0);
   assert.ok(keys.length>1);
   for (const n of [0,1,keys[0],keys[0]+1,frames.length-2]) {
    const progress=[];
    const actual=await decodeFrame(media,0,n,dest,'ffmpeg',undefined,{records:frames.records,onProgress:value=>progress.push(value)});
    const expected=await decodeFrame(media,0,n,dest);
    assert.deepEqual(actual,expected,`${variant} frame ${n}`);
    assert.equal(progress.at(-1),100);
   }
  }
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
test('falls back when a bad seek anchor cannot reach the requested frame', async () => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'frames-fallback-'));
 try {
  const media=path.join(dir,'source.webm'), dest=path.join(dir,'frame.png');
  await runTool('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=64x48:rate=10:duration=3','-c:v','libvpx-vp9','-g','10','-y',media]);
  const frames=await indexFrames(media,0);
  const records=frames.records.map(record=>({...record}));
  records[10].key=true; records[10].time='2.9';
  const expected=await decodeFrame(media,0,12,dest);
  const actual=await decodeFrame(media,0,12,dest,'ffmpeg',undefined,{records});
  assert.deepEqual(actual,expected);
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test('aborting a running decode removes its temporary file', {skip:process.platform === 'win32'}, async () => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'frames-cancel-'));
 try {
  const fake=path.join(dir,'slow-ffmpeg');
  await fs.writeFile(fake,`#!${process.execPath}\nsetTimeout(() => {}, 10000);\n`); await fs.chmod(fake,0o755);
  const controller=new AbortController();
  const task=decodeFrame(path.join(dir,'source.webm'),0,0,path.join(dir,'frame.png'),fake,controller.signal);
  setTimeout(()=>controller.abort(),50);
  await assert.rejects(task,{code:'CANCELLED'});
  assert.deepEqual(await fs.readdir(dir),['slow-ffmpeg']);
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
