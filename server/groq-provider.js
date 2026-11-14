const { readFileSync } = require('node:fs');
const path = require('node:path');

function integer(env, name, fallback, min, max) {
 const value = env[name] === undefined || env[name] === '' ? fallback : Number(env[name]);
 if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}: use an integer from ${min} to ${max}.`);
 return value;
}
function readConfig(env = process.env) {
 const model = (env.GROQ_MODEL || 'openai/gpt-oss-120b').trim();
 if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.:-]{1,127}$/.test(model)) throw new Error('Invalid GROQ_MODEL.');
 return {
  apiKey: (env.GROQ_API_KEY || '').trim(),
  model,
  timeoutMs: integer(env,'MODEL_TIMEOUT_MS',25000,1000,60000),
  maxOutputTokens: integer(env,'MODEL_MAX_OUTPUT_TOKENS',1024,256,2048),
  contextChars: integer(env,'MODEL_CONTEXT_CHARS',8000,4000,16000),
  perMinute: integer(env,'GENERATED_REQUESTS_PER_MINUTE',2,1,10),
  perDay: integer(env,'GENERATED_REQUESTS_PER_DAY',50,1,1000)
 };
}
const sectionTitles = {story:'A familiar story',concept:'Connect it to the concept',limitation:'Where the analogy stops',check:'Optional understanding check',answer:'Your question',technical:'The real mechanism',feedback:'What to keep and what to fix'};
class ModelError extends Error {
 constructor(status, code, message, retryAfter) { super(message); this.status=status; this.code=code; this.retryAfter=retryAfter; }
}
// Keep the original story plus the newest turns. Omitted middle turns are not summarised or invented.
function contextMessages(history, budget) {
 const maxPerMessage=Math.floor(budget/4);
 const turns=history.map(item=>({role:item.role==='tutor'?'assistant':'user',content:item.text.length>maxPerMessage?item.text.slice(0,maxPerMessage-12)+' [shortened]':item.text}));
 const original=turns.slice(0,2);
 let used=original.reduce((sum,item)=>sum+item.content.length,0);
 const recent=[];
 for(let end=turns.length;end>2;end-=2){
  const pair=turns.slice(Math.max(2,end-2),end);
  const size=pair.reduce((sum,item)=>sum+item.content.length,0);
  if(recent.length>=10||used+size>budget)break;
  recent.unshift(...pair);used+=size;
 }
 return [...original,...recent];
}
function createGroqProvider(config = readConfig(), fetchImpl = fetch) {
 const instructions=readFileSync(path.join(__dirname,'tutor-instructions.md'),'utf8');
 return {
  model:config.model,
  async respond({action,message,history}) {
   if (!config.apiKey || config.apiKey === 'replace_with_your_key') throw new ModelError(503,'NOT_CONFIGURED','Generated mode is not configured. Enter your Groq key in the local .env file and restart the server.');
   const controller=new AbortController();
   const timer=setTimeout(()=>controller.abort(),config.timeoutMs);
   try {
    const response=await fetchImpl('https://api.groq.com/openai/v1/chat/completions',{
     method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`},signal:controller.signal,
     body:JSON.stringify({model:config.model,stream:false,reasoning_effort:'low',max_completion_tokens:config.maxOutputTokens,
      messages:[{role:'system',content:instructions},...contextMessages(history,config.contextChars),{role:'user',content:`Requested tutor action: ${action || 'answer the learner directly'}\nLearner message: ${message || ''}`}],
      response_format:{type:'json_schema',json_schema:{name:'tutor_reply',strict:true,schema:{type:'object',additionalProperties:false,required:['sections'],properties:{sections:{type:'array',items:{type:'object',additionalProperties:false,required:['type','text'],properties:{type:{type:'string',enum:Object.keys(sectionTitles)},text:{type:'string'}}}}}}}}
     })
    });
    if(!response.ok){
     if(response.status===429)throw new ModelError(429,'PROVIDER_LIMIT','Groq’s quota is reached. Wait before retrying. No paid or scripted fallback was used.',60);
     if(response.status===401||response.status===403)throw new ModelError(502,'PROVIDER_AUTH','Groq rejected the key or access. Check the key and project permissions locally; do not paste the key into chat.');
     if(response.status===400)throw new ModelError(502,'MODEL_REQUEST_REJECTED','Groq rejected the request settings. Check that GROQ_MODEL supports strict structured replies and the configured limits.');
     if(response.status===404)throw new ModelError(502,'MODEL_UNAVAILABLE','The configured Groq model is unavailable. Check GROQ_MODEL and your account’s model access.');
     throw new ModelError(502,'PROVIDER_FAILURE','Groq could not complete the request. Please try again later.');
    }
    // Bound the HTTP response before JSON parsing. Never log upstream bodies or headers.
    const reader=response.body.getReader();const chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw new ModelError(502,'INVALID_MODEL_RESPONSE','The model response exceeded the size limit.');}chunks.push(Buffer.from(value));}
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const choice=data.choices?.[0];
    if(choice?.finish_reason!=='stop')throw new ModelError(502,'INCOMPLETE_RESPONSE','The model did not finish a complete answer within the output limit. No partial answer was added.');
    const result=JSON.parse(choice.message.content);
    const sections=result.sections;
    if(!Array.isArray(sections)||sections.length<1||sections.length>6||sections.some(section=>!section||!Object.hasOwn(sectionTitles,section.type)||typeof section.text!=='string'||!section.text.trim()||section.text.length>2000)||new Set(sections.map(s=>s.type)).size!==sections.length||sections.reduce((sum,s)=>sum+s.text.length,0)>6000)throw new Error('Invalid sections');
    if(action==='story'&&!['story','concept','limitation','check'].every(type=>sections.some(section=>section.type===type)))throw new Error('Missing story sections');
    return {key:'generated',sections,text:sections.map(section=>`${sectionTitles[section.type]}\n${section.text}`).join('\n\n')};
   } catch(error) {
    if(error instanceof ModelError)throw error;
    if(controller.signal.aborted)throw new ModelError(504,'MODEL_TIMEOUT','Groq took too long to reply. Your input is kept. An explicit retry may be processed again by the provider.');
    if(error instanceof SyntaxError||error.message==='Invalid sections'||error.message==='Missing story sections')throw new ModelError(502,'INVALID_MODEL_RESPONSE','The model returned an invalid teaching response. Nothing was added to the conversation.');
    throw new ModelError(502,'MODEL_CONNECTION','Could not reach Groq or read a valid response. Check connectivity and retry.');
   } finally {clearTimeout(timer);}
  }
 };
}
module.exports={createGroqProvider,readConfig,ModelError,contextMessages};
