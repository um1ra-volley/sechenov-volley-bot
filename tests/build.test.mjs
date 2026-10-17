import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import vm from 'node:vm';
test('built Apps Script exposes runnable globals and authenticates before outbound network',()=>{
 assert.ok(existsSync('dist/Code.gs'),'Apps Script build artifact missing');
 const code=readFileSync('dist/Code.gs','utf8'),properties={WEBHOOK_SECRET:'s'.repeat(40),OWNER_SETUP_SECRET:'o'.repeat(40),TELEGRAM_BOT_TOKEN:'9'.repeat(9)+':'+ 'x'.repeat(35),BOT_GITHUB_TOKEN:'synthetic-github-token',RUNTIME_ID:'gas-primary',RUNTIME_EPOCH:'1'};
 let outbound=0;
 const context=vm.createContext({Intl,Date,JSON,console,PropertiesService:{getScriptProperties:()=>({getProperties:()=>properties,getProperty:k=>properties[k]})},UrlFetchApp:{fetch(){outbound++;throw new Error('Unexpected outbound request')},fetchAll(){outbound++;throw new Error('Unexpected outbound request')}},HtmlService:{createHtmlOutput:text=>({getContent:()=>text})}});
 vm.runInContext(code,context);
 for(const name of ['doPost','scheduledTick','setup','status','configureWebhook','pauseRuntime'])assert.equal(typeof context[name],'function',name+' missing');
 assert.throws(()=>context.doPost({pathInfo:'wrong',postData:{type:'application/json',contents:'{}'}}),/webhook|доступ/i);
 assert.equal(outbound,0);
 const manifest=JSON.parse(readFileSync('dist/appsscript.json','utf8'));assert.equal(manifest.timeZone,'Europe/Moscow');assert.equal(manifest.runtimeVersion,'V8');
 assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets.readonly'));
 assert.equal(/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/.test(code),false);
});
