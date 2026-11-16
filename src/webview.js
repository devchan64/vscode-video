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
  vscode.postMessage({ type: 'testState', state: { heading: heading.textContent, preview: preview.getAttribute('aria-pressed'), edit: edit.getAttribute('aria-pressed'), empty: document.getElementById('empty').textContent, engine: engineStatus.textContent, project: document.getElementById('project-name').textContent, media: document.getElementById('media-list').textContent, frame: frameInfo.textContent, image: frameImage.getAttribute('src') || '' } });
}
for (const [button, mode] of [[preview, 'preview'], [edit, 'edit']]) {
  button.addEventListener('click', () => vscode.postMessage({ type: 'setMode', mode }));
}
window.addEventListener('message', event => {
  const message = event.data;
  if (e2e && message.type === 'testSeek') { frameTime.value=message.seconds; goTime.click(); return; }
  if (e2e && message.type === 'testUI') { const selectors={import:'#import-media',preview:'#media-list button[data-preview]',next:'#next-frame',extract:'#extract-frame'}; document.querySelector(selectors[message.action])?.click(); return; }
  if (e2e && message.type === 'testRelink') { document.querySelector('#media-list button')?.click(); return; }
  if (e2e && message.type === 'testActivateEdit') {
    edit.focus();
    edit.click();
    return;
  }
  if (message.type === 'project') {
    document.getElementById('project-name').textContent = message.label + (message.dirty ? ' • Unsaved' : '');
    const list = document.getElementById('media-list'); list.replaceChildren();
    for (const asset of message.assets || []) {
      const item = document.createElement('li');
      item.textContent = `${asset.label} — ${asset.status}${asset.metadata ? ` (${asset.metadata})` : ''} `;
      if (asset.status === 'available' && asset.hasVideo) { const view=document.createElement('button'); view.textContent='Preview'; view.dataset.preview='true'; view.setAttribute('aria-label', `Preview ${asset.label}`); view.addEventListener('click',()=>vscode.postMessage({type:'selectMedia',assetId:asset.id})); item.append(view); }
      if (asset.status !== 'available') {
        const button = document.createElement('button'); button.textContent = 'Relink'; button.dataset.relink='true'; button.disabled=edit.getAttribute('aria-pressed') !== 'true';
        button.setAttribute('aria-label', `Relink ${asset.label}`);
        button.addEventListener('click', () => vscode.postMessage({ type: 'relink', assetId: asset.id })); item.append(button);
      }
      list.append(item);
    }
    report(); return;
  }
  if (message.type === 'frameReset') { frameImage.removeAttribute('src'); frameImage.hidden=true; document.getElementById('empty').hidden=false; frameInfo.textContent=''; previous.disabled=next.disabled=extract.disabled=goFrame.disabled=frameNumber.disabled=goTime.disabled=frameTime.disabled=true; report(); return; }
  if (message.type === 'frameLoading') { frameInfo.textContent='Loading frame…'; previous.disabled=next.disabled=extract.disabled=goFrame.disabled=frameNumber.disabled=goTime.disabled=frameTime.disabled=true; report(); return; }
  if (message.type === 'frameError') { frameInfo.textContent=message.message; frameImage.hidden=true; document.getElementById('empty').hidden=false; report(); return; }
  if (message.type === 'frame') { frameImage.src=`data:image/png;base64,${message.image}`; frameImage.hidden=false; document.getElementById('empty').hidden=true; frameInfo.textContent=`Frame ${message.index+1} / ${message.count} · ${message.time}s`; frameNumber.value=String(message.index+1); frameNumber.max=String(message.count); previous.disabled=message.index===0; next.disabled=message.index+1===message.count; extract.disabled=goFrame.disabled=frameNumber.disabled=goTime.disabled=frameTime.disabled=false; report(); return; }
  if (message.type === 'frameSaved') { frameInfo.textContent += ' · Saved'; report(); return; }
  if (message.type === 'engine') { engineStatus.textContent = message.status === 'checking' ? 'Checking media engine…' : message.summary; report(); return; }
  if (message.type !== 'state') return;
  document.getElementById('import-media').disabled = message.mode !== 'edit';
  for (const button of document.querySelectorAll('#media-list button[data-relink]')) button.disabled = message.mode !== 'edit';
  preview.setAttribute('aria-pressed', String(message.mode === 'preview'));
  edit.setAttribute('aria-pressed', String(message.mode === 'edit'));
  heading.textContent = message.mode === 'preview' ? 'Preview' : 'Edit';
  error.hidden = !message.error;
  error.textContent = message.error || '';
  report();
});
vscode.postMessage({ type: 'ready' });
