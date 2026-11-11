const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { createApp } = require('../server');

async function fixture(t) {
 const instance = createApp();
 const server = instance.app.listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 t.after(() => { instance.close(); server.closeAllConnections(); server.close(); });
 const base = `http://127.0.0.1:${server.address().port}`;
 async function post(path, body, sessionId) {
  const response = await fetch(base + path, {method:'POST', headers:{'Content-Type':'application/json', ...(sessionId ? {'X-Session-Id':sessionId} : {})}, body:JSON.stringify(body)});
  return {status:response.status, body:await response.json()};
 }
 const newSession = async () => (await post('/api/session', {})).body.sessionId;
 const chat = (id, body) => post('/api/chat', {requestId:randomUUID(), ...body}, id);
 return {...instance, base, post, newSession, chat};
}

test('scripted teaching flow and isolated histories', async t => {
 const f=await fixture(t), a=await f.newSession(), b=await f.newSession();
 assert.notEqual(a,b);
 assert.match((await f.chat(a,{action:'story'})).body.reply.text,/library/);
 assert.match((await f.chat(a,{message:'Is the value the score?'})).body.reply.text,/No. The value/);
 assert.equal((await f.chat(a,{message:'The query is what I need, the key helps match it, and the value is the score.'})).body.reply.key,'partial');
 assert.match((await f.chat(a,{action:'technical'})).body.reply.text,/\[8, 2\]/);
 await f.chat(a,{action:'check'});
 assert.equal((await f.chat(a,{message:'[1, 6]'})).body.reply.key,'feedback');
 assert.equal((await f.chat(b,{message:'[1, 6]'})).body.reply.key,'fallback');
 assert.match((await f.chat(a,{action:'answer'})).body.reply.text,/\[1, 6\]/);
 const beforeB=structuredClone(f.sessions.get(b).history);
 const reset=await f.post('/api/reset',{requestId:randomUUID()},a);
 assert.equal(reset.body.reset,true);
 assert.deepEqual(f.sessions.get(a).history,[]);
 assert.deepEqual(f.sessions.get(b).history,beforeB);
 assert.equal((await f.chat(a,{message:'[1, 6]'})).body.reply.key,'fallback');
});

test('all scripted actions, definitions, safe strings, and bounded history', async t => {
 const f=await fixture(t), id=await f.newSession();
 for(const action of ['story','check','explain','technical','correction','partial','answer','definition']) {
  const r=await f.chat(id,{action});assert.equal(r.status,200);assert.equal(r.body.scripted,true);assert.equal(r.body.reply.key,action);
 }
 assert.equal((await f.chat(id,{message:'What is a value?'})).body.reply.key,'definition');
 const html='<img src=x onerror=alert(1)>';
 await f.chat(id,{message:html});assert.equal(f.sessions.get(id).history.at(-2).text,html);
 for(let i=0;i<55;i++)await f.chat(id,{message:'hello'});
 assert.equal(f.sessions.get(id).history.length,100);
 assert.equal(f.sessions.get(id).requests.size,20);
});

test('request IDs prevent duplicate writes and mismatched reuse', async t => {
 const f=await fixture(t), id=await f.newSession(), body={requestId:randomUUID(),action:'check'};
 const a=await f.post('/api/chat',body,id), b=await f.post('/api/chat',body,id);
 assert.deepEqual(a,b);assert.equal(f.sessions.get(id).history.length,2);
 assert.equal((await f.post('/api/chat',{...body,action:'story'},id)).status,409);
 const reset={requestId:randomUUID()};
 await f.post('/api/reset',reset,id);await f.post('/api/reset',reset,id);
 assert.equal(f.sessions.get(id).history.length,0);
});

