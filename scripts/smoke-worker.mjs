import {parentPort,workerData} from 'node:worker_threads';
import {GitHubStateRepository} from '../src/adapters/github/repository.ts';
import {NodeGitHttp} from './node-git-http.mjs';
const repository=new GitHubStateRepository({http:new NodeGitHttp(process.env.GITHUB_TOKEN,workerData.barrier),token:process.env.GITHUB_TOKEN,repo:process.env.GITHUB_REPOSITORY,branch:workerData.branch,runtime:{id:'smoke',epoch:1},clock:{now:()=>new Date().toISOString()}});
repository.transact({type:'START',operationId:'synthetic-start-'+workerData.user,actorId:workerData.user,data:{chatId:workerData.user}});
parentPort.postMessage({ok:true});
