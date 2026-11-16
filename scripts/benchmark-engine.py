#!/usr/bin/env python3
"""Local FFmpeg subprocess benchmark; generates no persistent media."""
import json
import os
import platform
import resource
import statistics
import subprocess
import tempfile
import time


def timed(args):
    start = time.perf_counter()
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    return round(time.perf_counter() - start, 3)


def summary(values):
    return {'seconds': values, 'median_seconds': round(statistics.median(values), 3)}


def main():
    ffmpeg = os.environ.get('VIDEO_FFMPEG', 'ffmpeg')
    ffprobe = os.environ.get('VIDEO_FFPROBE', 'ffprobe')
    with tempfile.TemporaryDirectory(prefix='video-editor-benchmark-') as directory:
        file = os.path.join(directory, 'fixture.webm')
        base = [ffmpeg, '-hide_banner', '-loglevel', 'error']
        encode = base + ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', '4', '-threads', '4', '-g', '60', '-b:v', '1M', '-c:a', 'libopus', '-shortest', '-y', file]
        decode = base + ['-i', file, '-f', 'null', '-']
        seek = base + ['-ss', '1.5', '-i', file, '-an', '-frames:v', '1', '-f', 'null', '-']
        probe = [ffprobe, '-v', 'error', '-show_streams', '-of', 'json', file]
        timings = {}
        for name, command in [('encode', encode), ('decode', decode), ('seek_frame', seek), ('probe', probe)]:
            timed(command)  # warm-up; encode also creates the input file
            timings[name] = summary([timed(command) for _ in range(3)])
        result = {'platform': platform.platform(), 'cpu_logical': os.cpu_count(), 'ffmpeg_version': subprocess.check_output([ffmpeg, '-version'], text=True).splitlines()[0], 'fixture': {'size': '1280x720', 'fps': 30, 'seconds': 3, 'video': 'libvpx-vp9', 'audio': 'libopus', 'bytes': os.path.getsize(file), 'encode_options': 'deadline=good cpu-used=4 threads=4 g=60 video=1M'}, 'runs': 3, 'warmup': 1, 'timings': timings, 'max_child_rss_kib_cumulative': resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss, 'rss_note': 'Linux: maximum among completed child processes, not per-operation or concurrent memory'}
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
