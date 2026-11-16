'use strict';
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { fileURLToPath, pathToFileURL } = require('url');
const { validateProject } = require('./project');
function assetPath(projectPath, uri) {
  if (typeof uri !== 'string' || !uri) throw new TypeError('Invalid asset URI');
  if (uri.startsWith('file:')) return fileURLToPath(uri);
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || path.isAbsolute(uri)) throw new Error('Unsupported asset URI');
  return path.resolve(path.dirname(projectPath), uri);
}
async function inspectAssets(projectPath, project) {
  validateProject(project);
  return Promise.all(project.assets.map(async asset => {
    try {
      const stats = await fs.stat(assetPath(projectPath,asset.uri));
      if (!stats.isFile()) return { id:asset.id,status:'missing' };
      return { id:asset.id,status: String(stats.size) === asset.fingerprint.size && stats.mtimeMs === asset.fingerprint.modified ? 'available' : 'changed' };
    } catch (error) { if (error.code === 'ENOENT') return { id:asset.id,status:'missing' }; return { id:asset.id,status:'error',code:error.code || 'INVALID_URI' }; }
  }));
}
async function loadProject(filename) {
  const raw=await fs.readFile(filename,'utf8');
  const project=JSON.parse(raw); validateProject(project);
  return { project, assets:await inspectAssets(filename,project) };
}
async function saveProject(filename, project) {
  validateProject(project);
  const resolved=path.resolve(filename);
  for (const asset of project.assets) {
    const source=assetPath(resolved,asset.uri);
    if (source === resolved) throw new Error('Project path is a media source');
    // Existing aliases and hard links must not overwrite source files.
    try { const [targetStat, sourceStat]=await Promise.all([fs.stat(resolved),fs.stat(source)]); if (targetStat.dev===sourceStat.dev && targetStat.ino===sourceStat.ino) throw new Error('Project path is a media source'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const temp=path.join(path.dirname(resolved),`.${path.basename(resolved)}.${crypto.randomUUID()}.tmp`);
  try { await fs.writeFile(temp,JSON.stringify(project,null,2)+'\n',{flag:'wx'}); await fs.rename(temp,resolved); }
  finally { await fs.rm(temp,{force:true}); }
}
async function relinkAsset(projectPath, project, assetId, newPath, probe) {
  validateProject(project);
  if (typeof probe !== 'function' || !path.isAbsolute(newPath)) throw new TypeError('Absolute path and probe required');
  const candidate = structuredClone(project), asset = candidate.assets.find(a => a.id === assetId);
  if (!asset) throw new Error('Asset not found');
  const stat = await fs.stat(newPath);
  if (!stat.isFile()) throw new Error('Media is not a file');
  const info = await probe(newPath);
  const after = await fs.stat(newPath);
  if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) throw new Error('Media changed during inspection');
  if (!info || !Array.isArray(info.streams) || !info.duration) throw new Error('Invalid media probe result');
  for (const old of asset.streams) if (!info.streams.some(stream => stream.index === old.index && stream.kind === old.kind)) throw new Error('Media streams do not match');
  asset.streams = structuredClone(info.streams);
  asset.duration = structuredClone(info.duration);
  asset.fingerprint = { size:String(stat.size), modified:stat.mtimeMs };
  const relative = path.relative(path.dirname(path.resolve(projectPath)),newPath);
  asset.uri = relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative) ? relative : pathToFileURL(newPath).href;
  candidate.revision++;
  validateProject(candidate);
  return candidate;
}
module.exports={assetPath,inspectAssets,loadProject,saveProject,relinkAsset};
