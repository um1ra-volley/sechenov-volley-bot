import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {GitHubStateRepository} from '../src/adapters/github/repository.ts';
import {createState} from '../src/core/state.ts';
import {NodeGitHttp} from './node-git-http.mjs';
const token=process.env.GITHUB_TOKEN,repo=process.env.GITHUB_REPOSITORY,branch=process.env.SMOKE_BRANCH;
assert.ok(token&&repo&&/^codex\/smoke-\d+-\d+$/.test(branch??''),'Controlled smoke configuration required');
assert.equal(typeof GitHubStateRepository.prototype.initialise,'function','Repository bootstrap not implemented');
const http=new NodeGitHttp(token),repository=new GitHubStateRepository({http,token,repo,branch,runtime:{id:'smoke',epoch:1},clock:{now:()=>new Date().toISOString()}});
let created=false;
try{
 repository.initialise(createState('smoke',1));created=true;
 const barrier=new SharedArrayBuffer(4);
 const run=user=>new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./smoke-worker.mjs',import.meta.url),{workerData:{branch,user,barrier}});
  worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code)reject(new Error('Concurrent smoke worker failed'));});
 });
 await Promise.all([run('2001'),run('2002')]);
 const current=repository.read();assert.deepEqual(Object.keys(current.users).sort(),['2001','2002']);
 const read=http.request('GET','https://api.github.com/repos/'+repo+'/git/ref/heads/'+branch);
 const head=JSON.parse(read.body).object.sha;
 console.log(JSON.stringify({privateSmoke:true,participants:2,conflictSafe:true,commit:head}));
}finally{
 if(created){const removed=http.request('DELETE','https://api.github.com/repos/'+repo+'/git/refs/heads/'+branch);assert.equal(removed.status,204,'Temporary test branch cleanup failed');}
}
