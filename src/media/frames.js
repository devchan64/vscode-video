'use strict';
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { runTool } = require('./engine');
const { decimalTime } = require('./probe');
const { compare } = require('../model/time');

async function indexFrames(file, stream, ffprobe = 'ffprobe', signal) {
  if (!path.isAbsolute(file) || !Number.isSafeInteger(stream) || stream < 0) throw new Error('Invalid media stream');
  const result = await runTool(ffprobe, ['-v','error','-select_streams',String(stream),'-show_entries','frame=best_effort_timestamp_time','-of','json','-i',file], { signal, timeoutMs: 60000, maxBytes: 16 * 1024 * 1024 });
  let data;
  try { data = JSON.parse(result.stdout); } catch { throw new Error('Invalid frame index'); }
  if (!Array.isArray(data.frames) || !data.frames.length || data.frames.length > 200000) throw new Error('Frame index is empty or too large');
  let last;
  return data.frames.map(frame => {
    const timestamp = frame.best_effort_timestamp_time;
    const t = decimalTime(timestamp);
    if (last && compare(t,last) <= 0) throw new Error('Frame timestamps are ambiguous');
    last = t; return timestamp;
  });
}
async function decodeFrame(file, stream, index, destination, ffmpeg = 'ffmpeg', signal) {
  if (!path.isAbsolute(file) || !path.isAbsolute(destination) || !Number.isSafeInteger(stream) || stream < 0 || !Number.isSafeInteger(index) || index < 0) throw new Error('Invalid frame request');
  const temp = path.join(path.dirname(destination), `.${crypto.randomUUID()}.png`);
  try {
    await runTool(ffmpeg, ['-v','error','-i',file,'-map',`0:${stream}`,'-vf',`select=eq(n\\,${index})`,'-vsync','0','-frames:v','1','-an','-f','image2','-vcodec','png','-y',temp], { signal, timeoutMs: 60000 });
    const data = await fs.readFile(temp);
    if (data.length < 8 || !data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Frame not found');
    return data;
  } finally { await fs.rm(temp,{force:true}); }
}
module.exports = { indexFrames, decodeFrame };
