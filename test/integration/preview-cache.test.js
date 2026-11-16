'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runTool } = require('../../src/media/engine');
const { PreviewCache } = require('../../src/media/preview-cache');
async function fingerprint(file) { const stat=await fs.stat(file); return {size:String(stat.size),modified:stat.mtimeMs}; }
test('thumbnail and waveform cache reuse, invalidation, corruption and bounded eviction', {timeout:60000}, async () => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'video-preview-test-'));
 try {
  const media=path.join(dir,'source.webm'), cacheDir=path.join(dir,'cache');
  await runTool('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=64x48:rate=10:duration=1','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-c:v','libvpx-vp9','-c:a','libopus','-shortest','-y',media]);
  const sourceBefore=await fs.readFile(media), fp=await fingerprint(media), cache=new PreviewCache(cacheDir,{maxBytes:200000});
  const thumbnail={file:media,fingerprint:fp,stream:0,kind:'thumbnail'}, waveform={file:media,fingerprint:fp,stream:1,kind:'waveform'};
  const a=await cache.get(thumbnail), b=await cache.get(waveform);
  assert.equal(a.cached,false); assert.equal(b.cached,false); assert.ok(a.data.length>8 && b.data.length>8);
  const hit=await cache.get(thumbnail); assert.equal(hit.cached,true); assert.deepEqual(hit.data,a.data);
  assert.deepEqual(await fs.readFile(media),sourceBefore);
  const names=await fs.readdir(cacheDir); assert.equal(names.length,2);
  for (const name of names) await fs.writeFile(path.join(cacheDir,name),'corrupt');
  assert.equal((await cache.get(thumbnail)).cached,false);
  await fs.appendFile(media,'x'); await assert.rejects(cache.get(thumbnail),/Media changed/);
  const fresh={...thumbnail,fingerprint:await fingerprint(media)}; assert.equal((await cache.get(fresh)).cached,false);
  const lruDir=path.join(dir,'lru'); const lru=new PreviewCache(lruDir,{maxBytes:Math.max(a.data.length,b.data.length)+1});
  await lru.get({...thumbnail,fingerprint:fresh.fingerprint}); await lru.get({...waveform,fingerprint:fresh.fingerprint});
  assert.equal((await fs.readdir(lruDir)).length,1);
  assert.equal((await lru.get({...thumbnail,fingerprint:fresh.fingerprint})).cached,false);
  const bounded=new PreviewCache(path.join(dir,'small'),{maxBytes:1}); await bounded.get(fresh); assert.equal((await fs.readdir(path.join(dir,'small'))).length,0);
  await assert.rejects(cache.get({...fresh,stream:99}));
  assert.equal((await fs.readdir(cacheDir)).some(name=>name.startsWith('.')),false);
  const controller=new AbortController(); controller.abort(); await assert.rejects(cache.get({...fresh,signal:controller.signal}),{code:'CANCELLED'});
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
