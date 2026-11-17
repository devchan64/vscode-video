'use strict';
const fs=require('fs/promises');
const path=require('path');
const { runTool }=require('./engine');
const { validateProject,end }=require('../model/project');
const T=require('../model/time');

const zero=T.rational(0);
function seconds(t) { t=T.parse(t); return Number(t.num)/Number(t.den); }
function num(n) { if (!Number.isFinite(n) || n<0 || n>86400) throw new Error('Invalid preview time'); return n.toFixed(9); }
function normalizedStreamStart(asset, stream) {
 const starts=asset.streams.map(s=>{try {return Number(s.startTime);}catch{return NaN;}}).filter(Number.isFinite);
 const start=Number(stream.startTime), container=Number(asset.startTime);
 const origin=asset.startTime !== undefined && Number.isFinite(container) ? container : starts.length ? Math.min(...starts) : 0;
 return Number.isFinite(start) ? Math.max(0,start-origin) : 0;
}
async function renderTimeline(project, destination, resolveAsset, {ffmpeg='ffmpeg',signal,onProgress}={}) {
 validateProject(project);
 if (!path.isAbsolute(destination) || typeof resolveAsset !== 'function') throw new Error('Invalid preview output');
 const clips=project.tracks.flatMap(track=>track.clips.map(clip=>({track,clip})));
 if (!clips.length) throw new Error('Timeline has no clips');
 const duration=clips.reduce((max,{clip})=>Math.max(max,seconds(end(clip))),0);
 if (!(duration>0) || duration>30) throw new Error('Preview supports timelines up to 30 seconds');
 const fps=project.settings.fps;
 if (clips.length>200 || Math.ceil(duration*Number(fps.num)/Number(fps.den))>1800) throw new Error('Preview frame or clip limit exceeded');
 let width=Math.min(project.settings.width,1280); let height=Math.round(width*project.settings.height/project.settings.width);
 if (height>720) { width=Math.round(width*720/height); height=720; }
 width=Math.max(2,Math.floor(width/2)*2); height=Math.max(2,Math.floor(height/2)*2);
 const args=['-hide_banner','-loglevel','info','-progress','pipe:2','-nostats','-f','lavfi','-i',`color=c=black:s=${width}x${height}:r=${fps.num}/${fps.den}:d=${num(duration)}`,'-f','lavfi','-i',`anullsrc=r=${project.settings.sampleRate}:cl=stereo:d=${num(duration)}`];
 const used=[...new Set(clips.map(({clip})=>clip.assetId))];
 const inputs=new Map(); const checks=[];
 for (const [i,id] of used.entries()) {
  const asset=project.assets.find(a=>a.id===id), file=resolveAsset(asset);
  if (!path.isAbsolute(file) || path.resolve(file)===path.resolve(destination)) throw new Error('Invalid media path');
  const stat=await fs.stat(file);
  if (!stat.isFile() || String(stat.size)!==asset.fingerprint.size || stat.mtimeMs!==asset.fingerprint.modified) throw new Error('Media missing or changed');
  checks.push({file,asset}); inputs.set(id,i+2); args.push('-protocol_whitelist','file,pipe','-i',file);
 }
 const filters=['[0:v]null[base]']; let video='base'; let vcount=0, acount=0; const audios=['1:a'];
 for (const {track,clip} of clips) {
  const input=inputs.get(clip.assetId), start=seconds(clip.start), sourceIn=seconds(clip.sourceIn), sourceOut=seconds(clip.sourceOut), length=sourceOut-sourceIn;
  const asset=project.assets.find(a=>a.id===clip.assetId), stream=asset.streams.find(s=>s.index===clip.streamIndex);
  if (track.kind==='video') {
   const name=`v${vcount}`, out=`base${vcount++}`;
   filters.push(`[${input}:${clip.streamIndex}]trim=start=${num(sourceIn)}:end=${num(sourceOut)},setpts=PTS-${num(sourceIn)}/TB+${num(start)}/TB,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black[${name}]`);
   filters.push(`[${video}][${name}]overlay=eof_action=pass:shortest=0:enable='gte(t,${num(start)})*lt(t,${num(start+length)})'[${out}]`); video=out;
  } else if (!track.muted && !clip.muted && track.gain && clip.gain) {
   const offset=Math.max(0,normalizedStreamStart(asset,stream)-sourceIn), delay=Math.max(0,Math.ceil(offset*project.settings.sampleRate)), startDelay=Number(T.sampleCeil(clip.start,project.settings.sampleRate));
   const name=`a${acount++}`, parts=[`[${input}:${clip.streamIndex}]atrim=start=${num(sourceIn)}:end=${num(sourceOut)}`,'asetpts=PTS-STARTPTS',`aresample=${project.settings.sampleRate}`,'aformat=sample_fmts=fltp:channel_layouts=stereo'];
   if (delay) parts.push(`adelay=${delay}S:all=1`);
   parts.push('apad',`atrim=duration=${num(length)}`);
   const fadeIn=seconds(clip.fadeIn),fadeOut=seconds(clip.fadeOut);
   if (fadeIn>0) parts.push(`afade=t=in:st=0:d=${num(fadeIn)}`);
   if (fadeOut>0) parts.push(`afade=t=out:st=${num(Math.max(0,length-fadeOut))}:d=${num(fadeOut)}`);
   parts.push(`volume=${num(track.gain*clip.gain)}`);
   if (startDelay) parts.push(`adelay=${startDelay}S:all=1`);
   filters.push(parts.join(',')+`[${name}]`); audios.push(name);
  }
 }
 filters.push(`${audios.map(a=>`[${a}]`).join('')}amix=inputs=${audios.length}:duration=first:normalize=0,astats=metadata=0:reset=0,aeval=clip(val(0)\\,-1\\,1)|clip(val(1)\\,-1\\,1)[audio]`);
 args.push('-filter_complex',filters.join(';'),'-map',`[${video}]`,'-map','[audio]','-t',num(duration),'-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-threads','2','-b:v','1200k','-pix_fmt','yuv420p','-c:a','libopus','-b:a','128k','-y',destination);
 let pending='', clipped=false;
 try {
  await runTool(ffmpeg,args,{signal,timeoutMs:180000,discardStderr:true,onStderr:data=>{pending+=data.toString();const lines=pending.split('\n');pending=lines.pop().slice(-4096);for(const line of lines){const m=line.match(/^out_time_(?:ms|us)=(\d+)/);if(m&&onProgress) onProgress(Math.min(99,Math.floor(Number(m[1])/1000000/duration*100)));const peak=line.match(/Peak level dB:\s*(-?\d+(?:\.\d+)?)/);if(peak && Number(peak[1])>0) clipped=true;}}});
  for(const {file,asset} of checks){const s=await fs.stat(file);if(String(s.size)!==asset.fingerprint.size || s.mtimeMs!==asset.fingerprint.modified) throw new Error('Media changed while rendering');}
  if (onProgress) onProgress(100);
  return {duration,width,height,clipped};
 } catch(error) { await fs.rm(destination,{force:true}); throw error; }
}
async function preparePlayback(file, directory, {ffmpeg='ffmpeg',signal}={}) {
 if (!path.isAbsolute(file) || !path.isAbsolute(directory)) throw new Error('Invalid preview path');
 const temp=await fs.mkdtemp(path.join(directory,'preview-frames-'));
 try {
  await runTool(ffmpeg,['-v','error','-i',file,'-map','0:v:0','-vf','scale=640:360:force_original_aspect_ratio=decrease','-vsync','0','-q:v','7','-y',path.join(temp,'%06d.jpg')],{signal,timeoutMs:180000});
  const wav=path.join(temp,'audio.wav');
  await runTool(ffmpeg,['-v','error','-i',file,'-map','0:a:0','-ac','2','-ar','48000','-c:a','pcm_s16le','-y',wav],{signal,timeoutMs:180000});
  const names=(await fs.readdir(temp)).filter(name=>/^\d{6}\.jpg$/.test(name)).sort();
  if (!names.length || names.length>1800) throw new Error('Preview frame limit exceeded');
  const files=[...names.map(name=>path.join(temp,name)),wav];
  let size=0; for(const item of files) size+=(await fs.stat(item)).size;
  if(size>32*1024*1024) throw new Error('Preview exceeds the 32 MiB memory limit');
  const frames=[]; for(const item of files.slice(0,-1)) { if(signal?.aborted) throw Object.assign(new Error('Cancelled'),{code:'CANCELLED'}); frames.push((await fs.readFile(item)).toString('base64')); }
  return {frames,audio:(await fs.readFile(wav)).toString('base64')};
 } finally {await fs.rm(temp,{recursive:true,force:true});}
}
module.exports={renderTimeline,preparePlayback,normalizedStreamStart};
