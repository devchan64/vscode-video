'use strict';
const vscode = require('vscode');
const crypto = require('crypto');
const { handleMessage } = require('./protocol');
const { inspectEngine } = require('./media/engine');
const path = require('path');
const { createProject, History } = require('./model/project');
const { saveProject, loadProject, inspectAssets, relinkAsset } = require('./model/storage');
const { probeMedia, decimalTime } = require('./media/probe');
const { indexFrames, decodeFrame } = require('./media/frames');
const { PreviewCache } = require('./media/preview-cache');
const fs = require('fs/promises');
const { watch } = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');
const { rational, add, compare } = require('./model/time');
const timeline = require('./model/timeline');

function activate(context) {
  let panel;
  let mode = 'preview';
  let testState;
  let projectHistory;
  let projectPath;
  let projectDirty = false;
  let assetStatuses = [];
  let selection;
  let frameRequest = 0;
  let activeFrame;
  let currentFrame;
  const previewCache = new PreviewCache(path.join(context.globalStorageUri.fsPath, 'media-cache'));
  const previewStates = new Map(), previewJobs = new Map(), mediaWatchers = new Map();
  function clearPreviews(assetId) {
    for (const [id, watcher] of mediaWatchers) if (!assetId || id === assetId) { clearTimeout(watcher.timer); watcher.handle.close(); mediaWatchers.delete(id); }
    for (const [key, controller] of previewJobs) if (!assetId || JSON.parse(key)[0] === assetId) { controller.abort(); previewJobs.delete(key); }
    for (const key of previewStates.keys()) if (!assetId || JSON.parse(key)[0] === assetId) previewStates.delete(key);
  }
  function schedulePreviews() {
    if (!panel || !projectHistory) return;
    const history=projectHistory;
    for (const asset of history.snapshot().assets) {
      if (assetStatuses.find(item => item.id === asset.id)?.status !== 'available') continue;
      if (!mediaWatchers.has(asset.id)) {
        try {
          const watcher = { handle: null, timer: undefined };
          watcher.handle = watch(sourcePath(asset), { persistent:false }, () => {
            clearTimeout(watcher.timer);
            watcher.timer = setTimeout(async () => {
              if (projectHistory !== history || mediaWatchers.get(asset.id) !== watcher) return;
              const currentPath=projectPath || path.join(context.globalStorageUri.fsPath,'untitled.json');
              try {
                const statuses=await inspectAssets(currentPath,history.snapshot());
                if (projectHistory !== history || mediaWatchers.get(asset.id) !== watcher) return;
                clearPreviews(asset.id); assetStatuses=statuses; schedulePreviews(); projectNotice();
              } catch { if (mediaWatchers.get(asset.id) === watcher) { clearPreviews(asset.id); projectNotice(); } }
            },150);
          });
          watcher.handle.on('error', () => { if (mediaWatchers.get(asset.id) === watcher) { clearPreviews(asset.id); projectNotice(); } });
          mediaWatchers.set(asset.id,watcher);
        } catch { /* Validation on access remains authoritative when watching is unavailable. */ }
      }
      for (const [kind,streamKind] of [['thumbnail','video'],['waveform','audio']]) {
        const stream=asset.streams.find(item => item.kind === streamKind);
        if (!stream) continue;
        const key=JSON.stringify([asset.id,kind]);
        if (previewStates.has(key) || previewJobs.has(key)) continue;
        const controller=new AbortController(); previewJobs.set(key,controller); previewStates.set(key,{status:'loading'});
        Promise.resolve().then(() => previewCache.get({file:sourcePath(asset),fingerprint:asset.fingerprint,stream:stream.index,kind,ffmpeg:configuredTool('ffmpeg'),signal:controller.signal}))
          .then(result => {
            if (controller.signal.aborted || projectHistory !== history || previewJobs.get(key)!==controller) return;
            previewStates.set(key,{status:'ready',image:result.data.toString('base64')});
          },error => {
            if (controller.signal.aborted || projectHistory !== history || previewJobs.get(key)!==controller) return;
            previewStates.set(key,{status:'error',message:error.message === 'Media changed' ? 'Media changed; relink it.' : 'Preview generation failed.'});
          }).finally(() => {
            if (previewJobs.get(key)===controller) { previewJobs.delete(key); projectNotice(); }
          });
      }
    }
  }

  function resetFrame() { frameRequest++; activeFrame?.abort(); activeFrame = undefined; currentFrame = undefined; selection = undefined; if (panel) void panel.webview.postMessage({type:'frameReset'}); }
  const testDialogs = [];
  const testing = process.env.VIDEO_EDITOR_E2E === '1';
  async function chooseOpen(options) {
    if (testing && testDialogs.length) { const item = testDialogs.shift(); return item ? (Array.isArray(item) ? item : [item]).map(value => vscode.Uri.file(value)) : undefined; }
    return vscode.window.showOpenDialog(options);
  }
  async function chooseSave(options) {
    if (testing && testDialogs.length) { const item = testDialogs.shift(); return item ? vscode.Uri.file(item) : undefined; }
    return vscode.window.showSaveDialog(options);
  }
  async function confirm(message) {
    if (testing && testDialogs.length) return testDialogs.shift() === true;
    return (await vscode.window.showWarningMessage(message, { modal: true }, 'Continue')) === 'Continue';
  }
  async function canReplace() { return !projectDirty || await confirm('Discard unsaved project changes?'); }
  async function updateAssets() { assetStatuses = projectHistory ? await inspectAssets(projectPath || path.join(context.globalStorageUri.fsPath, 'untitled.json'), projectHistory.snapshot()) : []; }

  async function openEditor() { await vscode.commands.executeCommand('videoEditor.open'); }
  function projectNotice() {
    if (!panel) return;
    const assets = projectHistory ? projectHistory.snapshot().assets.map(asset => ({ id: asset.id, label: asset.uri.startsWith('file:') ? path.basename(fileURLToPath(asset.uri)) : path.basename(asset.uri), status: assetStatuses.find(item => item.id === asset.id)?.status || 'unknown', hasVideo:asset.streams.some(stream => stream.kind === 'video'), thumbnail:previewStates.get(JSON.stringify([asset.id,'thumbnail'])), waveform:previewStates.get(JSON.stringify([asset.id,'waveform'])), metadata: asset.streams.map(stream => stream.kind === 'video' && stream.width && stream.height ? `${stream.codec || 'video'} ${stream.width}×${stream.height} ${stream.frameRate || ''}` : `${stream.codec || stream.kind}`).join(', ') })) : [];
    void panel.webview.postMessage({ type: 'project', label: projectPath ? path.basename(projectPath) : 'Untitled project', dirty: projectDirty, assets, timeline: timeline.view(projectHistory) });
  }
  context.subscriptions.push(vscode.commands.registerCommand('videoEditor.newProject', async () => {
    if (!await canReplace()) return;
    resetFrame(); clearPreviews();
    projectHistory = new History(createProject({width:1920,height:1080,fps:rational(30),sampleRate:48000,channels:2}));
    projectPath = undefined; projectDirty = true; assetStatuses = [];
    await openEditor(); projectNotice();
  }));
  context.subscriptions.push(vscode.commands.registerCommand('videoEditor.openProject', async () => {
    if (!await canReplace()) return;
    const selected = await chooseOpen({ canSelectMany:false, filters:{'Video Editor Project':['json']} });
    if (!selected?.length) return;
    try {
      if (selected[0].scheme !== 'file') throw new Error('Only local projects are supported');
      const result = await loadProject(selected[0].fsPath);
      resetFrame(); clearPreviews();
      projectHistory = new History(result.project); projectPath = selected[0].fsPath; projectDirty = false; assetStatuses = result.assets;
      await openEditor(); schedulePreviews(); projectNotice();
      const missing=result.assets.filter(asset => asset.status !== 'available');
      if (missing.length) void vscode.window.showWarningMessage(`${missing.length} media file(s) are missing, changed, or unavailable.`);
    } catch (error) { void vscode.window.showErrorMessage(`Cannot open project: ${error.message}`); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('videoEditor.saveProject', async () => {
    if (!projectHistory) { void vscode.window.showInformationMessage('Create or open a project first.'); return; }
    const history=projectHistory;
    let destination=projectPath;
    if (!destination) { const selected=await chooseSave({filters:{'Video Editor Project':['json']}}); if (!selected) return; if (selected.scheme !== 'file') { void vscode.window.showErrorMessage('Only local projects are supported.'); return; } destination=selected.fsPath; }
    if (projectHistory !== history) return;
    const snapshot=history.snapshot();
    try { await saveProject(destination,snapshot); if (projectHistory !== history) return; projectPath=destination; projectDirty=history.snapshot().revision !== snapshot.revision; await updateAssets(); projectNotice(); }
    catch (error) { void vscode.window.showErrorMessage(`Cannot save project: ${error.message}`); }
  }));
  async function relink(assetId) {
    if (mode !== 'edit') { void vscode.window.showInformationMessage('Switch to Edit mode to relink media.'); return; }
    if (!projectHistory || !projectPath || typeof assetId !== 'string' || !projectHistory.snapshot().assets.some(asset => asset.id === assetId)) return;
    const selected = await chooseOpen({ canSelectMany: false, title: 'Select replacement media' });
    if (!selected?.length) return;
    if (selected[0].scheme !== 'file') { void vscode.window.showErrorMessage('Only local media is supported.'); return; }
    if (!await confirm('Replace the selected media reference with this file?')) return;
    const history = projectHistory, revision = history.snapshot().revision, sourceProjectPath = projectPath;
    try {
      const configured = vscode.workspace.getConfiguration('videoEditor').get('ffprobePath') || 'ffprobe';
      const updated = await relinkAsset(sourceProjectPath, history.snapshot(), assetId, selected[0].fsPath, file => probeMedia(file, configured));
      if (projectHistory !== history || projectPath !== sourceProjectPath || history.snapshot().revision !== revision) throw new Error('Project changed during media inspection');
      if (selection?.assetId === assetId) resetFrame();
      clearPreviews(assetId);
      history.replace(updated); projectDirty = true;
      await updateAssets(); schedulePreviews(); projectNotice();
    } catch (error) { void vscode.window.showErrorMessage(`Cannot relink media: ${error.message}`); }
  }
  function configuredTool(name) {
    const value = vscode.workspace.getConfiguration('videoEditor').get(`${name}Path`) || name;
    if (value !== name && !path.isAbsolute(value)) throw new Error(`${name} path must be absolute`);
    return value;
  }
  function sourcePath(asset) {
    if (asset.uri.startsWith('file:')) return fileURLToPath(asset.uri);
    if (!projectPath) throw new Error('Save the project before opening relative media');
    return require('./model/storage').assetPath(projectPath, asset.uri);
  }
  async function importMedia() {
    if (mode !== 'edit') { void vscode.window.showInformationMessage('Switch to Edit mode to import media.'); return; }
    if (!projectHistory) { void vscode.window.showInformationMessage('Create or open a project first.'); return; }
    const files = await chooseOpen({ canSelectMany: true, title: 'Import media' });
    if (!files?.length) return;
    const history = projectHistory; let failed = 0;
    for (const uri of files) {
      try {
        if (uri.scheme !== 'file') throw new Error('Only local media is supported');
        const before = await fs.stat(uri.fsPath); if (!before.isFile()) throw new Error('Not a file');
        const info = await probeMedia(uri.fsPath, configuredTool('ffprobe'));
        if (!info.streams.every(stream => stream.kind === 'video' ? stream.codec === 'vp9' : ['opus','pcm_s16le','pcm_s24le','pcm_f32le'].includes(stream.codec))) throw new Error('Unsupported media codec');
        const after = await fs.stat(uri.fsPath);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Media changed during inspection');
        if (history !== projectHistory) throw new Error('Project changed');
        history.dispatch({ type:'addAsset', asset:{ id:crypto.randomUUID(), uri:pathToFileURL(uri.fsPath).href, duration:info.duration, streams:info.streams, fingerprint:{size:String(after.size),modified:after.mtimeMs} } });
        projectDirty = true;
      } catch { failed++; }
    }
    if (history !== projectHistory) return;
    await updateAssets(); schedulePreviews(); projectNotice();
    if (failed) void vscode.window.showWarningMessage(`${failed} media file(s) could not be imported.`);
  }
  async function selectMedia(assetId) {
    const asset = projectHistory?.snapshot().assets.find(item => item.id === assetId);
    const stream = asset?.streams.find(item => item.kind === 'video');
    if (!asset || !stream) return;
    resetFrame(); const request = frameRequest; activeFrame = new AbortController();
    const signal = activeFrame.signal;
    if (panel) void panel.webview.postMessage({type:'frameLoading', phase:'index'});
    try {
      const file = sourcePath(asset); const stat = await fs.stat(file);
      if (String(stat.size) !== asset.fingerprint.size || stat.mtimeMs !== asset.fingerprint.modified) throw new Error('Media changed; relink it before preview');
      const frames = await indexFrames(file, stream.index, configuredTool('ffprobe'), signal);
      if (request !== frameRequest) return;
      selection = { assetId, file, stream: stream.index, frames, fingerprint: asset.fingerprint };
      await showFrame(0);
    } catch (error) { if (request === frameRequest && error.code !== 'CANCELLED') { if (panel) void panel.webview.postMessage({type:'frameError',message:'Unable to index frames.'}); void vscode.window.showErrorMessage(`Cannot open media: ${error.message}`); } }
  }
  async function showFrame(index) {
    const selected = selection;
    if (!selected || !Number.isSafeInteger(index) || index < 0 || index >= selected.frames.length) return;
    const request = ++frameRequest; activeFrame?.abort(); activeFrame = new AbortController();
    if (panel) void panel.webview.postMessage({ type:'frameLoading', phase:'decode' });
    try {
      const stat=await fs.stat(selected.file);
      if (String(stat.size)!==selected.fingerprint.size || stat.mtimeMs!==selected.fingerprint.modified) throw new Error('Media changed; relink it before preview');
      await fs.mkdir(context.globalStorageUri.fsPath,{recursive:true});
      let lastProgress = -1;
      const data=await decodeFrame(selected.file, selected.stream, index, path.join(context.globalStorageUri.fsPath,'frame.png'), configuredTool('ffmpeg'),activeFrame.signal,{records:selected.frames.records,onProgress:value=>{ if (request === frameRequest && value !== lastProgress && panel) { lastProgress=value; void panel.webview.postMessage({type:'frameProgress',value}); } }});
      if (request !== frameRequest || selection !== selected) return;
      currentFrame = { data, index, assetId:selected.assetId };
      if (panel) void panel.webview.postMessage({type:'frame', image:data.toString('base64'), index, count:selected.frames.length, time:selected.frames[index]});
    } catch(error) { if (request===frameRequest && error.code!=='CANCELLED') { if (panel) void panel.webview.postMessage({type:'frameError',message:'Unable to decode frame.'}); void vscode.window.showErrorMessage(`Cannot decode frame: ${error.message}`); } }
  }
  async function extractFrame() {
    const frame = currentFrame;
    if (!frame || !projectHistory) return;
    const selected = await chooseSave({ filters:{'PNG image':['png']}, title:'Extract frame' });
    if (!selected || selected.scheme !== 'file' || currentFrame !== frame) return;
    const destination = selected.fsPath;
    try {
      if (path.extname(destination).toLowerCase() !== '.png') throw new Error('Choose a PNG file');
      const protectedFiles = projectHistory.snapshot().assets.map(sourcePath); if (projectPath) protectedFiles.push(projectPath);
      for (const file of protectedFiles) {
        if (path.resolve(file) === path.resolve(destination)) throw new Error('Cannot overwrite project or source media');
        try { const [a,b]=await Promise.all([fs.stat(file),fs.stat(destination)]); if (a.dev===b.dev && a.ino===b.ino) throw new Error('Cannot overwrite project or source media'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const temp=path.join(path.dirname(destination),`.${crypto.randomUUID()}.tmp`);
      try { await fs.writeFile(temp,frame.data,{flag:'wx'}); await fs.rename(temp,destination); }
      finally { await fs.rm(temp,{force:true}); }
      if (panel) void panel.webview.postMessage({type:'frameSaved'});
    } catch(error) { void vscode.window.showErrorMessage(`Cannot extract frame: ${error.message}`); }
  }
  let engineRun = 0;
  let activeCheck;
  async function checkEngine() {
    const id = ++engineRun;
    activeCheck?.abort();
    activeCheck = new AbortController();
    const signal = activeCheck.signal;
    const send = message => { if (id === engineRun && panel) void panel.webview.postMessage(message); };
    send({ type: 'engine', status: 'checking' });
    try {
      const config = vscode.workspace.getConfiguration('videoEditor');
      const ffmpeg = config.get('ffmpegPath') || 'ffmpeg';
      const ffprobe = config.get('ffprobePath') || 'ffprobe';
      for (const file of [ffmpeg, ffprobe]) if (file !== 'ffmpeg' && file !== 'ffprobe' && !path.isAbsolute(file)) throw Object.assign(new Error('Configured paths must be absolute'), { code: 'INVALID_PATH' });
      const result = await inspectEngine({ ffmpeg, ffprobe, signal });
      const missing = Object.entries(result.required).filter(([, ok]) => !ok).map(([name]) => name);
      send({ type: 'engine', status: 'ready', summary: `${result.ffmpegVersion} | Input: ${result.canRead ? 'available' : 'unavailable'} | Export: ${result.canExport ? 'available' : 'unavailable'}${missing.length ? ` | Missing: ${missing.join(', ')}` : ''}` });
    } catch (error) {
      if (error.code === 'CANCELLED') return;
      const messages = { ENOENT: 'FFmpeg or ffprobe not found.', EACCES: 'Cannot execute FFmpeg or ffprobe.', TIMEOUT: 'Engine check timed out.', OUTPUT_LIMIT: 'Engine output exceeded limit.', INVALID_PATH: 'Configured paths must be absolute.', VERSION_MISMATCH: 'FFmpeg and ffprobe versions differ.', INVALID_VERSION: 'Invalid engine version output.' };
      send({ type: 'engine', status: 'error', summary: `${messages[error.code] || 'Engine check failed.'} Check Video Editor settings and install FFmpeg from a trusted source.` });
    }
  }
  context.subscriptions.push(vscode.commands.registerCommand('videoEditor.checkEngine', checkEngine));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('videoEditor.ffmpegPath') || event.affectsConfiguration('videoEditor.ffprobePath')) void checkEngine(); }));
  context.subscriptions.push(vscode.commands.registerCommand('videoEditor.open', () => {
    if (panel) { panel.reveal(); return; }
    mode = 'preview';
    panel = vscode.window.createWebviewPanel('videoEditor', 'Video Editor', vscode.ViewColumn.One, {
      enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'src')], retainContextWhenHidden: true
    });
    const current = panel;
    const nonce = crypto.randomBytes(16).toString('base64');
    const script = current.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'src', 'webview.js'));
    current.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:;"><style nonce="${nonce}">body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:1rem}button{font:inherit;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:1px solid transparent;padding:.5rem .8rem;cursor:pointer}button:hover{background:var(--vscode-button-hoverBackground)}button:focus-visible{outline:2px solid var(--vscode-focusBorder)}button[aria-pressed=true]{border-color:var(--vscode-focusBorder)}main{margin-top:1rem;border:1px solid var(--vscode-panel-border);padding:2rem;min-height:12rem}#error{color:var(--vscode-errorForeground)}#frame-image{max-width:100%;max-height:50vh}#timeline-scroll{overflow:auto;max-width:100%;border:1px solid var(--vscode-panel-border)}.track{position:relative;height:3rem;border-bottom:1px solid var(--vscode-panel-border);min-width:100%}.track-label{position:sticky;left:0;z-index:2;background:var(--vscode-editor-background)}.timeline-ruler{height:1.5rem}.ruler-mark{position:absolute;font-size:.75em}.playhead{position:absolute;color:var(--vscode-charts-red);top:0}.timeline-clip{position:absolute;top:1.1rem;height:1.8rem;overflow:hidden;white-space:nowrap;padding:0 .3rem}.timeline-clip[aria-pressed=true]{outline:2px solid var(--vscode-focusBorder)}.media-preview{display:block;max-width:100%;height:auto;margin:.25rem 0}</style></head><body><header><h1>Video Editor</h1><p id="project-name">No project open</p><div role="group" aria-label="Editor mode"><button id="preview" aria-pressed="true">Preview</button> <button id="edit" aria-pressed="false">Edit</button></div> <button id="save-project">Save project</button></header><main><h2 id="mode-heading">Preview</h2><p id="empty">No media is open.</p><img id="frame-image" alt="Selected video frame" hidden><p id="frame-info" role="status"></p><progress id="frame-progress" max="100" aria-label="Frame processing progress" hidden></progress> <button id="cancel-frame" hidden>Cancel frame processing</button><div><button id="prev-frame" disabled>Previous frame</button> <button id="next-frame" disabled>Next frame</button> <label>Frame <input id="frame-number" type="number" min="1" disabled></label> <button id="go-frame" disabled>Go</button> <label>Time (seconds) <input id="frame-time" type="number" min="0" step="any" disabled></label> <button id="go-time" disabled>Seek</button> <button id="extract-frame" disabled>Extract frame</button></div></main><section id="timeline-panel" aria-label="Timeline" hidden><h2>Timeline</h2><p>Positions are project frame numbers (starting at 0).</p><div id="timeline-toolbar"><button id="timeline-undo">Undo</button> <button id="timeline-redo">Redo</button> <label>Position <input id="timeline-frame" type="number" min="0" max="100000000" value="0"></label> <label><input id="timeline-snap" type="checkbox" checked>Snap</label> <button id="clip-move">Move</button> <button id="clip-trim-start">Trim start</button> <button id="clip-trim-end">Trim end</button> <button id="clip-split">Split</button> <button id="clip-delete">Delete</button> <button id="clip-ripple">Ripple delete</button> <button id="zoom-out">−</button> <button id="zoom-in">+</button></div><p id="timeline-status" role="status"></p><div id="timeline-scroll" tabindex="0" aria-label="Timeline tracks"><div id="timeline-tracks"></div></div></section><section aria-label="Project media"><h2>Project media</h2><button id="import-media">Import media</button><ul id="media-list"></ul></section><section aria-label="Media engine"><h2>Media engine</h2><p id="engine-status" role="status">Not checked</p><button id="check-engine">Check engine</button></section><p id="error" role="alert" hidden></p><script nonce="${nonce}" data-e2e="${process.env.VIDEO_EDITOR_E2E === '1' ? '1' : '0'}" src="${script}"></script></body></html>`;
    current.webview.onDidReceiveMessage(message => {
      if (message && message.type === 'ready' && projectHistory) { schedulePreviews(); projectNotice(); }
      if (message && message.type === 'saveProject') { void vscode.commands.executeCommand('videoEditor.saveProject'); return; }
      if (message && message.type === 'timelineAction') {
        try {
          if (mode !== 'edit') throw new Error('Switch to Edit mode to change clips');
          if (!projectHistory || !message.command || typeof message.command !== 'object') throw new Error('Open a project first');
          if (message.command.action === 'add' && assetStatuses.find(asset => asset.id === message.command.assetId)?.status !== 'available') throw new Error('Media is unavailable');
          const history=projectHistory, before=history.snapshot();
          const result=timeline.edit(history,message.command);
          if (result.revision !== before.revision) projectDirty=true;
          const ids=new Set(result.assets.map(asset=>asset.id));
          for (const asset of before.assets) if (!ids.has(asset.id)) { clearPreviews(asset.id); if (selection?.assetId===asset.id) resetFrame(); }
          if (before.assets.length !== result.assets.length || before.assets.some(asset=>!ids.has(asset.id))) {
            const checkPath=projectPath || path.join(context.globalStorageUri.fsPath,'untitled.json');
            void inspectAssets(checkPath,result).then(statuses=>{ if (projectHistory===history && history.snapshot().revision===result.revision) { assetStatuses=statuses; schedulePreviews(); projectNotice(); } }).catch(()=>{ if (projectHistory===history) void vscode.window.showErrorMessage('Cannot refresh media status.'); });
          }
          projectNotice();
          void current.webview.postMessage({type:'timelineResult',ok:true});
        } catch (error) { void current.webview.postMessage({type:'timelineResult',ok:false,message:error.message}); projectNotice(); }
        return;
      }
      if (message && message.type === 'importMedia') { void importMedia(); return; }
      if (message && message.type === 'selectMedia' && typeof message.assetId === 'string') { void selectMedia(message.assetId); return; }
      if (message && message.type === 'frameCancel') {
        frameRequest++; activeFrame?.abort(); activeFrame=undefined;
        if (currentFrame && selection && currentFrame.assetId === selection.assetId) void current.webview.postMessage({type:'frame',image:currentFrame.data.toString('base64'),index:currentFrame.index,count:selection.frames.length,time:selection.frames[currentFrame.index]});
        else { selection=undefined; void current.webview.postMessage({type:'frameCancelled'}); }
        return;
      }
      if (message && message.type === 'frameStep' && currentFrame && (message.step === 1 || message.step === -1)) { void showFrame(currentFrame.index + message.step); return; }
      if (message && message.type === 'frameJump' && Number.isSafeInteger(message.index)) { void showFrame(message.index); return; }
      if (message && message.type === 'frameSeek' && selection && typeof message.seconds === 'string') {
        try {
          const target=add(decimalTime(selection.frames[0]),decimalTime(message.seconds));
          let low=0, high=selection.frames.length-1;
          if (compare(target,decimalTime(selection.frames[high])) > 0) throw new Error('Time is outside indexed frames');
          while (low < high) { const mid=Math.ceil((low+high)/2); if (compare(decimalTime(selection.frames[mid]),target)<=0) low=mid; else high=mid-1; }
          void showFrame(low);
        } catch { void vscode.window.showErrorMessage('Invalid frame time.'); }
        return;
      }
      if (message && message.type === 'extractFrame') { void extractFrame(); return; }
      if (message && message.type === 'relink' && typeof message.assetId === 'string') { void relink(message.assetId); return; }
      if (message && message.type === 'checkEngine') { void checkEngine(); return; }
      if (process.env.VIDEO_EDITOR_E2E === '1' && message && message.type === 'testState') { testState = message.state; return; }
      const result = handleMessage(mode, message);
      mode = result.mode;
      void current.webview.postMessage({ type: 'state', mode, error: result.error });
    }, null, context.subscriptions);
    current.onDidDispose(() => { if (panel === current) { panel = undefined; engineRun++; activeCheck?.abort(); resetFrame(); clearPreviews(); } testState = undefined; }, null, context.subscriptions);
  }));
  if (process.env.VIDEO_EDITOR_E2E === '1') {
    context.subscriptions.push(vscode.commands.registerCommand('videoEditor.test.dialogs', (...items) => { testDialogs.push(...items); }));
    context.subscriptions.push(vscode.commands.registerCommand('videoEditor.test.timeline', (control,frame) => panel && panel.webview.postMessage({type:'testTimeline',control,frame})));
    context.subscriptions.push(vscode.commands.registerCommand('videoEditor.test.seek', seconds => panel && panel.webview.postMessage({type:'testSeek',seconds})));
    context.subscriptions.push(vscode.commands.registerCommand('videoEditor.test.ui', action => panel && panel.webview.postMessage({ type:'testUI', action })));
    context.subscriptions.push(vscode.commands.registerCommand('videoEditor.test.relink', () => panel && panel.webview.postMessage({ type: 'testRelink' })));
    context.subscriptions.push(vscode.commands.registerCommand('videoEditor.test.state', () => testState));
    context.subscriptions.push(vscode.commands.registerCommand('videoEditor.test.activateEdit', () => panel && panel.webview.postMessage({ type: 'testActivateEdit' })));
  }
}
function deactivate() {}
module.exports = { activate, deactivate };
