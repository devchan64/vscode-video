'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {runTool}=require('../../src/media/engine');
const {probeMedia}=require('../../src/media/probe');
const {renderTimeline,preparePlayback}=require('../../src/media/timeline-preview');
const {createProject}=require('../../src/model/project');
const {rational:t}=require('../../src/model/time');
function clip(id,stream,start,input,output,gain=1) {return {id,assetId:'a',streamIndex:stream,start,sourceIn:input,sourceOut:output,gain,muted:false,fadeIn:t(0),fadeOut:t(0)};}
test('timeline video gap and mixed audio are rendered and can be muted', {timeout:60000}, async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'timeline-render-'));
 try {
  const source=path.join(dir,'source.webm');
  await runTool('ffmpeg',['-v','error','-f','lavfi','-i','color=red:s=64x48:r=10:d=1','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-c:v','libvpx-vp9','-c:a','libopus','-shortest','-y',source]);
  const info=await probeMedia(source),stat=await fs.stat(source);
  const p=createProject({width:64,height:48,fps:t(10),sampleRate:48000,channels:2});
  p.assets.push({id:'a',uri:source,duration:info.duration,streams:info.streams,fingerprint:{size:String(stat.size),modified:stat.mtimeMs}});
  p.tracks.push({id:'v',kind:'video',gain:1,muted:false,clips:[clip('v1',0,t(0),t(0),t(4,10)),clip('v2',0,t(6,10),t(6,10),t(1))]});
  p.tracks.push({id:'a1',kind:'audio',gain:1,muted:false,clips:[clip('a1',1,t(0),t(0),t(1),0.5)]});
  p.tracks.push({id:'a2',kind:'audio',gain:1,muted:false,clips:[clip('a2',1,t(0),t(0),t(1),0.25)]});
  const output=path.join(dir,'preview.webm'); const progress=[];
  const rendered=await renderTimeline(p,output,()=>source,{onProgress:value=>progress.push(value)});
  assert.equal(rendered.clipped,false);
  assert.equal(progress.at(-1),100);
  const playback=await preparePlayback(output,dir);
  assert.equal(playback.frames.length,10);
  assert.equal(Buffer.from(playback.frames[0],'base64').readUInt16BE(0),0xffd8);
  assert.equal(Buffer.from(playback.audio,'base64').toString('ascii',0,4),'RIFF');
  assert.ok(!(await fs.readdir(dir)).some(name=>name.startsWith('preview-frames-')));
  const sample=async time=>{const raw=path.join(dir,`f${time}.rgb`);await runTool('ffmpeg',['-v','error','-ss',String(time),'-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-y',raw]); return fs.readFile(raw);};
  const red=await sample(.2), black=await sample(.5);
  assert.ok(red[0]>150 && red[1]<80,`red ${red.subarray(0,3)}`);
  assert.ok(black[0]<20 && black[1]<20 && black[2]<20,`black ${black.subarray(0,3)}`);
  const rms=async()=>{const raw=path.join(dir,'audio.raw');await runTool('ffmpeg',['-v','error','-i',output,'-map','0:a:0','-f','s16le','-acodec','pcm_s16le','-y',raw]); const b=await fs.readFile(raw);let sum=0; for(let i=0;i<b.length;i+=2){const x=b.readInt16LE(i)/32768;sum+=x*x;}return Math.sqrt(sum/(b.length/2));};
  const mixed=await rms();p.tracks[2].muted=true;await renderTimeline(p,output,()=>source);const single=await rms();
  assert.ok(mixed>single*1.35 && mixed<single*1.65,`mixed=${mixed} single=${single}`);
  p.tracks[1].muted=true;await renderTimeline(p,output,()=>source);assert.ok((await rms())<0.001);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('delayed audio and fades follow the timeline and high mixed gain remains bounded', {timeout:60000}, async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'timeline-delay-'));
 try {
  const source=path.join(dir,'delayed.webm');
  await runTool('ffmpeg',['-v','error','-f','lavfi','-i','color=blue:s=64x48:r=10:d=1.2','-itsoffset','0.3','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.9','-c:v','libvpx-vp9','-c:a','libopus','-y',source]);
  const info=await probeMedia(source),stat=await fs.stat(source);
  const p=createProject({width:64,height:48,fps:t(10),sampleRate:48000,channels:2});
  p.assets.push({id:'a',uri:source,duration:info.duration,startTime:info.startTime,streams:info.streams,fingerprint:{size:String(stat.size),modified:stat.mtimeMs}});
  p.tracks.push({id:'v',kind:'video',gain:1,muted:false,clips:[clip('v',0,t(0),t(0),t(1))]});
  const a=clip('a',1,t(0),t(0),t(1),4); a.fadeIn=t(5,10);
  p.tracks.push({id:'a',kind:'audio',gain:1,muted:false,clips:[a]});
  const output=path.join(dir,'preview.webm'); await renderTimeline(p,output,()=>source);
  const raw=path.join(dir,'audio.raw'); await runTool('ffmpeg',['-v','error','-i',output,'-map','0:a:0','-f','s16le','-acodec','pcm_s16le','-y',raw]);
  const data=await fs.readFile(raw);
  const rms=(a,b)=>{let n=0,total=0;for(let i=Math.floor(a*48000)*4;i<Math.min(data.length,Math.floor(b*48000)*4);i+=2){const x=data.readInt16LE(i)/32768;total+=x*x;n++;}return Math.sqrt(total/n);};
  assert.ok(rms(.02,.2)<0.005,`early audio ${rms(.02,.2)}`);
  assert.ok(rms(.6,.8)>0.1,`active audio ${rms(.6,.8)}`);
  assert.ok(rms(.32,.38)<rms(.6,.8),`fade ${rms(.32,.38)} vs ${rms(.6,.8)}`);
  p.tracks.push({id:'a2',kind:'audio',gain:4,muted:false,clips:[clip('a2',1,t(0),t(0),t(1),4)]});
  const clipped=await renderTimeline(p,output,()=>source);
  assert.equal(clipped.clipped,true);
  const float=path.join(dir,'clip.raw'); await runTool('ffmpeg',['-v','error','-i',output,'-map','0:a:0','-f','f32le','-acodec','pcm_f32le','-y',float]);
  const samples=await fs.readFile(float); let peak=0; for(let i=0;i<samples.length;i+=4) peak=Math.max(peak,Math.abs(samples.readFloatLE(i)));
  assert.ok(peak>0.8 && peak<1.15,`lossy codec peak ${peak}`);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
