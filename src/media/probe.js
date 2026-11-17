'use strict';
const path = require('path');
const { runTool } = require('./engine');
const { rational, compare } = require('../model/time');
function decimalTime(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error('Media duration is unavailable');
  const [whole, fraction = ''] = value.split('.');
  return rational(BigInt(whole + fraction), 10n ** BigInt(fraction.length));
}
async function probeMedia(file, ffprobe = 'ffprobe', options = {}) {
  if (!path.isAbsolute(file)) throw new Error('Media path must be absolute');
  if (ffprobe !== 'ffprobe' && !path.isAbsolute(ffprobe)) throw new Error('ffprobe path must be absolute');
  const result = await runTool(ffprobe, ['-v', 'error', '-show_entries', 'format=duration,start_time:stream=index,codec_type,codec_name,time_base,start_time,duration,width,height,avg_frame_rate', '-of', 'json', '-i', file], options);
  let data;
  try { data = JSON.parse(result.stdout); } catch { throw new Error('Invalid ffprobe output'); }
  const duration = decimalTime(data.format?.duration);
  if (compare(duration, rational(0)) <= 0) throw new Error('Media duration is invalid');
  const streams = (Array.isArray(data.streams) ? data.streams : []).filter(s => ['video', 'audio'].includes(s.codec_type)).map(s => ({ index: s.index, kind: s.codec_type, codec: s.codec_name, timeBase: s.time_base, startTime: s.start_time, duration: s.duration, width: s.width, height: s.height, frameRate: s.avg_frame_rate }));
  if (!streams.length || streams.some(s => !Number.isSafeInteger(s.index) || s.index < 0)) throw new Error('No valid media streams');
  return { duration, streams, startTime:data.format?.start_time };
}
module.exports = { probeMedia, decimalTime };
