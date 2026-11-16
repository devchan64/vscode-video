'use strict';
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const { performance }=require('node:perf_hooks');
const { runTool }=require('../src/media/engine');
const { indexFrames, decodeFrame }=require('../src/media/frames');
async function main() {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'frame-seek-benchmark-'));
 try {
  const file=path.join(dir,'synthetic.webm'), dest=path.join(dir,'frame.png');
  await runTool('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=60','-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-g','60','-y',file],{timeoutMs:120000});
  const t=performance.now(),frames=await indexFrames(file,0), indexingMs=performance.now()-t;
  const index=frames.length-5, optimized=[], sequential=[];
  for(let i=0;i<3;i++) {
   let start=performance.now(); const a=await decodeFrame(file,0,index,dest,'ffmpeg',undefined,{records:frames.records}); optimized.push(Math.round(performance.now()-start));
   start=performance.now(); const b=await decodeFrame(file,0,index,dest); sequential.push(Math.round(performance.now()-start));
   if(!a.equals(b)) throw new Error('Frame mismatch');
  }
  console.log(JSON.stringify({video:'synthetic testsrc2 VP9 320x180 30fps 60s GOP 60',frames:frames.length,indexingMs:Math.round(indexingMs),target:index,optimizedMs:optimized,sequentialMs:sequential},null,2));
 } finally {await fs.rm(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
