'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runTool, listNames } = require('../../src/media/engine');
test('parses codec names including hyphens', () => {
  const names = listNames(' V....D libvpx-vp9  VP9\n A..... libopus  Opus\n');
  assert.ok(names.has('libvpx-vp9') && names.has('libopus'));
});
test('reports missing tools, failures, timeouts, output limits, and cancellation', async () => {
  await assert.rejects(runTool('/missing/video-editor-tool', []), { code: 'ENOENT' });
  await assert.rejects(runTool(process.execPath, ['-e', 'process.exit(2)']), { code: 'PROCESS_FAILED' });
  await assert.rejects(runTool(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeoutMs: 50 }), { code: 'TIMEOUT' });
  await assert.rejects(runTool(process.execPath, ['-e', 'console.log("x".repeat(10000))'], { maxBytes: 100 }), { code: 'OUTPUT_LIMIT' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runTool(process.execPath, [], { signal: controller.signal }), { code: 'CANCELLED' });
});

test('detects partial capabilities and rejects mismatched tool versions', { skip: process.platform === 'win32' }, async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { inspectEngine } = require('../../src/media/engine');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '엔진 도구 '));
  const ffmpeg = path.join(dir, 'fake ffmpeg');
  const ffprobe = path.join(dir, 'fake ffprobe');
  try {
    fs.writeFileSync(ffmpeg, `#!/bin/sh\ncase "$2" in\n-encoders) printf ' A..... libopus Opus\\n';;\n-decoders) printf ' V..... vp9 VP9\\n A..... opus Opus\\n';;\n-formats) printf ' DE webm WebM\\n';;\nesac\nif [ "$1" = '-version' ]; then echo 'ffmpeg version 1.0'; fi\n`);
    fs.writeFileSync(ffprobe, "#!/bin/sh\necho 'ffprobe version 1.0'\n");
    fs.chmodSync(ffmpeg, 0o755); fs.chmodSync(ffprobe, 0o755);
    const result = await inspectEngine({ ffmpeg, ffprobe });
    assert.equal(result.canRead, true); assert.equal(result.canExport, false);
    assert.equal(result.required.vp9Encoder, false);
    fs.writeFileSync(ffprobe, "#!/bin/sh\necho 'ffprobe version 2.0'\n");
    await assert.rejects(inspectEngine({ ffmpeg, ffprobe }), { code: 'VERSION_MISMATCH' });
    fs.chmodSync(ffprobe, 0o644);
    await assert.rejects(inspectEngine({ ffmpeg, ffprobe }), { code: 'EACCES' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
