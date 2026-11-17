'use strict';
const assert = require('node:assert/strict');
const vscode = require('vscode');
const WebSocket = require('ws');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { runTool } = require('../../src/media/engine');
const { createProject } = require('../../src/model/project');
const { rational } = require('../../src/model/time');
async function nativeEnter(selector) {
 const targets=await (await fetch('http://127.0.0.1:19227/json/list')).json();
 const target=targets.find(item=>item.type==='iframe' && item.url.includes('extensionId=video-editor-dev.vscode-video-editor'));
 assert.ok(target);
 const socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
 let id=0; const pending=new Map(),contexts=[];
 socket.on('message',data=>{const m=JSON.parse(data);if(m.method==='Runtime.executionContextCreated')contexts.push(m.params.context.id);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}));});
 try {
  await call('Runtime.enable'); let context;
  for(const candidate of contexts){const r=await call('Runtime.evaluate',{contextId:candidate,expression:`Boolean(document.querySelector(${JSON.stringify(selector)}))`,returnByValue:true});if(r.result.value){context=candidate;break;}}
  assert.ok(context,'play button context exists');
  await call('Runtime.evaluate',{contextId:context,expression:`document.querySelector(${JSON.stringify(selector)}).focus()`});
  for(const type of ['keyDown','keyUp']) await call('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,...(type==='keyDown'?{text:'\r',unmodifiedText:'\r'}:{})});
 } finally {socket.close();}
}
async function waitFor(predicate) {
  const end = Date.now() + 10000;
  let state;
  while (Date.now() < end) {
    state = await vscode.commands.executeCommand('videoEditor.test.state');
    if (state && predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Webview did not reach expected state: ${JSON.stringify(state)}`);
}
exports.run = async () => {
  const extension = vscode.extensions.getExtension('video-editor-dev.vscode-video-editor');
  assert.ok(extension, 'extension is registered');
  await extension.activate();
  await vscode.commands.executeCommand('videoEditor.open');
  const initial = await waitFor(state => state.heading === 'Preview');
  assert.equal(initial.preview, 'true');
  assert.equal(initial.edit, 'false');
  assert.match(initial.empty, /No media/);
  const targets = await (await fetch('http://127.0.0.1:19227/json/list')).json();
  const target = targets.find(item => item.type === 'iframe' && item.url.includes('extensionId=video-editor-dev.vscode-video-editor'));
  assert.ok(target, 'Webview debugging target is available');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let nextId = 0;
  const pending = new Map();
  const contexts = [];
  socket.on('message', data => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.executionContextCreated') contexts.push(message.params.context.id);
    if (!pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    await cdp('Runtime.enable');
    let contextId;
    for (const id of contexts) {
      const result = await cdp('Runtime.evaluate', { contextId: id, expression: "Boolean(document.getElementById('preview'))", returnByValue: true });
      if (result.result.value === true) { contextId = id; break; }
    }
    assert.ok(contextId, 'Webview content execution context exists');
    const evaluate = async expression => (await cdp('Runtime.evaluate', { contextId, expression, returnByValue: true })).result.value;
    await evaluate("document.getElementById('preview').focus()");
    const key = async (name, code, keyCode, modifiers = 0) => {
      for (const type of ['keyDown', 'keyUp']) await cdp('Input.dispatchKeyEvent', { type, key: name, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers, ...(type === 'keyDown' && name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
    };
    await key('Tab', 'Tab', 9);
    assert.equal(await evaluate("document.activeElement.id"), 'edit');
    await key('Enter', 'Enter', 13);
    await waitFor(state => state.heading === 'Edit' && state.edit === 'true');
    await key('Tab', 'Tab', 9, 8);
    assert.equal(await evaluate("document.activeElement.id"), 'preview');
    await key(' ', 'Space', 32);
    await waitFor(state => state.heading === 'Preview' && state.preview === 'true');
  } finally { socket.close(); }
  await vscode.commands.executeCommand('videoEditor.test.activateEdit');
  const edited = await waitFor(state => state.heading === 'Edit');
  assert.equal(edited.preview, 'false');
  assert.equal(edited.edit, 'true');
  await vscode.commands.executeCommand('videoEditor.newProject');
  await waitFor(state => state.project === 'Untitled project • Unsaved');
  await vscode.commands.executeCommand('videoEditor.checkEngine');
  const checked = await waitFor(state => state.engine.includes('Input:'));
  assert.match(checked.engine, /Input: available.*Export: available/);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-editor-e2e-'));
  try {
    const file = path.join(dir, 'project.json');
    await vscode.commands.executeCommand('videoEditor.test.dialogs', file);
    await vscode.commands.executeCommand('videoEditor.saveProject');
    await waitFor(state => state.project === 'project.json');
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).version, 1);
    await vscode.commands.executeCommand('videoEditor.newProject');
    await waitFor(state => state.project === 'Untitled project • Unsaved');
    await vscode.commands.executeCommand('videoEditor.test.dialogs', true, file);
    await vscode.commands.executeCommand('videoEditor.openProject');
    await waitFor(state => state.project === 'project.json');
    const replacement = path.join(dir, 'replacement.webm');
    await runTool('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=size=64x48:rate=10:duration=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libvpx-vp9','-c:a','libopus','-shortest','-y',replacement]);
    const fixture = createProject({width:640,height:480,fps:rational(30),sampleRate:48000,channels:2}, 'fixture');
    fixture.assets.push({id:'source',uri:'missing.webm',duration:rational(1),fingerprint:{size:'1',modified:0},streams:[{index:0,kind:'video'}]});
    const missingProject = path.join(dir, 'missing.json');
    await fs.writeFile(missingProject, JSON.stringify(fixture));
    await vscode.commands.executeCommand('videoEditor.test.dialogs', missingProject);
    await vscode.commands.executeCommand('videoEditor.openProject');
    await waitFor(state => state.project === 'missing.json' && state.media.includes('missing'));
    await vscode.commands.executeCommand('videoEditor.test.dialogs', replacement, true);
    await vscode.commands.executeCommand('videoEditor.test.relink');
    await waitFor(state => state.project === 'missing.json • Unsaved' && state.media.includes('available'));
    await vscode.commands.executeCommand('videoEditor.saveProject');
    const saved = JSON.parse(await fs.readFile(missingProject, 'utf8'));
    assert.equal(saved.assets[0].uri, 'replacement.webm');
    assert.equal(saved.assets[0].streams[0].codec, 'vp9');
    await vscode.commands.executeCommand('videoEditor.newProject');
    await vscode.commands.executeCommand('videoEditor.test.dialogs', true, missingProject);
    await vscode.commands.executeCommand('videoEditor.openProject');
    await waitFor(state => state.project === 'missing.json' && state.media.includes('available'));
    await vscode.commands.executeCommand('videoEditor.newProject');
    await waitFor(state => state.project === 'Untitled project • Unsaved');
    const secondMedia=path.join(dir,'second.webm'); await fs.copyFile(replacement,secondMedia);
    const invalid=path.join(dir,'invalid.webm'); await fs.writeFile(invalid,'invalid');
    await vscode.commands.executeCommand('videoEditor.test.dialogs', [replacement, secondMedia, invalid]);
    await vscode.commands.executeCommand('videoEditor.test.ui', 'import');
    await waitFor(state => state.media.includes('replacement.webm') && state.media.includes('available'));
    await waitFor(state => state.media.includes('Thumbnail: ready') && state.media.includes('Audio waveform: ready') && state.previews >= 2);
    if (process.platform !== 'win32') {
      const slowProbe=path.join(dir,'slow-probe');
      await fs.writeFile(slowProbe,'#!/bin/sh\nexec sleep 20\n'); await fs.chmod(slowProbe,0o755);
      const config=vscode.workspace.getConfiguration('videoEditor');
      try {
        await config.update('ffprobePath',slowProbe,vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand('videoEditor.test.ui','preview');
        await waitFor(state=>state.progressVisible && state.frame.includes('Indexing'));
        await vscode.commands.executeCommand('videoEditor.test.ui','cancel');
        await waitFor(state=>!state.progressVisible && state.frame.includes('cancelled'));
      } finally { await config.update('ffprobePath',undefined,vscode.ConfigurationTarget.Global); }
    }
    await vscode.commands.executeCommand('videoEditor.test.ui', 'preview');
    const firstFrame = await waitFor(state => state.frame.startsWith('Frame 1 /') && state.image.startsWith('data:image/png;base64,'));
    await vscode.commands.executeCommand('videoEditor.test.ui', 'next');
    const secondFrame = await waitFor(state => state.frame.startsWith('Frame 2 /'));
    assert.notEqual(firstFrame.image, secondFrame.image);
    assert.ok(secondFrame.progressEvents > 0, 'real FFmpeg decoding reports progress');
    assert.equal(secondFrame.progressVisible, false);
    await vscode.commands.executeCommand('videoEditor.test.seek', '0');
    await waitFor(state => state.frame.startsWith('Frame 1 /'));
    await vscode.commands.executeCommand('videoEditor.test.ui', 'next');
    await waitFor(state => state.frame.startsWith('Frame 2 /'));
    const png = path.join(dir, 'captured.png');
    await vscode.commands.executeCommand('videoEditor.test.dialogs', png);
    await vscode.commands.executeCommand('videoEditor.test.ui', 'extract');
    await waitFor(state => state.frame.includes('Saved'));
    assert.deepEqual(await fs.readFile(png), Buffer.from(secondFrame.image.split(',')[1], 'base64'));
    await vscode.commands.executeCommand('videoEditor.test.ui','add');
    await waitFor(state=>state.timeline?.tracks.length===2 && state.timeline.tracks[0].clips.length===1);
    await vscode.commands.executeCommand('videoEditor.test.ui','addSecond');
    await waitFor(state=>state.timeline?.tracks[0].clips.length===2);
    await vscode.commands.executeCommand('videoEditor.test.timeline','clip-first');
    await vscode.commands.executeCommand('videoEditor.test.timeline','clip-split',15);
    let editedTimeline=await waitFor(state=>state.timeline?.tracks[0].clips.length===3 && state.timelineClips===6 && state.clipWidth>0);
    assert.equal(editedTimeline.timeline.tracks[1].clips.length,3);
    await vscode.commands.executeCommand('videoEditor.test.timeline','clip-last-video');
    await vscode.commands.executeCommand('videoEditor.test.timeline','clip-move',90);
    await waitFor(state=>state.timeline?.tracks[0].clips.some(clip=>clip.start===90));
    await vscode.commands.executeCommand('videoEditor.test.timeline','clip-trim-end',105);
    await waitFor(state=>state.timeline?.tracks[0].clips.some(clip=>clip.end===105));
    await vscode.commands.executeCommand('videoEditor.test.timeline','timeline-undo');
    await waitFor(state=>state.timeline?.tracks[0].clips.some(clip=>clip.end===120));
    await vscode.commands.executeCommand('videoEditor.test.timeline','timeline-redo');
    await waitFor(state=>state.timeline?.tracks[0].clips.some(clip=>clip.end===105));
    await vscode.commands.executeCommand('videoEditor.test.timeline','preview');
    await waitFor(state=>state.heading==='Preview');
    await vscode.commands.executeCommand('videoEditor.test.timeline','clip-delete');
    await waitFor(state=>state.timelineMessage.includes('Switch to Edit'));
    await vscode.commands.executeCommand('videoEditor.test.timeline','edit');
    await waitFor(state=>state.heading==='Edit');
    await vscode.commands.executeCommand('videoEditor.test.timeline','drag-first',30);
    await waitFor(state=>state.timeline?.tracks[0].clips.some(clip=>clip.start===30 && clip.end===45));
    await vscode.commands.executeCommand('videoEditor.test.timeline','timeline-undo');
    await waitFor(state=>state.timeline?.tracks[0].clips.some(clip=>clip.start===0 && clip.end===15));
    await vscode.commands.executeCommand('videoEditor.test.timeline','clip-last-video');
    await vscode.commands.executeCommand('videoEditor.test.timeline','clip-delete');
    await waitFor(state=>state.timeline?.tracks[0].clips.length===2 && state.timeline.tracks[1].clips.length===2);
    await vscode.commands.executeCommand('videoEditor.test.timeline','timeline-undo');
    await waitFor(state=>state.timeline?.tracks[0].clips.length===3);
    await vscode.commands.executeCommand('videoEditor.test.timeline','clip-last-video');
    await vscode.commands.executeCommand('videoEditor.test.timeline','clip-ripple');
    await waitFor(state=>state.timeline?.tracks[0].clips.length===2);
    await vscode.commands.executeCommand('videoEditor.test.timeline','timeline-undo');
    await waitFor(state=>state.timeline?.tracks[0].clips.length===3);
    await vscode.commands.executeCommand('videoEditor.test.timeline','clip-first-audio');
    await vscode.commands.executeCommand('videoEditor.test.audio',0.5,false,3,3);
    await waitFor(state=>state.timeline?.tracks.find(track=>track.kind==='audio')?.clips.some(clip=>clip.gain===0.5 && clip.fadeIn===3 && clip.fadeOut===3));
    await vscode.commands.executeCommand('videoEditor.test.timeline','clip-detach');
    await waitFor(state=>state.timeline?.tracks.every(track=>track.clips.some(clip=>clip.start===0 && !clip.linked)));
    await vscode.commands.executeCommand('videoEditor.test.timeline','timeline-undo');
    await waitFor(state=>state.timeline?.tracks.every(track=>track.clips.some(clip=>clip.start===0 && clip.linked)));
    await vscode.commands.executeCommand('videoEditor.test.timeline','target-timeline');
    await vscode.commands.executeCommand('videoEditor.test.timeline','render-timeline');
    await waitFor(state=>state.timelinePreview==='Preview ready' && state.timelineVideoReady>=1);
    await nativeEnter('#timeline-play');
    const playing=await waitFor(state=>state.timelineVideoPaused===false && state.timelineVideoTime>0.2);
    assert.ok(Math.abs(playing.playhead-Math.floor(playing.timelineVideoTime*30))<=2, 'video playhead follows audio clock');
    await vscode.commands.executeCommand('videoEditor.test.timeline','target-source');
    await waitFor(state=>state.timelineVideoPaused===true);
    await vscode.commands.executeCommand('videoEditor.test.timeline','target-timeline');
    const importProject = path.join(dir, 'import.json');
    await vscode.commands.executeCommand('videoEditor.test.dialogs', importProject);
    await vscode.commands.executeCommand('videoEditor.saveProject');
    const savedTimeline=JSON.parse(await fs.readFile(importProject,'utf8'));
    assert.equal(savedTimeline.assets.length,2); assert.equal(savedTimeline.tracks[0].clips.length,3);
    await vscode.commands.executeCommand('videoEditor.newProject');
    await vscode.commands.executeCommand('videoEditor.test.dialogs', true, importProject);
    await vscode.commands.executeCommand('videoEditor.openProject');
    await waitFor(state=>state.timeline?.tracks[0]?.clips.length===3 && state.timeline.tracks[0].clips.some(clip=>clip.end===105));
    await fs.appendFile(replacement, 'changed');
    await waitFor(state => state.media.includes('changed') && state.previews <= 2);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
  console.log('Extension Host: keyboard, media, timeline editing, audio preview and synchronized playback passed');
};
