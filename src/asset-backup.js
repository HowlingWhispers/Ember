// Portable, local-only Ember library backup. Keeps original imported bytes.
import { importEmberAsset } from "./asset-import.js";
export const BACKUP_FORMAT = "ember-local-asset-library";
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 32_000_000;
function toBase64(bytes) {
  let data="";
  for (let i=0;i<bytes.length;i+=8192) data+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(data);
}
function fromBase64(value) {
  if (typeof value !== "string" || value.length > 12_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    throw new Error("Invalid asset backup entry.");
  try {
    const raw=atob(value);
    return Uint8Array.from(raw,c=>c.charCodeAt(0));
  } catch { throw new Error("Malformed asset backup entry."); }
}
export function exportLocalLibrary(assets) {
  if (!Array.isArray(assets) || assets.length>250) throw new Error("Too many assets for one backup.");
  let total=0;
  const items=assets.map(asset=>{
    const bytes=asset.sourceBytes;
    total+=bytes.length;
    if(total>MAX_BACKUP_BYTES) throw new Error("Library backup exceeds 32 MB. Export assets individually.");
    return {filename:asset.filename,format:asset.sourceFormat,source:toBase64(bytes)};
  });
  return JSON.stringify({format:BACKUP_FORMAT,version:BACKUP_VERSION,items},null,2);
}
export function parseLocalLibraryBackup(json) {
  if(typeof json !== "string" || new TextEncoder().encode(json).length > MAX_BACKUP_BYTES * 1.5)
    throw new Error("Library backup is too large.");
  let value;
  try {value=JSON.parse(json);}catch{throw new Error("Malformed library backup JSON.");}
  if(value?.format!==BACKUP_FORMAT || value?.version!==BACKUP_VERSION
    || !Array.isArray(value.items) || value.items.length>250) throw new Error("Not a supported Ember library backup.");
  let total=0;
  return value.items.map((item,i)=>{
    if(!item || typeof item.filename!=="string" || item.filename.length>260) throw new Error("Invalid asset backup entry "+(i+1));
    const bytes=fromBase64(item.source);
    total+=bytes.length;
    if(total>MAX_BACKUP_BYTES) throw new Error("Backup exceeds 32 MB.");
    const parsed=importEmberAsset(bytes,item.filename);
    if(item.format!==parsed.sourceFormat) throw new Error("Backup item type does not match its file.");
    return parsed;
  });
}