test('validation, payload limits, missing/expired sessions', async t => {
 const f=await fixture(t), id=await f.newSession();
 for(const body of [{}, {message:''}, {message:5}, {message:'x'.repeat(2001)}, {action:'__proto__'}, {action:[]}, {action:'story',history:[]}, {action:'story',requestId:'bad'}]) {
  assert.equal((await f.chat(id,body)).status,400,JSON.stringify(body));
 }
 assert.equal((await f.post('/api/chat',{requestId:randomUUID(),action:'story'})).status,400);
 assert.equal((await f.post('/api/chat',{requestId:randomUUID(),action:'story'},randomUUID())).status,410);
 const raw=body=>fetch(f.base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Id':id},body});
 assert.equal((await raw('{')).status,400);
 assert.equal((await raw(JSON.stringify({message:'x'.repeat(9000)}))).status,413);
 assert.equal((await raw('[]')).status,400);
 assert.equal(f.sessions.get(id).history.length,0);
 f.sessions.get(id).updatedAt=0;
 assert.equal((await f.chat(id,{action:'story'})).status,410);
 assert.equal(f.sessions.has(id),false);
});

test('only public browser assets are served', async t => {
 const f=await fixture(t);
 for(const url of ['/','/styles.css','/app.js']) assert.equal((await fetch(f.base+url)).status,200,url);
 for(const url of ['/server.js','/server/content.js','/content.js','/provider.js','/package.json','/README.md','/.env','/.git/config','/tests/backend.test.js','/public/../server.js']) {
  assert.equal((await fetch(f.base+url)).status,404,url);
 }
});

// Minimal DOM harness exercises real frontend code against the real HTTP server.
function browser(f) {
 let mode='normal', calls=0, release;
 class Element {
  constructor(){this.children=[];this.listeners={};this.hidden=false;this.value='';this.dataset={};this.textContent='';this.disabled=false;}
  append(...items){this.children.push(...items)}
  addEventListener(name,fn){this.listeners[name]=fn}
  setAttribute(){}
  focus(){}
  replaceChildren(){this.children=[]}
 }
 const ids=['conversation','controls','message','request-status','retry','demo','starts','prior','knowledge','actions','message-form','reset'];
 const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
 const starts=[new Element(),new Element()];starts[0].dataset.start='scratch';starts[1].dataset.start='little';
 const demoButtons=()=>[...starts,...elements.actions.children,elements.reset,elements.retry];
 const document={querySelector:s=>s==='[data-start]'?starts[0]:elements[s.slice(1)],querySelectorAll:s=>s==='[data-start]'?starts:s.includes('textarea')?[...demoButtons(),elements.message,elements.knowledge]:demoButtons(),createElement:()=>new Element()};
 const context=vm.createContext({document,crypto:{randomUUID},AbortController,setTimeout,clearTimeout,fetch:async (path,options)=>{
  calls++;
  if(mode==='fail')throw new TypeError('offline');
  if(mode==='delay'){mode='normal';await new Promise(resolve=>{release=resolve})}
  const response=await fetch(f.base+path,options);
  if(mode==='drop'){mode='normal';throw new TypeError('response lost')}
  return response;
 }});
 vm.runInContext(fs.readFileSync(require.resolve('../public/app.js'),'utf8'),context);
 return {context,elements,starts,setMode:x=>{mode=x},release:()=>release(),calls:()=>calls,run:code=>vm.runInContext(code,context),text:node=>node.textContent+node.children.map(child=>browserText(child)).join('')};
}
function browserText(node){return node.textContent+node.children.map(browserText).join('')}

test('frontend loading, duplicate prevention, failed input, retry, safe rendering and reset', async t => {
 const f=await fixture(t), b=browser(f);
 await b.run("chat('story', 'Explain from scratch', {start:true})");
 assert.match(browserText(b.elements.conversation),/The library story/);
 const id=b.run('sessionId');
 b.elements.message.value='Is the value the score?';b.setMode('fail');
 await b.run("chat(null,input.value,{fromInput:true})");
 assert.match(b.elements['request-status'].textContent,/server is running/);
 assert.equal(b.elements.message.value,'Is the value the score?');
 assert.equal(b.elements.retry.hidden,false);
 b.setMode('normal');await b.run('run(failedOperation)');
 assert.equal(b.elements.message.value,'');assert.match(browserText(b.elements.conversation),/No. The value/);
 b.elements.message.value='<img src=x onerror=alert(1)>';
 b.setMode('delay');const pending=b.run('chat(null,input.value,{fromInput:true})');
 assert.equal(b.run('busy'),true);assert.equal(b.elements.message.disabled,true);
 const before=b.calls();await b.run("chat('check','duplicate')");assert.equal(b.calls(),before);
 b.release();await pending;
 assert.match(browserText(b.elements.conversation),/<img src=x onerror=alert\(1\)>/);
 const historyBefore=f.sessions.get(id).history.length;
 b.setMode('drop');await b.run("chat('check','check')");
 assert.equal(f.sessions.get(id).history.length,historyBefore+2);
 await b.run('run(failedOperation)');assert.equal(f.sessions.get(id).history.length,historyBefore+2);
 assert.equal(b.elements.conversation.children.length,f.sessions.get(id).history.length);
 await b.run('run({reset:true,body:{requestId:crypto.randomUUID()}})');
 assert.equal(f.sessions.get(id).history.length,0);assert.equal(b.elements.conversation.children.length,0);
});

test('frontend prior knowledge and session expiration recovery', async t => {
 const f=await fixture(t), b=browser(f);
 b.starts[1].listeners.click();assert.equal(b.elements.prior.hidden,false);
 b.elements.knowledge.value='I know queries';
 await b.run("chat('story','I know a little. I know queries',{start:true})");
 const id=b.run('sessionId');f.sessions.get(id).updatedAt=0;
 b.elements.message.value='Keep this';await b.run('chat(null,input.value,{fromInput:true})');
 assert.match(b.elements['request-status'].textContent,/expired/);
 assert.equal(b.elements.message.value,'Keep this');
 b.elements.reset.listeners.click();assert.equal(b.run('sessionId'),null);
 await b.run("chat('story','start',{start:true})");
 assert.notEqual(b.run('sessionId'),id);
});
