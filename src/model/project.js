'use strict';
const crypto = require('crypto');
const T = require('./time');
const zero = T.rational(0);
const copy = value => structuredClone(value);
const fail = message => { throw new Error(message); };
const end = clip => T.add(clip.start, T.sub(clip.sourceOut, clip.sourceIn));
const positiveTime = value => T.compare(value, zero) >= 0;
function validateProject(p) {
  if (!p || p.version !== 1) fail('Unsupported project version');
  if (typeof p.id !== 'string' || !p.id || !Number.isSafeInteger(p.revision) || p.revision < 0) fail('Invalid project');
  const s = p.settings;
  if (!s || !Number.isSafeInteger(s.width) || s.width < 1 || !Number.isSafeInteger(s.height) || s.height < 1 || !Number.isSafeInteger(s.sampleRate) || s.sampleRate < 1 || s.channels !== 2 || T.compare(s.fps, zero) <= 0) fail('Invalid settings');
  if (!Array.isArray(p.assets) || !Array.isArray(p.tracks)) fail('Invalid project collections');
  const assets = new Map(), trackIds = new Set(), clipIds = new Set(), links = new Map();
  for (const a of p.assets) {
    if (!a || typeof a.id !== 'string' || !a.id || assets.has(a.id) || typeof a.uri !== 'string' || !a.uri || !Array.isArray(a.streams) || !a.fingerprint || !/^\d+$/.test(a.fingerprint.size) || !Number.isFinite(a.fingerprint.modified) || !a.duration || T.compare(a.duration, zero) <= 0) fail('Invalid asset');
    if (new Set(a.streams.map(x => x.index)).size !== a.streams.length || a.streams.some(x => !Number.isSafeInteger(x.index) || x.index < 0 || !['video','audio'].includes(x.kind))) fail('Invalid streams');
    assets.set(a.id, a);
  }
  if (p.tracks.filter(t => t.kind === 'video').length > 1) fail('Too many video tracks');
  for (const track of p.tracks) {
    if (!track || !['video','audio'].includes(track.kind) || typeof track.id !== 'string' || !track.id || trackIds.has(track.id) || !Array.isArray(track.clips) || typeof track.muted !== 'boolean' || !Number.isFinite(track.gain) || track.gain < 0) fail('Invalid track');
    trackIds.add(track.id);
    const sorted = [];
    for (const c of track.clips) {
      if (!c || typeof c.id !== 'string' || !c.id || clipIds.has(c.id) || !assets.has(c.assetId)) fail('Invalid clip');
      clipIds.add(c.id);
      const asset = assets.get(c.assetId);
      if (!asset.streams.some(x => x.index === c.streamIndex && x.kind === track.kind)) fail('Invalid clip stream');
      if (!positiveTime(c.start) || !positiveTime(c.sourceIn) || T.compare(c.sourceOut, c.sourceIn) <= 0 || T.compare(c.sourceOut, asset.duration) > 0) fail('Invalid clip range');
      const duration = T.sub(c.sourceOut, c.sourceIn);
      if (typeof c.muted !== 'boolean' || !Number.isFinite(c.gain) || c.gain < 0 || !positiveTime(c.fadeIn) || !positiveTime(c.fadeOut) || T.compare(c.fadeIn, duration) > 0 || T.compare(c.fadeOut, duration) > 0) fail('Invalid clip audio settings');
      if (c.linkId !== undefined) { if (typeof c.linkId !== 'string' || !c.linkId) fail('Invalid link'); (links.get(c.linkId) || (links.set(c.linkId, []), links.get(c.linkId))).push(c); }
      if (track.kind === 'video' && (!T.onGrid(c.start, T.frameTime(1, s.fps)) || !T.onGrid(end(c), T.frameTime(1, s.fps)))) fail('Video boundary is off frame grid');
      sorted.push(c);
    }
    sorted.sort((a,b) => T.compare(a.start,b.start));
    for (let i=1;i<sorted.length;i++) if (T.compare(sorted[i].start,end(sorted[i-1])) < 0) fail('Overlapping clips');
  }
  for (const group of links.values()) {
    if (group.length < 2 || group.some(c => T.compare(c.start,group[0].start) || T.compare(end(c),end(group[0])) || c.assetId !== group[0].assetId || T.compare(c.sourceIn,group[0].sourceIn) || T.compare(c.sourceOut,group[0].sourceOut))) fail('Invalid linked clips');
  }
  return p;
}
function createProject(settings, id = crypto.randomUUID()) { return validateProject({ version: 1, id, revision: 0, settings: copy(settings), assets: [], tracks: [] }); }
function allClips(p) { return p.tracks.flatMap(track => track.clips.map(clip => ({ track, clip }))); }
function selected(p, id) {
  const all = allClips(p), item = all.find(x => x.clip.id === id);
  if (!item) fail('Clip not found');
  return item.clip.linkId ? all.filter(x => x.clip.linkId === item.clip.linkId) : [item];
}
function grid(p, item, time) {
  const step = item.track.kind === 'video' || item.clip.linkId ? T.frameTime(1,p.settings.fps) : T.rational(1,p.settings.sampleRate);
  if (!T.onGrid(time,step)) fail('Boundary is off grid');
}
function clampFades(c) { const d = T.sub(c.sourceOut,c.sourceIn); for (const field of ['fadeIn','fadeOut']) if (T.compare(c[field],d)>0) c[field] = d; }
function apply(project, command) {
  validateProject(project); const p = copy(project);
  if (!command || typeof command.type !== 'string') fail('Invalid command');
  switch (command.type) {
    case 'addAsset': p.assets.push(copy(command.asset)); break;
    case 'addTrack': p.tracks.push(copy(command.track)); break;
    case 'addClips': {
      if (!Array.isArray(command.items) || !command.items.length) fail('Missing clips');
      for (const item of command.items) { const track = p.tracks.find(t => t.id === item.trackId); if (!track) fail('Track not found'); track.clips.push(copy(item.clip)); }
      for (const item of command.items) { const entry = allClips(p).find(x => x.clip.id === item.clip.id); grid(p,entry,entry.clip.start); grid(p,entry,end(entry.clip)); }
      break;
    }
    case 'move': {
      const group = selected(p,command.clipId), delta = T.sub(command.start,group[0].clip.start);
      for (const item of group) { const next = T.add(item.clip.start,delta); grid(p,item,next); item.clip.start = next; }
      break;
    }
    case 'trim': {
      const group = selected(p,command.clipId);
      if (!['start','end'].includes(command.edge)) fail('Invalid trim edge');
      for (const item of group) { const c=item.clip; grid(p,item,command.time); if (command.edge === 'start') { c.sourceIn = T.add(c.sourceIn,T.sub(command.time,c.start)); c.start = T.parse(command.time); } else c.sourceOut = T.add(c.sourceIn,T.sub(command.time,c.start)); clampFades(c); }
      break;
    }
    case 'split': {
      const group = selected(p,command.clipId), link = group.length > 1 ? crypto.randomUUID() : undefined;
      for (const item of group) {
        const c=item.clip; grid(p,item,command.time);
        if (T.compare(command.time,c.start)<=0 || T.compare(command.time,end(c))>=0) fail('Split outside clip');
        const at=T.add(c.sourceIn,T.sub(command.time,c.start)), right=copy(c);
        right.id=crypto.randomUUID(); right.start=T.parse(command.time); right.sourceIn=at; if (link) right.linkId=link;
        c.sourceOut=at; clampFades(c); clampFades(right); item.track.clips.push(right);
      } break;
    }
    case 'detach': {
      const group=selected(p,command.clipId); if (group.length < 2) return project;
      for (const item of group) delete item.clip.linkId; break;
    }
    case 'delete': case 'ripple': {
      let group=[]; let start, finish;
      if (command.clipId) { group=selected(p,command.clipId); start=group[0].clip.start; finish=end(group[0].clip); }
      else if (command.type === 'ripple') { start=T.parse(command.start); finish=T.parse(command.end); }
      else fail('Clip not found');
      if (command.type === 'ripple') {
        if (T.compare(start,zero)<0 || T.compare(finish,start)<=0 || !T.onGrid(start,T.frameTime(1,p.settings.fps)) || !T.onGrid(finish,T.frameTime(1,p.settings.fps))) fail('Invalid ripple range');
        const ids=new Set(group.map(x=>x.clip.id));
        for (const {clip:c} of allClips(p)) if (!ids.has(c.id) && T.compare(c.start,finish)<0 && T.compare(end(c),start)>0) fail('Ripple intersects another clip');
        const delta=T.sub(finish,start);
        for (const {clip:c} of allClips(p)) if (!ids.has(c.id) && T.compare(c.start,finish)>=0) c.start=T.sub(c.start,delta);
      }
      for (const item of group) item.track.clips=item.track.clips.filter(c=>c.id!==item.clip.id);
      break;
    }
    default: fail('Unsupported command');
  }
  validateProject(p);
  if (JSON.stringify(p) === JSON.stringify(project)) return project;
  p.revision = project.revision + 1; validateProject(p); return p;
}
class History {
  constructor(project) { validateProject(project); this.current=copy(project); this.undoStack=[]; this.redoStack=[]; this.nextRevision=project.revision+1; }
  dispatch(command) { const next=apply(this.current,command); if (next===this.current) return this.snapshot(); this.undoStack.push(this.current); this.current=next; this.current.revision=this.nextRevision++; this.redoStack=[]; return this.snapshot(); }
  replace(project) { validateProject(project); this.undoStack.push(this.current); this.current=copy(project); this.current.revision=this.nextRevision++; this.redoStack=[]; return this.snapshot(); }
  undo() { if (this.undoStack.length) { this.redoStack.push(this.current); this.current=this.undoStack.pop(); this.current.revision=this.nextRevision++; } return this.snapshot(); }
  redo() { if (this.redoStack.length) { this.undoStack.push(this.current); this.current=this.redoStack.pop(); this.current.revision=this.nextRevision++; } return this.snapshot(); }
  snapshot() { return copy(this.current); }
}
module.exports={validateProject,createProject,apply,History,end};
