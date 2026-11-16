'use strict';
const vscode = acquireVsCodeApi();
const e2e = document.currentScript.dataset.e2e === '1';
const preview = document.getElementById('preview');
const edit = document.getElementById('edit');
const heading = document.getElementById('mode-heading');
const error = document.getElementById('error');
const engineStatus = document.getElementById('engine-status');
const frameImage = document.getElementById('frame-image');
const frameInfo = document.getElementById('frame-info');
const frameProgress = document.getElementById('frame-progress'), cancelFrame = document.getElementById('cancel-frame');
let progressEvents = 0;
let timelineState = null, timelineAssets = [], selectedClip, zoom = 3;
const timelinePanel=document.getElementById('timeline-panel'), timelineTracks=document.getElementById('timeline-tracks');
document.getElementById('save-project').addEventListener('click',()=>vscode.postMessage({type:'saveProject'}));
const timelineFrame=document.getElementById('timeline-frame'), timelineSnap=document.getElementById('timeline-snap'), timelineStatus=document.getElementById('timeline-status');
function timelineAction(action, extra={}) {
  if (!timelineState) { timelineStatus.textContent='Create or open a project first.'; return; }
  vscode.postMessage({type:'timelineAction',command:{action,revision:timelineState.revision,...extra}});
}
for (const [id,action] of [['clip-move','move'],['clip-trim-start','trimStart'],['clip-trim-end','trimEnd'],['clip-split','split'],['clip-delete','delete'],['clip-ripple','ripple']]) {
  document.getElementById(id).addEventListener('click',()=>timelineAction(action,{clipId:selectedClip,frame:Number(timelineFrame.value),snap:timelineSnap.checked}));
}
timelineFrame.addEventListener('change',renderTimeline);
document.addEventListener('keydown',event=>{
  if (timelinePanel.hidden || !(event.ctrlKey || event.metaKey) || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
  const key=event.key.toLowerCase(); if (key==='z' || key==='y') { event.preventDefault(); timelineAction(key==='y' || event.shiftKey ? 'redo' : 'undo'); }
});
document.getElementById('timeline-undo').addEventListener('click',()=>timelineAction('undo'));
document.getElementById('timeline-redo').addEventListener('click',()=>timelineAction('redo'));
document.getElementById('zoom-in').addEventListener('click',()=>{zoom=Math.min(16,zoom*2);renderTimeline();});
document.getElementById('zoom-out').addEventListener('click',()=>{zoom=Math.max(.25,zoom/2);renderTimeline();});
function renderTimeline() {
  const focusedClip=document.activeElement?.dataset?.clipId;
  timelineTracks.replaceChildren();
  if (!timelineState) { timelineStatus.textContent='Create or open a project to edit.'; return; }
  document.getElementById('timeline-undo').disabled=!timelineState.canUndo;
  document.getElementById('timeline-redo').disabled=!timelineState.canRedo;
  const clips=timelineState.tracks.flatMap(track=>track.clips);
  if (selectedClip && !clips.some(clip=>clip.id===selectedClip)) selectedClip=undefined;
  for (const id of ['clip-move','clip-trim-start','clip-trim-end','clip-split','clip-delete','clip-ripple']) document.getElementById(id).disabled=!selectedClip;
  const maxFrame=clips.reduce((max,clip)=>Math.max(max,clip.end),30);
  const scale=Math.min(zoom,1999000/(maxFrame+30));
  const ruler=document.createElement('div'); ruler.className='track timeline-ruler'; ruler.style.width=`${Math.min(2000000,Math.max(500,100+(maxFrame+30)*scale))}px`;
  const frameStep=Math.max(1,Math.ceil(80/scale),Math.ceil(maxFrame/200)); for(let n=0;n<=maxFrame && n<10000000;n+=frameStep) { const mark=document.createElement('span'); mark.className='ruler-mark'; mark.style.left=`${100+n*scale}px`; mark.textContent=String(n); ruler.append(mark); }
  const head=document.createElement('span'); head.className='playhead'; head.style.left=`${100+Number(timelineFrame.value || 0)*scale}px`; head.textContent='▼'; head.setAttribute('aria-label',`Playhead frame ${timelineFrame.value}`); ruler.append(head); ruler.addEventListener('click',event=>{const rect=ruler.getBoundingClientRect();timelineFrame.value=String(Math.max(0,Math.round((event.clientX-rect.left-100)/scale)));renderTimeline();}); timelineTracks.append(ruler);
  for (const [number,track] of timelineState.tracks.entries()) {
    const lane=document.createElement('div'); lane.className='track'; lane.style.width=`${Math.min(2000000,Math.max(500,100+(maxFrame+30)*scale))}px`;
    const label=document.createElement('span'); label.className='track-label'; label.textContent=`${track.kind === 'video' ? 'Video' : 'Audio'} ${number+1}`; lane.append(label);
    lane.addEventListener('dragover',event=>event.preventDefault());
    lane.addEventListener('drop',event=>{ event.preventDefault(); const id=event.dataTransfer.getData('text/plain'); if (!track.clips.some(clip=>clip.id===id)) return; const rect=lane.getBoundingClientRect(); const at=Math.max(0,Math.round((event.clientX-rect.left-100)/scale)); timelineFrame.value=String(at); selectedClip=id; timelineAction('move',{clipId:id,frame:at,snap:timelineSnap.checked}); });
    for (const clip of track.clips) {
      const asset=timelineAssets.find(item=>item.id===clip.assetId);
      const button=document.createElement('button'); button.className='timeline-clip'; button.dataset.clipId=clip.id; button.draggable=true;
      button.style.left=`${Math.min(1999900,100+clip.start*scale)}px`; button.style.width=`${Math.max(3,Math.min(100000,(clip.end-clip.start)*scale))}px`;
      const preview=track.kind==='video' ? asset?.thumbnail : asset?.waveform; if(preview?.status==='ready') {button.style.backgroundImage=`url(data:image/png;base64,${preview.image})`; button.style.backgroundSize='cover';}
      button.textContent=`${asset?.label || 'Media'} ${clip.linked?'🔗':''}`; button.title=`${asset?.label || 'Media'}: frames ${clip.start}–${clip.end}`;
      button.setAttribute('aria-label',`${asset?.label || 'Media'}, ${track.kind}, frames ${clip.start} to ${clip.end}${clip.linked?', linked':''}`);
      button.setAttribute('aria-pressed',String(selectedClip===clip.id));
      button.addEventListener('click',()=>{selectedClip=clip.id;timelineFrame.value=String(clip.start);renderTimeline();});
      button.addEventListener('dragstart',event=>event.dataTransfer.setData('text/plain',clip.id)); lane.append(button);
    }
    timelineTracks.append(lane);
  }
  if (!timelineState.tracks.length) timelineTracks.textContent='No clips. Add media to the timeline.';
  if (focusedClip) [...timelineTracks.querySelectorAll('[data-clip-id]')].find(button=>button.dataset.clipId===focusedClip)?.focus();
}

cancelFrame.addEventListener('click', () => vscode.postMessage({type:'frameCancel'}));
const previous = document.getElementById('prev-frame'), next = document.getElementById('next-frame');
const frameNumber = document.getElementById('frame-number'), goFrame = document.getElementById('go-frame'), extract = document.getElementById('extract-frame');
const frameTime = document.getElementById('frame-time'), goTime = document.getElementById('go-time');
document.getElementById('import-media').addEventListener('click', () => vscode.postMessage({type:'importMedia'}));
previous.addEventListener('click', () => vscode.postMessage({type:'frameStep',step:-1}));
next.addEventListener('click', () => vscode.postMessage({type:'frameStep',step:1}));
goFrame.addEventListener('click', () => vscode.postMessage({type:'frameJump',index:Number(frameNumber.value)-1}));
goTime.addEventListener('click', () => vscode.postMessage({type:'frameSeek',seconds:frameTime.value}));
extract.addEventListener('click', () => vscode.postMessage({type:'extractFrame'}));
document.getElementById('check-engine').addEventListener('click', () => vscode.postMessage({ type: 'checkEngine' }));
function report() {
  if (!e2e) return;
  vscode.postMessage({ type: 'testState', state: { heading: heading.textContent, preview: preview.getAttribute('aria-pressed'), edit: edit.getAttribute('aria-pressed'), empty: document.getElementById('empty').textContent, engine: engineStatus.textContent, project: document.getElementById('project-name').textContent, media: document.getElementById('media-list').textContent, previews: [...document.querySelectorAll('.media-preview')].filter(image => image.complete && image.naturalWidth > 0).length, frame: frameInfo.textContent, image: frameImage.getAttribute('src') || '', progressEvents, progressVisible: !frameProgress.hidden, timeline: timelineState, timelineMessage: timelineStatus.textContent, timelineClips: timelineTracks.querySelectorAll('.timeline-clip').length, clipWidth: timelineTracks.querySelector('.timeline-clip')?.getBoundingClientRect().width || 0 } });
}
for (const [button, mode] of [[preview, 'preview'], [edit, 'edit']]) {
  button.addEventListener('click', () => vscode.postMessage({ type: 'setMode', mode }));
}
window.addEventListener('message', event => {
  const message = event.data;
  if (e2e && message.type === 'testTimeline' && message.control === 'drag-first') { const lane=timelineTracks.querySelector('.track:not(.timeline-ruler)'), button=lane?.querySelector('.timeline-clip'); if (lane && button) { const max=timelineState.tracks.reduce((m,t)=>t.clips.reduce((n,c)=>Math.max(n,c.end),m),30); const scale=Math.min(zoom,1999000/(max+30)); const transfer=new DataTransfer(); transfer.setData('text/plain',button.dataset.clipId); lane.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:lane.getBoundingClientRect().left+100+message.frame*scale})); } return; }
  if (e2e && message.type === 'testTimeline') { if (message.frame !== undefined) timelineFrame.value=String(message.frame); const target=message.control === 'clip-first' ? document.querySelector('.timeline-clip') : message.control === 'clip-last-video' ? [...document.querySelectorAll('.timeline-clip')].find(button => button.dataset.clipId === timelineState?.tracks.find(track => track.kind === 'video')?.clips.reduce((a,b)=>a.start>b.start?a:b).id) : document.getElementById(message.control); target?.click(); return; }
  if (e2e && message.type === 'testSeek') { frameTime.value=message.seconds; goTime.click(); return; }
  if (e2e && message.type === 'testUI') { const selectors={import:'#import-media',preview:'#media-list button[data-preview]',add:'#media-list button[data-add-asset]',addSecond:'#media-list li:nth-child(2) button[data-add-asset]',next:'#next-frame',extract:'#extract-frame',cancel:'#cancel-frame'}; document.querySelector(selectors[message.action])?.click(); return; }
  if (e2e && message.type === 'testRelink') { document.querySelector('#media-list button')?.click(); return; }
  if (e2e && message.type === 'testActivateEdit') {
    edit.focus();
    edit.click();
    return;
  }
  if (message.type === 'project') {
    document.getElementById('project-name').textContent = message.label + (message.dirty ? ' • Unsaved' : '');
    timelineState=message.timeline; timelineAssets=message.assets || []; renderTimeline();
    const list = document.getElementById('media-list'); list.replaceChildren();
    for (const asset of message.assets || []) {
      const item = document.createElement('li');
      item.textContent = `${asset.label} — ${asset.status}${asset.metadata ? ` (${asset.metadata})` : ''} `;
      for (const [kind, label] of [['thumbnail','Thumbnail'],['waveform','Audio waveform']]) {
        const state=asset[kind]; if (!state) continue;
        const status=document.createElement('span'); status.textContent=` ${label}: ${state.status === 'ready' ? 'ready' : state.status === 'loading' ? 'generating' : state.message}`; item.append(status);
        if (state.status === 'ready') { const image=document.createElement('img'); image.className='media-preview'; image.alt=label; image.onload=report; image.src=`data:image/png;base64,${state.image}`; item.append(image); }
      }
      if (asset.status === 'available' && asset.hasVideo) { const view=document.createElement('button'); view.textContent='Preview'; view.dataset.preview='true'; view.setAttribute('aria-label', `Preview ${asset.label}`); view.addEventListener('click',()=>vscode.postMessage({type:'selectMedia',assetId:asset.id})); item.append(view); }
      if (asset.status === 'available') { const add=document.createElement('button'); add.textContent='Add to timeline'; add.dataset.addAsset=asset.id; add.disabled=edit.getAttribute('aria-pressed') !== 'true'; add.setAttribute('aria-label',`Add ${asset.label} to timeline`); add.addEventListener('click',()=>timelineAction('add',{assetId:asset.id})); item.append(add); }
      if (asset.status !== 'available') {
        const button = document.createElement('button'); button.textContent = 'Relink'; button.dataset.relink='true'; button.disabled=edit.getAttribute('aria-pressed') !== 'true';
        button.setAttribute('aria-label', `Relink ${asset.label}`);
        button.addEventListener('click', () => vscode.postMessage({ type: 'relink', assetId: asset.id })); item.append(button);
      }
      list.append(item);
    }
    report(); return;
  }
  if (message.type === 'timelineResult') { timelineStatus.textContent=message.ok ? '' : message.message; report(); return; }
  if (message.type === 'frameProgress') { frameProgress.value=message.value; progressEvents++; report(); return; }
  if (message.type === 'frameCancelled') { frameProgress.hidden=true; cancelFrame.hidden=true; frameInfo.textContent='Frame processing cancelled.'; report(); return; }
  if (message.type === 'frameReset') { frameImage.removeAttribute('src'); frameImage.hidden=true; document.getElementById('empty').hidden=false; frameInfo.textContent=''; frameProgress.hidden=true; cancelFrame.hidden=true; previous.disabled=next.disabled=extract.disabled=goFrame.disabled=frameNumber.disabled=goTime.disabled=frameTime.disabled=true; report(); return; }
  if (message.type === 'frameLoading') { frameInfo.textContent=message.phase === 'index' ? 'Indexing video frames…' : 'Decoding frame…'; frameProgress.hidden=false; cancelFrame.hidden=false; if (message.phase === 'index') frameProgress.removeAttribute('value'); else frameProgress.value=0; previous.disabled=next.disabled=extract.disabled=goFrame.disabled=frameNumber.disabled=goTime.disabled=frameTime.disabled=true; report(); return; }
  if (message.type === 'frameError') { frameInfo.textContent=message.message; frameProgress.hidden=true; cancelFrame.hidden=true; frameImage.hidden=true; document.getElementById('empty').hidden=false; report(); return; }
  if (message.type === 'frame') { frameProgress.hidden=true; cancelFrame.hidden=true; frameImage.src=`data:image/png;base64,${message.image}`; frameImage.hidden=false; document.getElementById('empty').hidden=true; frameInfo.textContent=`Frame ${message.index+1} / ${message.count} · ${message.time}s`; frameNumber.value=String(message.index+1); frameNumber.max=String(message.count); previous.disabled=message.index===0; next.disabled=message.index+1===message.count; extract.disabled=goFrame.disabled=frameNumber.disabled=goTime.disabled=frameTime.disabled=false; report(); return; }
  if (message.type === 'frameSaved') { frameInfo.textContent += ' · Saved'; report(); return; }
  if (message.type === 'engine') { engineStatus.textContent = message.status === 'checking' ? 'Checking media engine…' : message.summary; report(); return; }
  if (message.type !== 'state') return;
  timelinePanel.hidden=message.mode !== 'edit';
  document.getElementById('import-media').disabled = message.mode !== 'edit';
  for (const button of document.querySelectorAll('#media-list button[data-add-asset]')) button.disabled = message.mode !== 'edit';
  for (const button of document.querySelectorAll('#media-list button[data-relink]')) button.disabled = message.mode !== 'edit';
  preview.setAttribute('aria-pressed', String(message.mode === 'preview'));
  edit.setAttribute('aria-pressed', String(message.mode === 'edit'));
  heading.textContent = message.mode === 'preview' ? 'Preview' : 'Edit';
  error.hidden = !message.error;
  error.textContent = message.error || '';
  report();
});
vscode.postMessage({ type: 'ready' });
