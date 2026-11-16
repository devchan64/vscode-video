'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const T=require('../../src/model/time');
const {createProject,apply,History,end,validateProject}=require('../../src/model/project');
const t=(n,d=1)=>T.rational(n,d);
function base() {
  const p=createProject({width:1920,height:1080,fps:t(30),sampleRate:48000,channels:2},'project');
  p.assets.push({id:'a',uri:'original.webm',duration:t(10),fingerprint:{size:'1',modified:0},streams:[{index:0,kind:'video'},{index:1,kind:'audio'}]});
  p.tracks.push({id:'v',kind:'video',muted:false,gain:1,clips:[]},{id:'a',kind:'audio',muted:false,gain:1,clips:[]});
  return p;
}
function clip(id,stream,link='link') { return {id,assetId:'a',streamIndex:stream,start:t(0),sourceIn:t(0),sourceOut:t(3),gain:1,muted:false,fadeIn:t(0),fadeOut:t(0),...(link ? {linkId:link}: {})}; }
function populated() { return apply(base(),{type:'addClips',items:[{trackId:'v',clip:clip('v1',0)},{trackId:'a',clip:clip('a1',1)}]}); }
test('rational arithmetic and NTSC frame/sample boundaries stay exact',()=>{
  const fps=t(30000,1001); assert.deepEqual(T.frameTime(30000,fps),t(1001));
  assert.equal(T.sampleCeil(T.frameTime(1,fps),48000),1602n);
  assert.equal(T.compare(T.add(t(1,3),t(1,6)),t(1,2)),0);
  assert.throws(()=>T.parse({num:'1',den:'0'}));
});
test('linked edit operations preserve original and undo/redo',()=>{
  const original=populated(), h=new History(original), originalJson=JSON.stringify(original);
  let p=h.dispatch({type:'split',clipId:'v1',time:t(1)});
  assert.equal(p.tracks[0].clips.length,2); assert.equal(p.tracks[1].clips.length,2);
  assert.equal(p.tracks[0].clips[1].linkId,p.tracks[1].clips[1].linkId);
  p=h.dispatch({type:'move',clipId:p.tracks[0].clips[1].id,start:t(2)});
  assert.deepEqual(p.tracks[1].clips[1].start,t(2));
  const moved=JSON.stringify(p.tracks); h.undo(); p=h.redo(); assert.equal(JSON.stringify(p.tracks),moved);
  assert.equal(JSON.stringify(original),originalJson);
  assert.throws(()=>h.dispatch({type:'split',clipId:'v1',time:t(0)}));
});
test('trimming, ripple conflict, detaching and bounds are enforced',()=>{
  let p=populated(); p=apply(p,{type:'trim',clipId:'v1',edge:'end',time:t(2)});
  assert.deepEqual(end(p.tracks[1].clips[0]),t(2));
  assert.throws(()=>apply(p,{type:'trim',clipId:'v1',edge:'end',time:t(11)}));
  p=apply(p,{type:'detach',clipId:'v1'}); assert.equal(p.tracks[1].clips[0].linkId,undefined);
  assert.throws(()=>apply(p,{type:'ripple',clipId:'v1'}),/intersects/);
  p=apply(p,{type:'delete',clipId:'a1'}); p=apply(p,{type:'ripple',clipId:'v1'});
  assert.equal(p.tracks[0].clips.length,0);
  assert.throws(()=>validateProject({...p,version:9}));
});
test('ripple preserves rational audio position and rejects overlap atomically',()=>{
 let p=base(); p.settings.fps=t(30000,1001);
 p.tracks[0].clips.push({...clip('v1',0,null),sourceOut:T.frameTime(1,p.settings.fps)});
 p.tracks[1].clips.push({...clip('music',1,null),start:t(1),sourceOut:t(1)});
 validateProject(p);
 const before=JSON.stringify(p); const next=apply(p,{type:'ripple',clipId:'v1'});
 assert.deepEqual(next.tracks[1].clips[0].start,T.sub(t(1),T.frameTime(1,p.settings.fps)));
 assert.equal(JSON.stringify(p),before);
 const history=new History(p); assert.throws(()=>history.dispatch({type:'move',clipId:'v1',start:t(1,2)}));
 assert.equal(history.snapshot().revision,p.revision);
});
