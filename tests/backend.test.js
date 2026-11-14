const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { createApp } = require('../server');

async function fixture(t, options = {}) {
 const instance = createApp(options);
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
 const ids=['conversation','controls','message','request-status','retry','demo','starts','prior','knowledge','actions','message-form','reset','tutor-mode','mode-description','demo-mode-label'];
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


const {createGroqProvider,readConfig,ModelError,contextMessages}=require('../server/groq-provider');
const generatedReply={key:'generated',text:'A reply about values',sections:[{type:'answer',text:'<b>A value carries information, not a score.</b>'}]};
const testConfig=()=>readConfig({GROQ_API_KEY:'test-key-not-real',MODEL_TIMEOUT_MS:'1000',GENERATED_REQUESTS_PER_MINUTE:'10'});
const responseFor=sections=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({sections})}}]}),{headers:{'Content-Type':'application/json'}});

test('generated requests send correct instructions/history and do not expose the key', async t=>{
 let sent;
 const config=testConfig();
 const provider=createGroqProvider(config,async(url,options)=>{sent={url,options};return responseFor(generatedReply.sections)});
 const f=await fixture(t,{config,generatedProvider:provider});
 const id=(await f.post('/api/session',{mode:'generated'})).body.sessionId;
 const response=await f.chat(id,{message:'Is the value the score?'});
 assert.equal(response.status,200);assert.equal(response.body.scripted,false);assert.equal(response.body.mode,'generated');
 const payload=JSON.parse(sent.options.body);
 assert.equal(sent.url,'https://api.groq.com/openai/v1/chat/completions');
 assert.equal(sent.options.headers.Authorization,'Bearer test-key-not-real');
 assert.equal(payload.model,'openai/gpt-oss-120b');assert.equal(payload.stream,false);
 assert.equal(payload.max_completion_tokens,1024);assert.equal(payload.reasoning_effort,'low');
 assert.match(payload.messages[0].content,/Values are not scores/);
 assert.match(payload.messages.at(-1).content,/Is the value the score/);
 assert(!JSON.stringify(response.body).includes(config.apiKey));
 await f.chat(id,{message:'Why?'});
 const followup=JSON.parse(sent.options.body).messages;
 assert(followup.some(m=>m.role==='assistant'&&m.content.includes('value carries')));
 for(const file of ['/server/groq-provider.js','/server/tutor-instructions.md','/.env.example'])assert.equal((await fetch(f.base+file)).status,404);
});

test('simultaneous identical retries share one generation and one history write', async t=>{
 let calls=0,release,started;
 const startedPromise=new Promise(resolve=>{started=resolve});
 const provider={model:'mock',respond:async()=>{calls++;started();await new Promise(resolve=>{release=resolve});return generatedReply}};
 const f=await fixture(t,{config:testConfig(),generatedProvider:provider});
 const id=(await f.post('/api/session',{mode:'generated'})).body.sessionId;
 const body={requestId:randomUUID(),message:'What is a value?'};
 const first=f.post('/api/chat',body,id);await startedPromise;
 const second=f.post('/api/chat',body,id);
 assert.equal((await f.chat(id,{message:'a different request'})).status,409);
 assert.equal((await f.post('/api/reset',{requestId:randomUUID()},id)).status,409);
 release();const [a,b]=await Promise.all([first,second]);
 assert.deepEqual(a,b);assert.equal(calls,1);assert.equal(f.sessions.get(id).history.length,2);
 await f.post('/api/chat',body,id);assert.equal(calls,1);
});

test('generated histories are isolated; reset and mode pinning preserve boundaries', async t=>{
 const seen=[];
 const f=await fixture(t,{config:testConfig(),generatedProvider:{model:'mock',respond:async({history})=>{seen.push(history.map(turn=>turn.text));return generatedReply}}});
 const a=(await f.post('/api/session',{mode:'generated'})).body.sessionId;
 const b=(await f.post('/api/session',{mode:'generated'})).body.sessionId;
 await f.chat(a,{message:'Private A'});await f.chat(b,{message:'Private B'});await f.chat(a,{message:'Follow up'});
 assert.deepEqual(seen[1],[]);assert(seen[2].includes('Private A'));assert(!seen[2].includes('Private B'));
 assert.equal((await f.chat(a,{message:'switch',mode:'scripted'})).status,400);
 await f.post('/api/reset',{requestId:randomUUID()},a);await f.chat(a,{message:'after reset'});assert.deepEqual(seen[3],[]);
 assert.equal(f.sessions.get(a).mode,'generated');
 assert.equal((await f.post('/api/session',{mode:'paid-auto-fallback'})).status,400);
});

