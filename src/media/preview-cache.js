'use strict';
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { runTool } = require('./engine');

const PNG = Buffer.from([137,80,78,71,13,10,26,10]);
const VERSION = 1;
const LIMIT = 64 * 1024 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;
function cancelled(signal) { if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code:'CANCELLED' }); }
async function signature(file) { const s=await fs.stat(file); if (!s.isFile()) throw new Error('Media is not a file'); return { size:String(s.size), modified:s.mtimeMs }; }
function same(a,b) { return a.size===b.size && a.modified===b.modified; }

class PreviewCache {
  constructor(directory, { maxBytes=LIMIT } = {}) {
    if (!path.isAbsolute(directory) || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid cache configuration');
    this.directory=directory; this.maxBytes=maxBytes; this.queue=Promise.resolve();
  }
  get(options) {
    const task=this.queue.then(() => this.generate(options));
    this.queue=task.catch(() => {});
    return task;
  }
  async evict() {
    const files=[];
    for (const entry of await fs.readdir(this.directory,{withFileTypes:true})) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.png$/.test(entry.name)) continue;
      const filename=path.join(this.directory,entry.name);
      try { const stat=await fs.stat(filename); files.push({filename,size:stat.size,time:stat.mtimeMs}); } catch (error) { if (error.code!=='ENOENT') throw error; }
    }
    let total=files.reduce((n,file)=>n+file.size,0);
    for (const file of files.sort((a,b)=>a.time-b.time)) {
      if (total<=this.maxBytes) break;
      try { await fs.unlink(file.filename); total-=file.size; } catch(error) { if (error.code!=='ENOENT') throw error; }
    }
  }
  async generate({file, fingerprint, stream, kind, ffmpeg='ffmpeg', signal}) {
    if (!path.isAbsolute(file) || !Number.isSafeInteger(stream) || stream<0 || !['thumbnail','waveform'].includes(kind)) throw new Error('Invalid preview request');
    cancelled(signal);
    if (!same(await signature(file),fingerprint)) throw new Error('Media changed');
    await fs.mkdir(this.directory,{recursive:true});
    const version=(await runTool(ffmpeg,['-version'],{signal})).stdout;
    const key=crypto.createHash('sha256').update(JSON.stringify({file:path.resolve(file),fingerprint,stream,kind,version:VERSION,engine:version,ffmpeg})).digest('hex');
    const destination=path.join(this.directory,`${key}.png`);
    try {
      const stat=await fs.lstat(destination);
      if (!stat.isFile() || stat.size>MAX_IMAGE) throw new Error('Invalid cache entry');
      const data=await fs.readFile(destination);
      if (!data.subarray(0,8).equals(PNG)) throw new Error('Invalid cache entry');
      if (!same(await signature(file),fingerprint)) throw new Error('Media changed');
      cancelled(signal);
      const now=new Date(); await fs.utimes(destination,now,now);
      await this.evict();
      return {data, cached:true};
    } catch(error) {
      if (error.code==='CANCELLED' || error.message==='Media changed') throw error;
      if (error.code !== 'ENOENT' && error.message !== 'Invalid cache entry') throw error;
      if (error.message==='Invalid cache entry') await fs.rm(destination,{force:true});
    }
    const temporary=path.join(this.directory,`.${crypto.randomUUID()}.png`);
    try {
      const args=['-v','error','-i',file];
      if (kind==='thumbnail') args.push('-map',`0:${stream}`,'-vf','scale=160:90:force_original_aspect_ratio=decrease','-frames:v','1','-an');
      else args.push('-filter_complex',`[0:${stream}]showwavespic=s=480x64:colors=white[v]`,'-map','[v]','-frames:v','1');
      args.push('-f','image2','-vcodec','png','-y',temporary);
      await runTool(ffmpeg,args,{signal,timeoutMs:120000});
      const stat=await fs.stat(temporary);
      if (stat.size>MAX_IMAGE) throw new Error('Preview too large');
      const data=await fs.readFile(temporary);
      if (!data.subarray(0,8).equals(PNG)) throw new Error('Invalid preview image');
      if (!same(await signature(file),fingerprint)) throw new Error('Media changed');
      cancelled(signal);
      if (data.length<=this.maxBytes) { await fs.rename(temporary,destination); await this.evict(); }
      return {data,cached:false};
    } finally { await fs.rm(temporary,{force:true}); }
  }
}
module.exports={PreviewCache};
