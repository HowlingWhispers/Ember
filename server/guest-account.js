// Ember guest account routes. Feature-gated, separate from the Orbis handoff.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createGuestVault, GUEST_COOKIE_AGE } from "./guest-vault.js";
import { generateNovelAI, EmberProviderError } from "./novelai.js";
import {DEFAULT_REPLY_LENGTH,replyLength,PERSONA_TURN_LENGTH} from "../src/reply-length.js";
import { normalizePersonaDraft,personaNameFromPrompt } from "../src/persona-turn.js";
import {PERSONA_CREATIVITY} from "../src/persona-options.js";
const COOKIE="ember.guest";
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
function writeJson(res,status,data) {
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8"});
  res.end(JSON.stringify(data));
}
function getCookie(request) {
  for(const cookie of String(request.headers.cookie||"").split(";")){
    const [name,...value]=cookie.trim().split("=");
    if(name===COOKIE && TOKEN.test(value.join("=")))return value.join("=");
  }
  return null;
}
async function readJson(request,limit) {
  if(!String(request.headers["content-type"]||"").startsWith("application/json"))
    throw Object.assign(new Error("JSON required."),{status:415});
  let bytes=0;
  const chunks=[];
  for await(const chunk of request){
    bytes+=chunk.length;
    if(bytes>limit)throw Object.assign(new Error("Request is too large."),{status:413});
    chunks.push(chunk);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}
  catch{throw Object.assign(new Error("Invalid request body."),{status:400});}
}
function mutatingAllowed(request,origin,intent) {
  return request.headers.origin===origin && request.headers["x-ember-request"]===intent;
}
export function createGuestAccess({env,fetchFn=globalThis.fetch,rootDir,secureCookie,webOrigin}) {
  if(env.EMBER_GUEST_ENABLED!=="1")return null;
  const vaultPromise=createGuestVault({
    directory:env.EMBER_GUEST_DATA_DIR,
    encryptionKey:env.EMBER_GUEST_ENCRYPTION_KEY,
  });
  const inFlight=new Set();
  const lastPaidRequest=new Map();
  const guestCookie=token=>COOKIE+"="+token+"; Path=/ember/; HttpOnly; SameSite=Lax"
    +(secureCookie?"; Secure":"")+"; Max-Age="+GUEST_COOKIE_AGE;
  async function identity(request) {
    const token=getCookie(request);
    if(!token)return null;
    const vault=await vaultPromise;
    const profile=await vault.identify(token);
    return profile?{token,...profile}:null;
  }
  async function serve(request,response,path) {
    const vault=await vaultPromise;
    let person=await identity(request);
    let cookie;
    if(!person){
      const created=await vault.create();
      person={token:created.token,profileId:created.profileId,hasNovelAI:false,model:null};
      cookie=guestCookie(created.token);
    }
    const filename=path==="/ember/account"?"account.html":"index.html";
    const content=await readFile(join(rootDir,filename));
    response.writeHead(200,{"Content-Type":"text/html; charset=utf-8",
      ...(cookie?{"Set-Cookie":cookie}:{})});
    response.end(content);
  }
  async function handle(request,response,method,path) {
    if(method==="GET" && (path==="/ember/" || path==="/ember/account")){
      await serve(request,response,path);return true;
    }
    if(!path.startsWith("/ember/api/guest/"))return false;
    const person=await identity(request);
    if(!person){writeJson(response,401,{error:"Open Ember first to create a temporary guest account."});return true;}
    const vault=await vaultPromise;
    if(path==="/ember/api/guest/session" && method==="GET"){
      writeJson(response,200,{identity:"guest",userId:person.profileId,mode:"sandbox",asset:null});
      return true;
    }
    if(path==="/ember/api/guest/provider"){
      if(method==="GET"){
        writeJson(response,200,{configured:person.hasNovelAI,model:person.model});
        return true;
      }
      if(method==="PUT" || method==="DELETE"){
        if(!mutatingAllowed(request,webOrigin,"guest-settings")){
          writeJson(response,403,{error:"Invalid account request origin."});return true;
        }
        try{
          const body=await readJson(request,5000);
          if(method==="PUT"){
            if(!body || typeof body!=="object" || Array.isArray(body)
              || Object.keys(body).sort().join(",")!=="apiKey,model"){
              writeJson(response,400,{error:"Invalid provider settings."});return true;
            }
            const saved=await vault.saveNovelAI(person.token,body);
            writeJson(response,200,saved);
          }else{
            if(!body || body.confirm!==true || Object.keys(body).length!==1){
              writeJson(response,400,{error:"Confirm provider key removal."});return true;
            }
            await vault.clearNovelAI(person.token);
            writeJson(response,200,{configured:false,model:null});
          }
        }catch(error){
          writeJson(response,error.status||400,{error:error.status===413?"Request is too large.":"Invalid provider settings."});
        }
        return true;
      }
    }
    if(path==="/ember/api/guest/generate" && method==="POST"){
      if(!mutatingAllowed(request,webOrigin,"generation")){
        writeJson(response,403,{error:"Invalid generation request origin."});return true;
      }
      let body;
      try{body=await readJson(request,26000);}
      catch(error){writeJson(response,error.status||400,{error:"Invalid generation request."});return true;}
      const personaTask=body?.task==="persona";
      const shape=body && typeof body==="object" && !Array.isArray(body) ? Object.keys(body).sort().join(",") : "";
      const acceptedShapes=personaTask ? ["prompt,task","length,prompt,task","creativity,prompt,task","creativity,length,prompt,task"] : ["prompt","length,prompt"];
      if(!body || typeof body!=="object" || Array.isArray(body)
        || !acceptedShapes.includes(shape)
        || (personaTask && body.creativity!==undefined && !PERSONA_CREATIVITY.some(x=>x.value===body.creativity))
        || (body.task!==undefined && !personaTask)
        || typeof body.prompt!=="string" || !body.prompt.startsWith("EMBER / FREEFORM ROLEPLAY\n")
        || body.prompt.length<80 || body.prompt.length>22000
        || (personaTask
          ? !body.prompt.endsWith("\nPLAYER:\n")
            || !body.prompt.includes("[PLAYER PERSONA V2 (PLAYER CONTROLLED): FICTION REFERENCE DATA]")
            || !body.prompt.includes("Write ONE proposed PLAYER turn")
          : !body.prompt.endsWith("\nNARRATOR:"))){
        writeJson(response,400,{error:"Invalid Ember story context."});return true;
      }
      let lengthSettings;
      try {lengthSettings=replyLength(body.length??DEFAULT_REPLY_LENGTH);}
      catch {
        writeJson(response,400,{error:"Choose Short, Normal or Long generation length."});return true;
      }
      const current=Date.now();
      if(inFlight.has(person.profileId)){
        writeJson(response,429,{error:"A reply is already generating.",code:"EMBER_BUSY"});return true;
      }
      if(current-(lastPaidRequest.get(person.profileId)||0)<10000){
        writeJson(response,429,{error:"Wait a moment before generating again.",code:"EMBER_RATE_LIMIT"});return true;
      }
      inFlight.add(person.profileId);
      try{
        const settings=await vault.getNovelAIForServer(person.token);
        if(!settings){writeJson(response,409,{error:"Add your NovelAI API key in Ember Account settings.",code:"NOVELAI_NOT_CONFIGURED"});return true;}
        lastPaidRequest.set(person.profileId,Date.now());
        const result=await generateNovelAI({
          token:settings.apiKey,model:settings.model,prompt:body.prompt,fetchFn,
          maxTokens:personaTask ? PERSONA_TURN_LENGTH.maxTokens : lengthSettings.maxTokens,
          maxWords:personaTask ? PERSONA_TURN_LENGTH.maxWords : lengthSettings.maxWords,
          ...(personaTask ? {temperature:PERSONA_CREATIVITY.find(x=>x.value===(body.creativity||"high")).temperature}:{}),
        });
        const draft=personaTask ? normalizePersonaDraft(result.text,{personaName:personaNameFromPrompt(body.prompt)}) : null;
        const text=draft?.text ?? result.text;
        writeJson(response,200,{text,...(result.shortened || draft?.shortened ? {shortened:true} : {})});
      }catch(error){
        const e=error instanceof EmberProviderError?error:null;
        writeJson(response,e?.status||502,{
          error:e?.message||"Ember could not generate a reply.",
          code:e?.code||"EMBER_GENERATION_ERROR",
        });
      }finally{inFlight.delete(person.profileId);}
      return true;
    }
    writeJson(response,404,{error:"Unknown guest account route."});
    return true;
  }
  return {handle,identity,ready:()=>vaultPromise};
}
