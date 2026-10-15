import {normalizeEntryOverrides} from "./lore-overrides.js";
// Ember-only, browser-local asset database. No network calls or Orbis lookups.
const DB_NAME = "hw-ember-library";
const VERSION = 1;
let dbPromise;
function database() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve,reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is unavailable in this browser."));
      const request = indexedDB.open(DB_NAME,VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("assets")) {
          const store = db.createObjectStore("assets",{keyPath:"id"});
          store.createIndex("owner","owner",{unique:false});
        }
        if (!db.objectStoreNames.contains("attachments")) db.createObjectStore("attachments",{keyPath:"key"});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { dbPromise = null; reject(request.error || new Error("Cannot open local library.")); };
      request.onblocked = () => { dbPromise = null; reject(new Error("Close other Ember tabs to upgrade the local library.")); };
    });
  }
  return dbPromise;
}
async function requestResult(storeName, mode, operation) {
  const db = await database();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(storeName,mode);
    const request = operation(tx.objectStore(storeName));
    let value;
    request.onsuccess = () => { value = request.result; };
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error || new Error("Local library operation failed."));
    tx.onabort = () => reject(tx.error || new Error("Local library operation cancelled."));
  });
}
const scope = owner => typeof owner === "string" && owner ? owner : "local";
async function digest(bytes) {
  const hash = await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
export async function listLocalAssets(owner) {
  const all = await requestResult("assets","readonly",s=>s.index("owner").getAll(scope(owner)));
  return all.sort((a,b)=>b.importedAt-a.importedAt);
}
export async function getLocalAsset(owner,id) {
  const asset = await requestResult("assets","readonly",s=>s.get(id));
  return asset?.owner === scope(owner) ? asset : null;
}
export async function importLocalAsset(owner,parsed) {
  const normalizedOwner = scope(owner);
  const fingerprint = await digest(parsed.sourceBytes);
  const existing = (await listLocalAssets(normalizedOwner)).find(a=>a.fingerprint === fingerprint);
  if (existing) return {asset:existing,duplicate:true};
  const asset = {
    id: crypto.randomUUID(), owner:normalizedOwner, kind:parsed.kind, title:parsed.title,
    fields:parsed.fields, original:parsed.original, sourceFormat:parsed.sourceFormat,
    filename:parsed.filename, sourceBytes:parsed.sourceBytes, fingerprint,
    importedAt:Date.now(), updatedAt:Date.now(),
  };
  await requestResult("assets","readwrite",s=>s.add(asset));
  return {asset,duplicate:false};
}
export async function renameLocalAsset(owner,id,title) {
  const asset = await getLocalAsset(owner,id);
  if (!asset) throw new Error("This asset was not found.");
  const value = String(title).trim();
  if (!value || value.length > 120) throw new Error("Enter a name up to 120 characters.");
  await requestResult("assets","readwrite",s=>s.put({...asset,title:value,updatedAt:Date.now()}));
}
export async function deleteLocalAsset(owner,id) {
  const asset = await getLocalAsset(owner,id);
  if (!asset) return false;
  await requestResult("assets","readwrite",s=>s.delete(id));
  return true;
}
function bindingKey(owner,storyId) { return scope(owner) + ":" + String(storyId); }
export async function getStoryAssets(owner,storyId) {
  const record = await requestResult("attachments","readonly",s=>s.get(bindingKey(owner,storyId)));
  return record?.assets || [];
}
export async function setStoryAssets(owner,storyId,items) {
  if (!Array.isArray(items) || items.length > 100) throw new Error("Too many story assets.");
  const valid = [];
  for (const item of items) {
    const asset = await getLocalAsset(owner,item.id);
    if (!asset) throw new Error("Selected asset was not found in your library.");
    if (valid.some(a=>a.id === item.id)) continue;
    valid.push({id:item.id,enabled:item.enabled !== false,
      greeting:Math.max(0,Math.trunc(item.greeting || 0)),
      ...(asset.kind==="lorebook" ? {entryOverrides:normalizeEntryOverrides(
        item.entryOverrides,asset.fields.entries.map(e=>e.sourceId))} : {}),
    });
  }
  await requestResult("attachments","readwrite",s=>s.put({key:bindingKey(owner,storyId),assets:valid}));
  return valid;
}
export async function getEnabledStoryAssets(owner,storyId) {
  const bindings = await getStoryAssets(owner,storyId);
  const resolved = await Promise.all(bindings.filter(x=>x.enabled).map(x=>getLocalAsset(owner,x.id)));
  return resolved.filter(Boolean);
}
export function downloadLocalAsset(asset) {
  const blob = new Blob([asset.sourceBytes],{type:asset.sourceFormat === "v2-png" ? "image/png" : "application/json"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href=url;
  link.download=asset.filename || ((asset.title||"ember-asset").replace(/[^A-Za-z0-9_-]/g,"_") + (asset.sourceFormat === "v2-png" ? ".png" : ".json"));
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
