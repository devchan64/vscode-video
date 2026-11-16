'use strict';
const fs = require('fs');
const path = require('path');
const { runTests } = require('@vscode/test-electron');
const root = path.resolve(__dirname, '../..');
const testDir = path.join(root, '.vscode-test');
async function main() {
  for (const name of ['workspace', 'user-data', 'extensions']) fs.mkdirSync(path.join(testDir, name), { recursive: true });
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, 'suite.js'),
    ...(process.env.VSCODE_EXECUTABLE_PATH ? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH } : { reuseMachineInstall: true }),
    launchArgs: [path.join(testDir, 'workspace'), '--user-data-dir', path.join(testDir, 'user-data'), '--extensions-dir', path.join(testDir, 'extensions'), '--disable-workspace-trust', '--headless', '--disable-gpu', '--no-sandbox', '--ozone-platform=headless', '--remote-debugging-port=19227', '--remote-debugging-address=127.0.0.1', '--remote-allow-origins=*'],
    extensionTestsEnv: { VIDEO_EDITOR_E2E: '1' }
  });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