test('local minute/day limits throttle generated attempts without affecting scripted mode', async t=>{
 const config={...testConfig(),perMinute:1};let calls=0;
 const f=await fixture(t,{config,generatedProvider:{model:'mock',respond:async()=>{calls++;return generatedReply}}});
 const id=(await f.post('/api/session',{mode:'generated'})).body.sessionId;
 await f.chat(id,{message:'one'});const blocked=await f.chat(id,{message:'two'});
 assert.equal(blocked.status,429);assert.equal(blocked.body.code,'LOCAL_MINUTE_LIMIT');assert.equal(calls,1);
 const scripted=await f.newSession();assert.equal((await f.chat(scripted,{action:'story'})).status,200);
 const daily=await fixture(t,{config:{...testConfig(),perDay:1},generatedProvider:{model:'mock',respond:async()=>generatedReply}});
 const dailyId=(await daily.post('/api/session',{mode:'generated'})).body.sessionId;
 await daily.chat(dailyId,{message:'one'});assert.equal((await daily.chat(dailyId,{message:'two'})).body.code,'LOCAL_DAILY_LIMIT');
});

test('unconfigured generated mode makes no external request and never falls back', async t=>{
 let calls=0;const config=readConfig({});
 const provider=createGroqProvider(config,async()=>{calls++;throw Error('should not call')});
 const f=await fixture(t,{config,generatedProvider:provider});
 const id=(await f.post('/api/session',{mode:'generated'})).body.sessionId;
 const result=await f.chat(id,{action:'story'});
 assert.equal(result.status,503);assert.equal(result.body.code,'NOT_CONFIGURED');assert.equal(calls,0);assert.deepEqual(f.sessions.get(id).history,[]);
});

test('provider errors, invalid JSON, truncation and oversized responses are safe', async()=>{
 for(const [status,code] of [[401,'PROVIDER_AUTH'],[403,'PROVIDER_AUTH'],[404,'MODEL_UNAVAILABLE'],[429,'PROVIDER_LIMIT'],[500,'PROVIDER_FAILURE']]){
  const provider=createGroqProvider(testConfig(),async()=>new Response('secret test-key-not-real',{status}));
  await assert.rejects(provider.respond({message:'hello',history:[]}),e=>e.code===code&&!e.message.includes('test-key-not-real'));
 }
 for(const response of [new Response('not JSON'),new Response(JSON.stringify({choices:[{finish_reason:'length'}]})),responseFor([{type:'bad',text:'hello'}]),responseFor([{type:'answer',text:''}]),new Response('x'.repeat(70000))]){
  const provider=createGroqProvider(testConfig(),async()=>response);
  await assert.rejects(provider.respond({message:'hello',history:[]}),e=>e instanceof ModelError&&e.status===502);
 }
 const missing=createGroqProvider(testConfig(),async()=>responseFor(generatedReply.sections));
 await assert.rejects(missing.respond({action:'story',history:[]}),e=>e.code==='INVALID_MODEL_RESPONSE');
});

test('timeouts abort once, do not append history, and keep useful error codes', async t=>{
 let calls=0;
 const provider=createGroqProvider({...testConfig(),timeoutMs:20},async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))});
 const f=await fixture(t,{config:testConfig(),generatedProvider:provider});
 const id=(await f.post('/api/session',{mode:'generated'})).body.sessionId;
 const result=await f.chat(id,{message:'hello'});
 assert.equal(result.status,504);assert.equal(result.body.code,'MODEL_TIMEOUT');assert.equal(calls,1);assert.equal(f.sessions.get(id).history.length,0);
});

test('context retains the original story and newest complete turns',()=>{
 const history=Array.from({length:30},(_,i)=>({role:i%2?'tutor':'learner',text:`turn ${i}`}));
 const selected=contextMessages(history,8000);
 assert.equal(selected[0].content,'turn 0');assert.equal(selected[1].content,'turn 1');assert.equal(selected.at(-1).content,'turn 29');assert(selected.length<=12);
 assert.throws(()=>readConfig({MODEL_TIMEOUT_MS:'-1'}),/MODEL_TIMEOUT_MS/);
});

test('frontend accepts generated sections safely, pins mode and retries errors', async t=>{
 let reject=false;
 const f=await fixture(t,{config:testConfig(),generatedProvider:{model:'mock',respond:async()=>{if(reject)throw new ModelError(429,'PROVIDER_LIMIT','Mock quota reached.');return generatedReply}}});
 const b=browser(f);b.elements['tutor-mode'].value='generated';b.elements['tutor-mode'].listeners.change();
 await b.run("chat(null,'What is a value?',{start:true})");
 const text=browserText(b.elements.conversation);
 assert.match(text,/generated by Groq/);assert.match(text,/<b>A value carries information/);
 assert.equal(b.elements['tutor-mode'].disabled,true);
 reject=true;b.elements.message.value='Keep my question';await b.run('chat(null,input.value,{fromInput:true})');
 assert.equal(b.elements.message.value,'Keep my question');assert.match(b.elements['request-status'].textContent,/Mock quota/);
 reject=false;await b.run('run(failedOperation)');assert.equal(b.elements.message.value,'');
 await b.run('run({reset:true,body:{requestId:crypto.randomUUID()}})');
 assert.equal(b.elements['tutor-mode'].disabled,false);assert.equal(b.run('sessionId'),null);
});

test('context character cap holds for very long original and recent turns',()=>{
 const history=Array.from({length:30},(_,i)=>({role:i%2?'tutor':'learner',text:'x'.repeat(6000)}));
 const context=contextMessages(history,4000);
 assert(context.reduce((sum,item)=>sum+item.content.length,0)<=4000);
 assert(context.length>=4);
});
