'use strict';
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { runTool } = require('./engine');
const { decimalTime } = require('./probe');
const { compare } = require('../model/time');

async function indexFrames(file, stream, ffprobe = 'ffprobe', signal) {
  if (!path.isAbsolute(file) || !Number.isSafeInteger(stream) || stream < 0) throw new Error('Invalid media stream');
  const result = await runTool(ffprobe, ['-v','error','-select_streams',String(stream),'-show_entries','frame=key_frame,best_effort_timestamp,best_effort_timestamp_time','-of','json','-i',file], { signal, timeoutMs: 180000, maxBytes: 64 * 1024 * 1024 });
  let data;
  try { data = JSON.parse(result.stdout); } catch { throw new Error('Invalid frame index'); }
  if (!Array.isArray(data.frames) || !data.frames.length || data.frames.length > 1000000) throw new Error('Frame index is empty or too large');
  let last;
  const records = data.frames.map(frame => {
    const timestamp = frame.best_effort_timestamp_time;
    const t = decimalTime(timestamp);
    if (last && compare(t,last) <= 0) throw new Error('Frame timestamps are ambiguous');
    if (!Number.isSafeInteger(frame.best_effort_timestamp)) throw new Error('Frame timestamp is unavailable');
    last = t;
    return { time:timestamp, pts:frame.best_effort_timestamp, key:frame.key_frame === 1 };
  });
  const frames=records.map(frame => frame.time);
  frames.records=records;
  return frames;
}

async function decodeFrame(file, stream, index, destination, ffmpeg = 'ffmpeg', signal, options = {}) {
  if (!path.isAbsolute(file) || !path.isAbsolute(destination) || !Number.isSafeInteger(stream) || stream < 0 || !Number.isSafeInteger(index) || index < 0) throw new Error('Invalid frame request');
  const temp = path.join(path.dirname(destination), `.${crypto.randomUUID()}.png`);
  const records=options.records;
  let target, anchor;
  if (records && records[index] && Number.isSafeInteger(records[index].pts)) {
    target=records[index];
    for (let i=index;i>=0;i--) if (records[i].key) { anchor=records[i]; break; }
  }
  async function attempt(seek) {
    let buffered='';
    const progress = data => {
      buffered += data.toString('utf8');
      const lines=buffered.split('\n'); buffered=lines.pop().slice(-4096);
      for (const line of lines) {
        const match=line.match(/\bn:\s*\d+\s+pts:\s*(-?\d+)/);
        if (!match || !target || !options.onProgress) continue;
        const start=anchor?.pts ?? records[0].pts, span=target.pts-start;
        const value=span>0 ? Math.max(0,Math.min(99,Math.floor((Number(match[1])-start)*100/span))) : 0;
        options.onProgress(value);
      }
    };
    const args=['-v','info'];
    if (seek) args.push('-seek_timestamp','1','-ss',anchor.time);
    if (target) args.push('-copyts');
    args.push('-i',file,'-map',`0:${stream}`,'-vf',target ? `showinfo,select=eq(pts\\,${target.pts})` : `select=eq(n\\,${index})`,'-vsync','0','-frames:v','1','-an','-f','image2','-vcodec','png','-y',temp);
    await runTool(ffmpeg,args,{ signal,timeoutMs:60000,onStderr:progress,discardStderr:true });
    let data;
    try { data=await fs.readFile(temp); } catch(error) { if (error.code==='ENOENT') throw Object.assign(new Error('Frame not found'),{code:'FRAME_NOT_FOUND'}); throw error; }
    if (data.length < 8 || !data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw Object.assign(new Error('Frame not found'),{code:'FRAME_NOT_FOUND'});
    return data;
  }
  try {
    let data;
    try { data=await attempt(Boolean(anchor && target && index > 0)); }
    catch(error) {
      if (!anchor || !target || index===0 || error.code!=='FRAME_NOT_FOUND') throw error;
      await fs.rm(temp,{force:true}); anchor=undefined;
      data=await attempt(false);
    }
    if (options.onProgress) options.onProgress(100);
    return data;
  } finally { await fs.rm(temp,{force:true}); }
}
module.exports = { indexFrames, decodeFrame };
