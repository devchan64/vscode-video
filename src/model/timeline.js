'use strict';
const crypto = require('crypto');
const T = require('./time');
const { end, validateProject } = require('./project');
const zero = T.rational(0);
function frameNumber(time, fps) {
  time=T.parse(time); fps=T.parse(fps);
  const n=BigInt(time.num)*BigInt(fps.num), d=BigInt(time.den)*BigInt(fps.den);
  const value=n/d;
  if (value<0n || value>100000000n) throw new RangeError('Frame out of range');
  return Number(value);
}
function frame(value, fps) {
  if (!Number.isSafeInteger(value) || value<0 || value>100000000) throw new RangeError('Invalid frame');
  return T.frameTime(value,fps);
}
function track(kind) { return {id:crypto.randomUUID(),kind,muted:false,gain:1,clips:[]}; }
function clip(asset, stream, start, duration, linkId) {
 return {id:crypto.randomUUID(),assetId:asset.id,streamIndex:stream.index,start,sourceIn:zero,sourceOut:duration,gain:1,muted:false,fadeIn:zero,fadeOut:zero,...(linkId?{linkId}:{})};
}
function addAsset(history, assetId) {
 const project=history.snapshot(), asset=project.assets.find(a=>a.id===assetId);
 if (!asset) throw new Error('Media not found');
 const video=asset.streams.find(s=>s.kind==='video'), audio=asset.streams.find(s=>s.kind==='audio');
 if (!video && !audio) throw new Error('No supported streams');
 let videoTrack=project.tracks.find(t=>t.kind==='video');
 if (video && !videoTrack) { videoTrack=track('video'); project.tracks.push(videoTrack); }
 const timelineEnd=videoTrack?.clips.reduce((v,c)=>T.compare(end(c),v)>0?end(c):v,zero) || zero;
 const start=video ? timelineEnd : zero;
 const frames=frameNumber(asset.duration,project.settings.fps);
 if (frames<1) throw new Error('Media is shorter than one project frame');
 const duration=T.frameTime(frames,project.settings.fps), linkId=video && audio ? crypto.randomUUID() : undefined;
 if (video) videoTrack.clips.push(clip(asset,video,start,duration,linkId));
 if (audio) {
  let audioTrack=project.tracks.find(t=>t.kind==='audio' && t.clips.every(c=>T.compare(end(c),start)<=0 || T.compare(c.start,T.add(start,duration))>=0));
  if (!audioTrack) {audioTrack=track('audio');project.tracks.push(audioTrack);}
  audioTrack.clips.push(clip(asset,audio,start,duration,linkId));
 }
 validateProject(project); return history.replace(project);
}
function snapFrame(project, target, excludeId, enabled) {
 if (!enabled) return target;
 const selected=project.tracks.flatMap(t=>t.clips).find(c=>c.id===excludeId);
 let best=target, distance=4;
 for (const c of project.tracks.flatMap(t=>t.clips)) {
  if (c.id===excludeId || (selected?.linkId && selected.linkId===c.linkId)) continue;
  for (const position of [c.start,end(c)]) { const f=frameNumber(position,project.settings.fps), d=Math.abs(f-target); if(d<distance){best=f;distance=d;} }
 }
 return best;
}
function edit(history, message) {
 const p=history.snapshot();
 if (!message || message.revision!==p.revision) throw new Error('Project changed; try again');
 if (message.action==='add') return addAsset(history,message.assetId);
 if (message.action==='undo') return history.undo();
 if (message.action==='redo') return history.redo();
 if (typeof message.clipId!=='string') throw new Error('Select a clip');
 if (message.action==='delete' || message.action==='ripple') return history.dispatch({type:message.action,clipId:message.clipId});
 if (message.action==='move' || message.action==='split' || message.action==='trimStart' || message.action==='trimEnd') {
  const n=frame(message.frame,p.settings.fps);
  const target=message.action==='move' ? frame(snapFrame(p,message.frame,message.clipId,message.snap===true),p.settings.fps) : n;
  if(message.action==='move') return history.dispatch({type:'move',clipId:message.clipId,start:target});
  if(message.action==='split') return history.dispatch({type:'split',clipId:message.clipId,time:target});
  return history.dispatch({type:'trim',clipId:message.clipId,edge:message.action==='trimStart'?'start':'end',time:target});
 }
 throw new Error('Unsupported timeline action');
}
function view(history) {
 if (!history) return null;
 const project=history.snapshot(), fps=project.settings.fps;
 return {revision:project.revision,fps,canUndo:history.undoStack.length>0,canRedo:history.redoStack.length>0,tracks:project.tracks.map(t=>({id:t.id,kind:t.kind,clips:t.clips.map(c=>({id:c.id,assetId:c.assetId,linked:Boolean(c.linkId),start:frameNumber(c.start,fps),end:frameNumber(end(c),fps)}))}))};
}
module.exports={addAsset,edit,view,frameNumber,snapFrame};
