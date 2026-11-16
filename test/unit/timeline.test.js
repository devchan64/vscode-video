'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createProject,History}=require('../../src/model/project');
const {rational}=require('../../src/model/time');
const {edit,view}=require('../../src/model/timeline');
function fixture() { const p=createProject({width:640,height:480,fps:rational(30),sampleRate:48000,channels:2}); p.assets.push({id:'asset',uri:'asset.webm',duration:rational(2),fingerprint:{size:'1',modified:0},streams:[{index:0,kind:'video'},{index:1,kind:'audio'}]}); return new History(p); }
test('add linked A/V, split, move, trim and undo as single edits',()=>{
 const h=fixture(); let p=edit(h,{action:'add',assetId:'asset',revision:0});
 assert.equal(p.tracks.length,2); assert.equal(p.tracks[0].clips[0].linkId,p.tracks[1].clips[0].linkId);
 let id=p.tracks[0].clips[0].id;
 p=edit(h,{action:'split',clipId:id,frame:30,revision:p.revision}); assert.equal(p.tracks[1].clips.length,2);
 id=p.tracks[0].clips[1].id;
 p=edit(h,{action:'move',clipId:id,frame:90,revision:p.revision}); assert.equal(view(h).tracks[1].clips[1].start,90);
 p=edit(h,{action:'trimEnd',clipId:id,frame:100,revision:p.revision}); assert.equal(view(h).tracks[0].clips[1].end,100);
 p=edit(h,{action:'undo',revision:p.revision}); assert.equal(view(h).tracks[0].clips[1].end,120);
 p=edit(h,{action:'redo',revision:p.revision}); assert.equal(view(h).tracks[0].clips[1].end,100);
 assert.throws(()=>edit(h,{action:'move',clipId:id,frame:0,revision:p.revision}),/Overlapping/);
 assert.throws(()=>edit(h,{action:'delete',clipId:id,revision:0}),/changed/);
});
test('frame snap uses other clip boundaries and invalid edits stay atomic',()=>{
 const h=fixture(); let p=edit(h,{action:'add',assetId:'asset',revision:0}); p=edit(h,{action:'add',assetId:'asset',revision:p.revision});
 const video=p.tracks.find(t=>t.kind==='video'); const second=video.clips[1].id;
 const stable=JSON.stringify(h.snapshot());
 assert.throws(()=>edit(h,{action:'move',clipId:second,frame:1,revision:p.revision,snap:false}),/Overlapping/);
 assert.equal(JSON.stringify(h.snapshot()),stable);
 const snapped=edit(h,{action:'move',clipId:second,frame:62,revision:p.revision,snap:true});
 assert.equal(view(h).tracks[0].clips[1].start,60);
 assert.equal(snapped.revision,p.revision);
});
