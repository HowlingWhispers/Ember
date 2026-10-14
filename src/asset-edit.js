// Standalone Ember editor: create an edited JSON copy, never mutate an imported original.
// Each resulting file is re-validated through Ember's own import adapters.
import { importEmberAsset } from "./asset-import.js";
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
function string(value, label, max = 50000) {
  if (typeof value !== "string" || value.length > max) throw new Error(label + " is invalid or too long.");
  return value;
}
function keywords(value, label) {
  const lines = string(value, label, 30000).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (lines.length > 128 || lines.some(x => x.length > 160)) throw new Error(label + " has too many or too-long keywords.");
  return [...new Set(lines)];
}
function integer(value, label, max) {
  const result = Number(value);
  if (String(value).trim() === "" || !Number.isSafeInteger(result) || result < 0 || result > max)
    throw new Error(label + " must be a whole number between 0 and " + max + ".");
  return result;
}
export function applyAssetEdits(asset, edits) {
  if (!asset || !["character", "lorebook"].includes(asset.kind) || !asset.original
      || !edits || typeof edits !== "object" || Array.isArray(edits)) throw new Error("Invalid asset editor request.");
  const json = structuredClone(asset.original);
  const title = string(edits.name, "Name", 120).trim();
  if (!title) throw new Error("Name cannot be empty.");
  if (asset.kind === "character") {
    if (!json.data || json.spec !== "chara_card_v2" || json.spec_version !== "2.0")
      throw new Error("The original Character Card V2 is unavailable.");
    const data = json.data;
    data.name = title;
    for (const [formKey, jsonKey] of [
      ["description","description"],["personality","personality"],["scenario","scenario"],
      ["firstMessage","first_mes"],["exampleMessages","mes_example"]]) {
      if (!own(edits,formKey)) throw new Error("Missing character field: "+formKey);
      data[jsonKey] = string(edits[formKey],formKey);
    }
    if (!Array.isArray(edits.alternateGreetings) || edits.alternateGreetings.length > 100)
      throw new Error("Invalid alternate greetings.");
    data.alternate_greetings = edits.alternateGreetings.map((value,i) =>
      string(value, "Alternate greeting " + (i+1)));
  } else {
    if (!json.entries || !(Array.isArray(json.entries) || (typeof json.entries === "object" && json.entries !== null)))
      throw new Error("The original standalone lorebook entries are unavailable.");
    const entries = Object.values(json.entries);
    if (!Array.isArray(edits.entries) || edits.entries.length !== entries.length)
      throw new Error("Lorebook entry count changed unexpectedly.");
    json.name = title;
    json.description = string(edits.description, "Description");
    json.scan_depth = integer(edits.scanDepth, "Scan depth", 64);
    json.token_budget = integer(edits.tokenBudget, "Token budget", 100000);
    json.recursive_scanning = edits.recursiveScanning === true;
    entries.forEach((entry,i)=>{
      const edit = edits.entries[i];
      if (!entry || !edit || typeof edit !== "object") throw new Error("Invalid lorebook entry " + (i+1));
      entry.name = string(edit.name, "Entry name", 240);
      entry.content = string(edit.content, "Entry content");
      const keys = keywords(edit.keys, "Entry keywords");
      const secondary = keywords(edit.secondaryKeys, "Secondary keywords");
      // Keep dual aliases in sync across compatible lorebook producers.
      entry.keys = keys;
      entry.key = keys;
      entry.secondary_keys = secondary;
      entry.keysecondary = secondary;
      entry.enabled = edit.enabled === true;
      entry.disable = !entry.enabled;
      entry.constant = edit.constant === true;
      entry.selective = edit.selective === true;
    });
  }
  return json;
}
export function buildEditedAsset(asset, edits) {
  const json = applyAssetEdits(asset, edits);
  const slug = String(edits.name).trim().replace(/[^\p{L}\p{N}._-]+/gu,"-").replace(/^-+|-+$/g,"").slice(0,90) || "asset";
  // Edited PNG cards become V2 JSON copies. The original PNG and portrait are untouched.
  const bytes = new TextEncoder().encode(JSON.stringify(json,null,2));
  return importEmberAsset(bytes,slug+"-edited.json");
}
