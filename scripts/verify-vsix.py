import json
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as archive:
    names = set(archive.namelist())
    required = {'extension/package.json', 'extension/src/extension.js', 'extension/src/protocol.js', 'extension/src/webview.js', 'extension/src/media/engine.js', 'extension/src/media/probe.js', 'extension/src/media/frames.js', 'extension/src/media/preview-cache.js', 'extension/src/model/time.js', 'extension/src/model/timeline.js', 'extension/src/model/project.js', 'extension/src/model/storage.js'}
    missing = required - names
    forbidden = [name for name in names if any(part in name.split('/') for part in ('node_modules', 'test', '.vscode-test', 'third_party'))]
    manifest = json.loads(archive.read('extension/package.json'))
    if missing or forbidden or manifest.get('dependencies'):
        raise SystemExit(f'VSIX verification failed: missing={missing}, forbidden={forbidden}, runtime_dependencies={manifest.get("dependencies")}')
    print('VSIX verified:', len(names), 'files; no packaged dependencies or test files')
