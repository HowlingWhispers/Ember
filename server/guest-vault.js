// Durable Ember guest profiles and encrypted provider keys.
// Server-only module. Never place the data directory below an HTTP-served tree.
import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const COOKIE_PATTERN=/^[A-Za-z0-9_-]{43}$/;
const MODEL_CHOICES=new Set(["xialong-v1","glm-4-6"]);
export const GUEST_SCHEMA=1;
export const GUEST_COOKIE_AGE=180*24*3600;
export function requireVaultConfig({directory,encryptionKey}) {
  if(typeof directory!=="string" || !isAbsolute(directory) || !directory.trim())
    throw new Error("Ember's guest data directory must be an absolute path.");
  const dataDir=resolve(directory);
  if(dataDir===APP_ROOT || dataDir.startsWith(APP_ROOT+"/"))
    throw new Error("The guest vault must not live under the application checkout.");
  if(typeof encryptionKey!=="string" || !/^[a-f0-9]{64}$/i.test(encryptionKey))
    throw new Error("Configure a 32-byte hex EMBER_GUEST_ENCRYPTION_KEY.");
  return {dataDir,key:Buffer.from(encryptionKey,"hex")};
}
function assertProfile(p) {
  if(!p || p.schema!==GUEST_SCHEMA || typeof p.profileId!=="string"
    || !/^[0-9a-f-]{36}$/i.test(p.profileId) || !Number.isSafeInteger(p.createdAt)
    || !p.provider || typeof p.provider!=="object")
    throw new Error("Guest profile storage is unreadable; data was not overwritten.");
  return p;
}
function hashToken(token) {
  if(typeof token!=="string" || !COOKIE_PATTERN.test(token)) return null;
  return createHash("sha256").update(token,"utf8").digest("hex");
}
function encrypt(token,key,profileId) {
  const iv=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",key,iv);
  cipher.setAAD(Buffer.from(profileId,"utf8"));
  const value=Buffer.concat([cipher.update(token,"utf8"),cipher.final()]);
  return {iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),ciphertext:value.toString("base64")};
}
function decrypt(value,key,profileId) {
  if(!value || !["iv","tag","ciphertext"].every(field=>typeof value[field]==="string"))
    throw new Error("Stored credential is unreadable.");
  const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(value.iv,"base64"));
  decipher.setAAD(Buffer.from(profileId,"utf8"));
  decipher.setAuthTag(Buffer.from(value.tag,"base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext,"base64")),decipher.final()]).toString("utf8");
}
export async function createGuestVault({directory,encryptionKey}) {
  const {dataDir,key}=requireVaultConfig({directory,encryptionKey});
  await mkdir(dataDir,{recursive:true,mode:0o700});
  const folder=await stat(dataDir);
  if(!folder.isDirectory() || (folder.mode & 0o077)!==0)
    throw new Error("Guest data directory permissions must prohibit group/other access.");
  const locks=new Map();
  const filename=token=>{const hash=hashToken(token);return hash?join(dataDir,hash+".json"):null;};
  async function read(token) {
    const file=filename(token);
    if(!file)return null;
    let bytes;
    try {bytes=await readFile(file,"utf8");}
    catch(e){if(e?.code==="ENOENT")return null;throw e;}
    const profile=assertProfile(JSON.parse(bytes));
    if(!Number.isSafeInteger(profile.updatedAt)) throw new Error("Guest profile timestamps are invalid.");
    return profile;
  }
  async function atomicWrite(file,profile,first=false) {
    if(first){await writeFile(file,JSON.stringify(profile),{flag:"wx",mode:0o600});return;}
    const tmp=file+"."+randomBytes(8).toString("hex")+".tmp";
    try{
      await writeFile(tmp,JSON.stringify(profile),{flag:"wx",mode:0o600});
      await rename(tmp,file);
    }catch(e){await unlink(tmp).catch(()=>{});throw e;}
  }
  async function lock(token,fn) {
    const id=hashToken(token);
    if(!id)throw new Error("Invalid guest session.");
    const previous=locks.get(id)||Promise.resolve();
    const operation=previous.catch(()=>{}).then(fn);
    const done=operation.then(()=>{},()=>{});
    locks.set(id,done);
    try{return await operation;}finally{if(locks.get(id)===done)locks.delete(id);}
  }
  return {
    async create() {
      for(let i=0;i<3;i++){
        const token=randomBytes(32).toString("base64url");
        const now=Date.now();
        const profile={schema:GUEST_SCHEMA,profileId:randomUUID(),createdAt:now,updatedAt:now,provider:{}};
        try {await atomicWrite(filename(token),profile,true);return {token,profileId:profile.profileId};}
        catch(e){if(e?.code!=="EEXIST")throw e;}
      }
      throw new Error("Could not allocate a new guest profile.");
    },
    async identify(token) {
      const profile=await read(token);
      return profile?{profileId:profile.profileId,hasNovelAI:Boolean(profile.provider.novelai),model:profile.provider.novelai?.model||null}:null;
    },
    async saveNovelAI(token,{model,apiKey}) {
      if(!MODEL_CHOICES.has(model))throw new Error("Unsupported NovelAI model.");
      if(typeof apiKey!=="string" || apiKey.length<10 || apiKey.length>4096)
        throw new Error("Invalid NovelAI credential.");
      return lock(token,async()=>{
        const profile=await read(token);
        if(!profile)throw new Error("Guest profile unavailable.");
        const next={...profile,updatedAt:Date.now(),provider:{...profile.provider,
          novelai:{model,sealed:encrypt(apiKey,key,profile.profileId)}}};
        await atomicWrite(filename(token),next);
        return {configured:true,model};
      });
    },
    async getNovelAIForServer(token) {
      const profile=await read(token);
      if(!profile)return null;
      const provider=profile.provider.novelai;
      return provider?{model:provider.model,apiKey:decrypt(provider.sealed,key,profile.profileId)}:null;
    },
    async clearNovelAI(token) {
      return lock(token,async()=>{
        const profile=await read(token);
        if(!profile)throw new Error("Guest profile unavailable.");
        const provider={...profile.provider};delete provider.novelai;
        await atomicWrite(filename(token),{...profile,provider,updatedAt:Date.now()});
      });
    },
  };
}
