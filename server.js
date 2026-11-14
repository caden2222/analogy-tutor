const express = require('express');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const scriptedProvider = require('./server/provider');
const { createGroqProvider, readConfig, ModelError } = require('./server/groq-provider');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['story','check','explain','technical','correction','partial','answer','definition']);
const SESSION_TTL = 30 * 60 * 1000;

function createApp(options = {}) {
 const config = options.config || readConfig();
 const generatedProvider = options.generatedProvider || createGroqProvider(config);
 const app = express();
 const sessions = new Map();
 let activeGenerations=0;
 let minuteRequests=[];
 let day=new Date().toISOString().slice(0,10),dailyRequests=0;
 app.disable('x-powered-by');
 app.use('/api',(req,res,next)=>{
  res.set('Cache-Control','no-store');
  if(req.get('sec-fetch-site')==='cross-site')return res.status(403).json({error:'Use the tutor from this server’s page.'});
  next();
 });
 app.use('/api',express.json({limit:'8kb',strict:true}));
 function pruneSessions(){const cutoff=Date.now()-SESSION_TTL;for(const [id,session] of sessions)if(!session.pending&&session.updatedAt<cutoff)sessions.delete(id);}
 const cleanup=setInterval(pruneSessions,60000);cleanup.unref();
 app.post('/api/session',(req,res)=>{
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='mode')||(body.mode!==undefined&&!['scripted','generated'].includes(body.mode)))return res.status(400).json({error:'Choose scripted or generated mode.'});
  pruneSessions();
  if(sessions.size>=1000)return res.status(503).json({error:'The demo is busy. Try again later.'});
  const sessionId=randomUUID(),mode=body.mode||'scripted';
  sessions.set(sessionId,{mode,history:[],requests:new Map(),pending:null,updatedAt:Date.now()});
  res.status(201).json({sessionId,mode,model:mode==='generated'?generatedProvider.model:undefined,requestTimeoutMs:config.timeoutMs+5000});
 });
 app.use(['/api/chat','/api/reset'],(req,res,next)=>{
  const id=req.get('x-session-id');
  if(!id||!UUID.test(id))return res.status(400).json({error:'A valid session ID is required.'});
  const session=sessions.get(id);
  if(!session||(!session.pending&&Date.now()-session.updatedAt>SESSION_TTL)){
   sessions.delete(id);return res.status(410).json({error:'Your session expired or the server restarted. Start again to begin a new conversation.'});
  }
  req.session=session;session.updatedAt=Date.now();next();
 });
 function validate(req,res,allowed){
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!allowed.includes(key))) {res.status(400).json({error:'Send a JSON object with the supported fields.'});return false;}
  if(typeof body.requestId!=='string'||!UUID.test(body.requestId)){res.status(400).json({error:'A valid request ID is required.'});return false;}
  return true;
 }
 function send(res,result){if(result.retryAfter)res.set('Retry-After',String(result.retryAfter));return res.status(result.status).json(result.body);}
 function remember(session,id,fingerprint,response){session.requests.set(id,{fingerprint,response});if(session.requests.size>20)session.requests.delete(session.requests.keys().next().value);}
 function completed(req,res,fingerprint){
  const cached=req.session.requests.get(req.body.requestId);if(!cached)return false;
  if(cached.fingerprint!==fingerprint)res.status(409).json({error:'That request ID was already used for a different request.'});else res.json(cached.response);
  return true;
 }
 function throttle(){
  const now=Date.now(),today=new Date(now).toISOString().slice(0,10);
  if(today!==day){day=today;dailyRequests=0;}
  minuteRequests=minuteRequests.filter(time=>time>now-60000);
  if(dailyRequests>=config.perDay)throw new ModelError(429,'LOCAL_DAILY_LIMIT','The local daily generated-request limit is reached. Scripted mode remains available; no fallback was used.',3600);
  if(minuteRequests.length>=config.perMinute)throw new ModelError(429,'LOCAL_MINUTE_LIMIT','The local generated-request limit is reached. Wait a minute before retrying.',60);
  if(activeGenerations>=1)throw new ModelError(503,'MODEL_BUSY','Another generated reply is being prepared. Please wait and retry.',5);
  minuteRequests.push(now);dailyRequests++;
 }
 app.post('/api/chat',async(req,res)=>{
  if(!validate(req,res,['requestId','action','message']))return;
  const {action,message,requestId}=req.body;
  if((action!==undefined&&(typeof action!=='string'||!ACTIONS.has(action)))||(message!==undefined&&(typeof message!=='string'||!message.trim()||message.length>2000))||(!action&&!message))return res.status(400).json({error:'Use a supported action or a non-empty message of at most 2,000 characters.'});
  const session=req.session,fingerprint=JSON.stringify(['chat',action,message]);
  if(completed(req,res,fingerprint))return;
  if(session.pending){
   if(session.pending.id===requestId&&session.pending.fingerprint===fingerprint)return send(res,await session.pending.promise);
   return res.status(409).json({error:'A different request is still running for this conversation. Wait before retrying or resetting.'});
  }
  const generated=session.mode==='generated';
  try{if(generated)throttle();}catch(error){return send(res,{status:error.status,body:{error:error.message,code:error.code},retryAfter:error.retryAfter});}
  if(generated)activeGenerations++;
  // Register the shared promise before yielding to network I/O. Identical retries await it.
  const promise=(async()=>{
   try{
    const provider=generated?generatedProvider:scriptedProvider;
    const reply=await provider.respond({action,message,history:generated&&session.originalTurns?[...session.originalTurns,...session.history.slice(session.history[0]===session.originalTurns[0]?2:0)]:session.history});
    session.history.push({role:'learner',text:message?message.trim():action},{role:'tutor',...reply});
    session.history=session.history.slice(-100);
    // Preserve the original story for generated follow-ups while bounding retained history.
    if(generated&&!session.originalTurns)session.originalTurns=session.history.slice(0,2);
    const body={mode:session.mode,scripted:!generated,model:generated?generatedProvider.model:undefined,reply};
    remember(session,requestId,fingerprint,body);
    return {status:200,body};
   }catch(error){
    if(error instanceof ModelError)return {status:error.status,body:{error:error.message,code:error.code},retryAfter:error.retryAfter};
    return {status:500,body:{error:'The tutor could not complete the request. Your message was not added. Please retry.'}};
   }finally{if(generated)activeGenerations--;session.updatedAt=Date.now();}
  })();
  session.pending={id:requestId,fingerprint,promise};
  const result=await promise;session.pending=null;
  return send(res,result);
 });
 app.post('/api/reset',(req,res)=>{
  if(!validate(req,res,['requestId']))return;
  const session=req.session;
  if(session.pending)return res.status(409).json({error:'Wait for the current reply before resetting this conversation.'});
  if(completed(req,res,'reset'))return;
  session.history=[];session.originalTurns=undefined;session.requests.clear();
  const body={scripted:session.mode==='scripted',mode:session.mode,reset:true};
  remember(session,req.body.requestId,'reset',body);res.json(body);
 });
 app.use('/api',(req,res)=>res.status(404).json({error:'API endpoint not found.'}));
 app.use(express.static(path.join(__dirname,'public'),{dotfiles:'deny'}));
 app.use((req,res)=>res.status(404).send('Not found'));
 app.use((error,req,res,next)=>{
  if(error.type==='entity.too.large')return res.status(413).json({error:'Request too large. Keep messages below 2,000 characters.'});
  if(error.type==='entity.parse.failed')return res.status(400).json({error:'The request body must be valid JSON.'});
  // Do not log request bodies, provider responses, headers or secrets.
  res.status(500).json({error:'The tutor server could not complete the request. Please retry.'});
 });
 return {app,sessions,close:()=>clearInterval(cleanup)};
}
if(require.main===module){const {app}=createApp();const port=Number(process.env.PORT||3000);app.listen(port,'127.0.0.1',()=>console.log(`Analogy Tutor: http://localhost:${port}`));}
module.exports={createApp};
