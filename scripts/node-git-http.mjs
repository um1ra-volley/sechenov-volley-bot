import {execFileSync} from 'node:child_process';
export class NodeGitHttp {
 constructor(token,barrier){this.token=token;this.barrier=barrier;this.waited=false}
 request(method,url,body,headers={}){
  if(!url.startsWith('https://api.github.com/repos/'))throw new Error('Unexpected API host');
  if(this.barrier&&!this.waited&&method==='POST'&&url.endsWith('/git/trees')){
   this.waited=true;const view=new Int32Array(this.barrier);Atomics.add(view,0,1);Atomics.notify(view,0);
   while(Atomics.load(view,0)<2){const result=Atomics.wait(view,0,1,20000);if(result==='timed-out')throw new Error('Concurrent smoke barrier timed out');}
  }
  const values={Authorization:'Bearer '+this.token,Accept:'application/vnd.github+json',...headers};
  let config='url = '+JSON.stringify(url)+'\nrequest = '+JSON.stringify(method)+'\n';
  for(const[key,value]of Object.entries(values))config+='header = '+JSON.stringify(key+': '+value)+'\n';
  if(body!==undefined)config+='header = "Content-Type: application/json"\ndata = '+JSON.stringify(JSON.stringify(body))+'\n';
  let output;try{output=execFileSync('curl',['--silent','--show-error','--location','--max-time','30','--config','-','--write-out','\n%{http_code}'],{input:config,encoding:'utf8',maxBuffer:8*1024*1024});}catch{throw new Error('HTTPS transport failed');}
  const cut=output.lastIndexOf('\n');return {status:Number(output.slice(cut+1)),body:output.slice(0,cut),headers:{}};
 }
}
