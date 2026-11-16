'use strict';
const { spawn } = require('child_process');

function runTool(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs = 10000, signal, maxBytes = 4 * 1024 * 1024, onStderr, discardStderr = false } = options;
    if (signal?.aborted) return reject(Object.assign(new Error('Cancelled'), { code: 'CANCELLED' }));
    let child, reason, size = 0;
    const chunks = [];
    try { child = spawn(file, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { reject(error); return; }
    const stop = code => { if (!reason) reason = code; child.kill(); };
    const timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
    const abort = () => stop('CANCELLED');
    signal?.addEventListener('abort', abort, { once: true });
    const collect = (channel, data) => {
      size += data.length;
      if (size > maxBytes) { stop('OUTPUT_LIMIT'); return; }
      chunks.push({ channel, data });
    };
    child.stdout.on('data', data => collect('stdout', data));
    child.stderr.on('data', data => { if (onStderr) onStderr(data); if (!discardStderr) collect('stderr', data); });
    child.once('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); });
    child.once('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (reason) return reject(Object.assign(new Error(reason), { code: reason }));
      const output = channel => Buffer.concat(chunks.filter(c => c.channel === channel).map(c => c.data)).toString('utf8');
      if (code !== 0) return reject(Object.assign(new Error(`Process failed (${code})`), { code: 'PROCESS_FAILED', exitCode: code }));
      resolve({ stdout: output('stdout'), stderr: output('stderr') });
    });
  });
}
function listNames(text) {
  const names = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*[A-Z.]{1,8}\s+([\w,-]+)\s/);
    if (match) for (const name of match[1].split(',')) names.add(name);
  }
  return names;
}
async function inspectEngine({ ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', signal } = {}) {
  const opts = { signal };
  const [version, probeVersion, encoders, decoders, formats] = await Promise.all([
    runTool(ffmpeg, ['-version'], opts), runTool(ffprobe, ['-version'], opts),
    runTool(ffmpeg, ['-hide_banner', '-encoders'], opts), runTool(ffmpeg, ['-hide_banner', '-decoders'], opts),
    runTool(ffmpeg, ['-hide_banner', '-formats'], opts)
  ]);
  const ffmpegVersion = version.stdout.split('\n')[0], ffprobeVersion = probeVersion.stdout.split('\n')[0];
  const v = ffmpegVersion.match(/^ffmpeg version\s+(\S+)/), p = ffprobeVersion.match(/^ffprobe version\s+(\S+)/);
  if (!v || !p) throw Object.assign(new Error('Invalid FFmpeg or ffprobe version output'), { code: 'INVALID_VERSION' });
  if (v[1] !== p[1]) throw Object.assign(new Error('FFmpeg and ffprobe versions differ'), { code: 'VERSION_MISMATCH' });
  const enc = listNames(encoders.stdout), dec = listNames(decoders.stdout);
  const demux = new Set(), mux = new Set();
  for (const line of formats.stdout.split(/\r?\n/)) {
    const m = line.match(/^\s*([D ])([E ])\s+([\w,-]+)\s/);
    if (m) for (const name of m[3].split(',')) { if (m[1] === 'D') demux.add(name); if (m[2] === 'E') mux.add(name); }
  }
  const required = { vp9Decoder: dec.has('vp9'), opusDecoder: dec.has('opus'), webmInput: demux.has('webm'), vp9Encoder: enc.has('libvpx-vp9'), opusEncoder: enc.has('libopus'), webmOutput: mux.has('webm') };
  return { ffmpegVersion, ffprobeVersion, required, canRead: required.vp9Decoder && required.opusDecoder && required.webmInput, canExport: Object.values(required).every(Boolean) };
}
module.exports = { runTool, inspectEngine, listNames };
