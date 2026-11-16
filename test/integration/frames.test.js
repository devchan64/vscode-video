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
