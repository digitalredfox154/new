// Deploy only verified static files to the authorized /test directory.
// No credentials, downloaded commands, root privileges or application access.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
const ROOT='/landing/test', HOME=ROOT+'/.samai-release', REPO='digitalredfox154/new';
const API='https://api.github.com/repos/'+REPO, RAW='https://raw.githubusercontent.com/'+REPO;
const BRANCH='samai-landing-releases', SITE='https://samaiconsulting.ru/test/';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const requireValue=(ok,message)=>{if(!ok)throw new Error(message)};
async function readJson(file){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
async function safeDirectory(dir){requireValue(dir===ROOT||dir.startsWith(ROOT+'/'),'Path outside test');await fs.mkdir(dir,{recursive:true});requireValue(await fs.realpath(dir)===dir,'Symbolic directory not allowed')}
async function atomic(file,data){await safeDirectory(path.dirname(file));const temp=file+'.tmp-'+process.pid;await fs.writeFile(temp,data,{mode:0o644});await fs.rename(temp,file)}
async function fetchBytes(url,limit=3000000){
  requireValue(url.startsWith(API+'/')||url.startsWith(RAW+'/')||url.startsWith(SITE),'Unexpected download host/path');
  const r=await fetch(url,{headers:{'User-Agent':'SAMAI-static-release/1','Cache-Control':'no-cache','Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(20000),redirect:'error'});
  requireValue(r.ok,'HTTP '+r.status+' '+new URL(url).pathname);
  if(r.headers.get('content-length'))requireValue(+r.headers.get('content-length')<=limit,'Response too large');
  const chunks=[];let n=0;for await(const b of r.body){n+=b.length;requireValue(n<=limit,'Response limit exceeded');chunks.push(b)}return Buffer.concat(chunks)
}
async function get(url){return JSON.parse((await fetchBytes(url)).toString('utf8'))}
function validate(m){
  requireValue(m.schema===1&&m.repository===REPO&&m.sourceBranch==='samai-landing'&&m.target==='/test/','Manifest scope mismatch');
  requireValue(/^[a-f0-9]{40}$/.test(m.sourceSha)&&m.release==='04-ci-'+m.sourceSha.slice(0,12),'Invalid source version');
  requireValue(Number.isSafeInteger(m.runId)&&m.runId>0&&Number.isSafeInteger(m.runAttempt)&&m.runAttempt>=1,'Invalid workflow identity');
  requireValue(Array.isArray(m.files)&&m.files.length>=5&&m.files.length<=40,'Invalid file count');
  let total=0;const seen=new Set();
  for(const f of m.files){requireValue(f.path==='index.html'||/^assets\/[a-zA-Z0-9._-]+\.(css|js|png|webp|svg)$/.test(f.path),'Invalid static path');requireValue(!seen.has(f.path)&&!f.path.includes('..'),'Duplicate/unsafe path');seen.add(f.path);requireValue(/^[a-f0-9]{64}$/.test(f.sha256)&&Number.isSafeInteger(f.bytes)&&f.bytes>0&&f.bytes<=3000000,'Invalid file digest/size');total+=f.bytes}
  requireValue(seen.has('index.html')&&total<=10000000,'Missing index or oversized build')
}
async function gate(m){
  const run=await get(API+'/actions/runs/'+m.runId);
  requireValue(run.head_sha===m.sourceSha&&run.head_branch==='samai-landing'&&run.event==='push'&&run.path==='.github/workflows/samai-landing.yml'&&run.run_attempt===m.runAttempt&&run.repository?.full_name===REPO,'Workflow identity mismatch');
  if(run.status!=='completed')return false;
  requireValue(run.conclusion==='success','Workflow not successful');
  const jobs=await get(API+'/actions/runs/'+m.runId+'/attempts/'+m.runAttempt+'/jobs?per_page=100');
  requireValue(jobs.total_count<=100,'Incomplete job list');
  const good=jobs.jobs.find(j=>j.name==='verify-and-package'&&j.conclusion==='success');requireValue(good,'Required job not successful');
  for(const name of ['Mandatory Chromium and Firefox browser gate','Publish tested static release'])requireValue(good.steps.some(s=>s.name===name&&s.conclusion==='success'),'Required step not passed: '+name);
  return true
}
async function status(value){const state={...value,checkedAt:new Date().toISOString()};await atomic(HOME+'/status.json',JSON.stringify(state,null,2)+'\n');console.log(JSON.stringify(state));return state}
async function verifyPublic(m){
  for(const f of m.files){const bytes=await fetchBytes(SITE+f.path+'?verified='+m.sourceSha+'&t='+Date.now(),f.bytes+1);requireValue(bytes.length===f.bytes&&sha(bytes)===f.sha256,'Public file mismatch: '+f.path)}
  const manifest=await get(SITE+'release.json?t='+Date.now());requireValue(manifest.sourceSha===m.sourceSha,'Public release marker mismatch')
}
async function restore(journal){
  const old=await fs.readFile(journal.backup);requireValue(sha(old)===journal.previousIndexHash,'Backup digest mismatch');await atomic(ROOT+'/index.html',old);
  if(journal.previousManifest)await atomic(ROOT+'/release.json',JSON.stringify(journal.previousManifest,null,2)+'\n');else await fs.rm(ROOT+'/release.json',{force:true});
  if(journal.previousState)await atomic(HOME+'/current.json',JSON.stringify(journal.previousState,null,2)+'\n');else await fs.rm(HOME+'/current.json',{force:true});
}
async function tick(){
  const latest=await get(RAW+'/'+BRANCH+'/release.json?t='+Date.now());validate(latest);const current=await readJson(HOME+'/current.json');
  if(current?.sourceSha===latest.sourceSha){requireValue(sha(await fs.readFile(ROOT+'/index.html'))===current.indexHash,'Live index differs from last release');return status({state:'unchanged',release:current.release,sourceSha:current.sourceSha})}
  if(current&&latest.runId<current.runId)return status({state:'stale-manifest-ignored',release:current.release});
  const ref=await get(API+'/git/ref/heads/'+BRANCH);requireValue(/^[a-f0-9]{40}$/.test(ref.object?.sha)&&ref.object.type==='commit','Invalid release branch');
  const releaseSha=ref.object.sha;const m=await get(RAW+'/'+releaseSha+'/release.json');validate(m);requireValue(m.sourceSha===latest.sourceSha,'Release changed during discovery; retry later');
  if(!await gate(m))return status({state:'waiting-for-complete-CI',candidate:m.release,runId:m.runId});
  const stage=HOME+'/releases/'+m.sourceSha;await safeDirectory(stage);
  for(const f of m.files){const bytes=await fetchBytes(RAW+'/'+releaseSha+'/'+f.path,f.bytes+1);requireValue(bytes.length===f.bytes&&sha(bytes)===f.sha256,'Downloaded digest mismatch: '+f.path);await atomic(stage+'/'+f.path,bytes)}
  const html=await fs.readFile(stage+'/index.html','utf8');requireValue(html.includes('noindex')&&html.includes('content="'+m.release+'"')&&html.includes('contact-form'),'Candidate HTML guard failed');
  await safeDirectory(ROOT+'/assets');
  for(const f of m.files.filter(f=>f.path!=='index.html')){const target=ROOT+'/'+f.path;let existing=null;try{const st=await fs.lstat(target);requireValue(st.isFile()&&!st.isSymbolicLink(),'Asset is not a regular file');existing=await fs.readFile(target)}catch(e){if(e.code!=='ENOENT')throw e}if(existing)requireValue(sha(existing)===f.sha256,'Immutable asset collision');else await atomic(target,await fs.readFile(stage+'/'+f.path))}
  const old=await fs.readFile(ROOT+'/index.html');const backup=HOME+'/backups/'+Date.now()+'-'+sha(old).slice(0,16)+'.html';await atomic(backup,old);
  const journal={candidate:m.sourceSha,backup,previousIndexHash:sha(old),previousManifest:await readJson(ROOT+'/release.json'),previousState:current};
  await atomic(HOME+'/journal.json',JSON.stringify(journal,null,2)+'\n');
  await atomic(stage+'/rollback.json',JSON.stringify(journal,null,2)+'\n');
  try{
    await atomic(ROOT+'/index.html',await fs.readFile(stage+'/index.html'));await atomic(ROOT+'/release.json',JSON.stringify(m,null,2)+'\n');await verifyPublic(m);
    const entry={state:'published',release:m.release,sourceSha:m.sourceSha,releaseSha,runId:m.runId,indexHash:m.files.find(f=>f.path==='index.html').sha256,publishedAt:new Date().toISOString(),backup};
    await atomic(HOME+'/current.json',JSON.stringify(entry,null,2)+'\n');
    await atomic(ROOT+'/deployment.json',JSON.stringify({release:m.release,sourceSha:m.sourceSha,runId:m.runId,publishedAt:entry.publishedAt,target:'/test/',verifiedFiles:m.files.length},null,2)+'\n');
    await fs.rm(HOME+'/journal.json');return status(entry)
  }catch(error){await restore(journal);await status({state:'rolled-back',candidate:m.release,error:error.message});throw error}
}
await safeDirectory(HOME);
const command=process.argv[2]||'--once';requireValue(['--once','--watch','--status'].includes(command),'Unknown mode');
if(command==='--status'){console.log(JSON.stringify({current:await readJson(HOME+'/current.json'),status:await readJson(HOME+'/status.json'),lock:await readJson(HOME+'/agent.lock')},null,2));process.exit(0)}
const lockFile=HOME+'/agent.lock';let lock;
try{lock=await fs.open(lockFile,'wx')}catch(e){
  if(e.code!=='EEXIST')throw e;
  const old=await readJson(lockFile);requireValue(old&&Number.isInteger(old.pid),'Invalid lock');let alive=true;
  try{process.kill(old.pid,0)}catch(e){if(e.code==='ESRCH')alive=false;else throw e}
  requireValue(!alive,'Another deployment agent is already running');await fs.unlink(lockFile);lock=await fs.open(lockFile,'wx')
}
await lock.writeFile(JSON.stringify({pid:process.pid,mode:command,startedAt:new Date().toISOString()})+'\n');await lock.close();
let stopping=false;process.on('SIGTERM',()=>{stopping=true});process.on('SIGINT',()=>{stopping=true});
try{
  const pending=await readJson(HOME+'/journal.json');if(pending){await restore(pending);await fs.rm(HOME+'/journal.json');await status({state:'recovered-interrupted-release'})}
  do{
    try{const paused=await readJson(HOME+'/paused.json');if(paused)await status({state:'paused',reason:paused.reason});else await tick()}
    catch(e){await status({state:'error',error:e.message});if(command==='--once')throw e}
    if(command!=='--watch'||stopping)break;await sleep(120000)
  }while(!stopping)
}finally{await fs.rm(lockFile,{force:true})}
