'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTool, inspectEngine } = require('../../src/media/engine');

test('real FFmpeg encodes, probes and seeks VP9/Opus fixtures', { timeout: 60000 }, async () => {
  const engine = await inspectEngine();
  assert.ok(engine.canRead && engine.canExport, JSON.stringify(engine));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-editor-fixture-'));
  try {
    for (const variant of ['cfr', 'fractional', 'vfr']) {
      const output = path.join(dir, `${variant} 한글.webm`);
      const fps = variant === 'fractional' ? '30000/1001' : '10';
      const args = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=64x48:rate=${fps}:duration=1`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1'];
      if (variant === 'vfr') args.push('-vf', "select='not(eq(mod(n,3),1))'", '-vsync', 'vfr');
      args.push('-c:v', 'libvpx-vp9', '-lossless', '1', '-g', '30', '-c:a', 'libopus', '-shortest', '-y', output);
      await runTool('ffmpeg', args, { timeoutMs: 30000 });
      const info = JSON.parse((await runTool('ffprobe', ['-v', 'error', '-show_streams', '-show_frames', '-select_streams', 'v:0', '-of', 'json', output])).stdout);
      assert.equal(info.streams[0].codec_name, 'vp9');
      const frames = info.frames.filter(frame => frame.best_effort_timestamp_time !== undefined);
      assert.ok(frames.length >= 5, `${variant}: ${frames.length}`);
      const index = 3, time = frames[index].best_effort_timestamp_time;
      const frame = async input => (await runTool('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...input, '-an', '-vsync', '0', '-frames:v', '1', '-f', 'md5', '-'], { timeoutMs: 15000 })).stdout.trim();
      const linear = await frame(['-i', output, '-vf', `select=eq(n\\,${index})`]);
      const seek = await frame(['-seek_timestamp', '1', '-ss', time, '-i', output]);
      assert.equal(seek, linear, `${variant} seek at ${time}`);
      const audio = JSON.parse((await runTool('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'json', output])).stdout);
      assert.equal(audio.streams[0].codec_name, 'opus');
      await runTool('ffmpeg', ['-v', 'error', '-i', output, '-f', 'null', '-'], { timeoutMs: 15000 });
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
