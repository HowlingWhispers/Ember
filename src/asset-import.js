// Ember-owned import adapters. Imported content is data, never application instructions.
export const IMPORT_LIMITS = Object.freeze({ jsonBytes: 2_000_000, pngBytes: 8_000_000, entries: 512, entryContent: 50_000 });
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const pngMagic = [137, 80, 78, 71, 13, 10, 26, 10];
const record = v => v !== null && typeof v === "object" && !Array.isArray(v);
const text = v => typeof v === "string" ? v : "";
const texts = v => Array.isArray(v) ? v.filter(x => typeof x === "string") : [];
const integer = (v, fallback) => Number.isSafeInteger(v) ? v : fallback;
const number = (v, fallback) => typeof v === "number" && Number.isFinite(v) ? v : fallback;
const unique = v => [...new Set(v.map(x => x.trim()).filter(Boolean))];
const bool = (v, fallback) => typeof v === "boolean" ? v : fallback;
function assert(ok, message) { if (!ok) throw new Error(message); }
function readObject(value) { assert(record(value), "The file must contain a JSON object."); return value; }
function asBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === "string") return encoder.encode(data);
  throw new Error("Unsupported file data.");
}
function parseJSON(bytes) {
  assert(bytes.byteLength <= IMPORT_LIMITS.jsonBytes, "JSON exceeds the 2 MB import limit.");
  try { return readObject(JSON.parse(decoder.decode(bytes))); }
  catch (error) { if (error?.message?.includes("must contain")) throw error; throw new Error("Invalid JSON document."); }
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function readPngCard(bytes) {
  assert(bytes.length <= IMPORT_LIMITS.pngBytes, "PNG exceeds the 8 MB import limit.");
  assert(pngMagic.every((b, i) => bytes[i] === b), "Not a PNG file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, metadata = null, ended = false, chunkCount = 0;
  while (offset + 12 <= bytes.length) {
    assert(++chunkCount <= 10000, "PNG contains too many chunks.");
    const length = view.getUint32(offset), end = offset + 12 + length;
    assert(length <= IMPORT_LIMITS.pngBytes && end <= bytes.length, "Invalid PNG chunk size.");
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    assert(/^[A-Za-z]{4}$/.test(type), "Invalid PNG chunk type.");
    const payload = bytes.subarray(offset + 8, end - 4);
    const checksum = crc32(bytes.subarray(offset + 4, end - 4));
    assert(checksum === view.getUint32(end - 4), "PNG checksum mismatch.");
    if (chunkCount === 1) assert(type === "IHDR", "PNG has no IHDR header.");
    if (type === "tEXt") {
      const separator = payload.indexOf(0);
      if (separator > 0 && decoder.decode(payload.subarray(0, separator)) === "chara") {
        assert(metadata === null, "Multiple conflicting V2 cards in PNG.");
        const base64 = decoder.decode(payload.subarray(separator + 1)).trim();
        assert(base64.length <= 2_800_000 && /^[A-Za-z0-9+/]*={0,2}$/.test(base64), "Invalid PNG card metadata.");
        assert(base64.length % 4 !== 1, "Invalid PNG card metadata.");
        try {
          const binary = atob(base64);
          metadata = Uint8Array.from(binary, char => char.charCodeAt(0));
        } catch { throw new Error("Invalid PNG card metadata."); }
      }
    }
    offset = end;
    if (type === "IEND") { ended = true; break; }
  }
  assert(ended && offset === bytes.length, "Incomplete or malformed PNG.");
  assert(metadata, "PNG has no Character Card V2 metadata.");
  return parseJSON(metadata);
}
function requireString(value, name, max = 50_000) {
  assert(typeof value === "string" && value.length <= max, "Invalid " + name + ".");
  return value;
}
function optionalString(value, name, max = 50_000) {
  if (value == null) return "";
  return requireString(value, name, max);
}
function optionalList(value, name, max = 100) {
  if (value == null) return [];
  assert(Array.isArray(value) && value.length <= max, "Invalid " + name + ".");
  return value.map((v, i) => requireString(v, name + " " + i));
}
function normalizedEntry(e, index, kind) {
  assert(record(e), "Malformed lore entry " + (index + 1) + ".");
  const source = kind === "v2" ? "v2" : "standalone";
  const keys = optionalList(e.keys ?? e.key, "entry keys", 128);
  const secondary = optionalList(e.secondary_keys ?? e.keysecondary, "secondary keys", 128);
  // Treat disable:true as authoritative even when enabled:true also occurs.
  const enabled = e.disable === true ? false : bool(e.enabled, true);
  const probability = Math.min(100, Math.max(0, number(e.probability ?? e.extensions?.probability, 100)));
  return {
    sourceId: String(e.uid ?? e.id ?? index),
    name: text(e.name) || text(e.comment) || "Entry " + (index + 1),
    content: optionalString(e.content, "lore content", IMPORT_LIMITS.entryContent),
    keys: unique(keys),
    secondaryKeys: unique(secondary),
    enabled,
    constant: bool(e.constant, false),
    selective: bool(e.selective, false),
    selectiveLogic: integer(e.selectiveLogic ?? e.extensions?.selectiveLogic, 0),
    caseSensitive: bool(e.case_sensitive ?? e.caseSensitive, false),
    matchWholeWords: bool(e.match_whole_words ?? e.matchWholeWords, true),
    insertionOrder: number(e.insertion_order ?? e.order, index),
    priority: number(e.priority ?? e.order, 0),
    position: e.position ?? null,
    depth: integer(e.depth ?? e.scanDepth ?? e.extensions?.depth, -1),
    probability,
    useProbability: bool(e.useProbability ?? e.extensions?.useProbability, false),
    excludeRecursion: bool(e.excludeRecursion ?? e.extensions?.excludeRecursion, false),
    source,
  };
}
function normalizeBook(source, entries, format) {
  assert(Array.isArray(entries) && entries.length <= IMPORT_LIMITS.entries, "Invalid lore entries.");
  return {
    format,
    name: text(source.name) || "Untitled lorebook",
    description: text(source.description),
    scanDepth: Math.min(64, Math.max(0, integer(source.scan_depth ?? source.scanDepth, 4))),
    tokenBudget: Math.min(100_000, Math.max(0, integer(source.token_budget ?? source.tokenBudget, 2048))),
    recursiveScanning: bool(source.recursive_scanning ?? source.recursiveScanning, false),
    entries: entries.map((e, i) => normalizedEntry(e, i, format === "character_book_v2" ? "v2" : "standalone")),
  };
}
// V2 greetings are plain strings; producers may supply scene titles in extensions.
// Resolve them from the original card so already-imported IndexedDB assets benefit
// without a destructive re-import or any edits to the character's source JSON.
export function greetingLabelsFromCard(card, openings) {
  const data = record(card?.data) ? card.data : {};
  const extensions = record(data.extensions) ? data.extensions : {};
  const scenes = Array.isArray(extensions.scenes) ? extensions.scenes.slice(0, 100).filter(record) : [];
  const selection = record(extensions.scene_selection) ? extensions.scene_selection : {};
  const mapping = Array.isArray(selection.alternate_greeting_mapping)
    ? selection.alternate_greeting_mapping.filter(record) : [];
  const explicit = Array.isArray(extensions.greeting_labels) ? extensions.greeting_labels : [];
  return openings.map((opening, index) => {
    const fallback = index === 0 ? "Primary greeting" : "Alternate greeting " + index;
    const sceneId = index === 0 ? selection.default
      : mapping.find(item => item.greeting_index === index - 1)?.scene_id;
    const scene = scenes.find(item => typeof sceneId === "string" && item.id === sceneId)
      ?? scenes.find(item => typeof item.opening === "string" && item.opening === opening);
    // Explicit labels are preferred when available (e.g. after a card is edited).
    const label = text(explicit[index]).trim() || text(scene?.title).trim();
    return label ? label.slice(0, 120) : fallback;
  });
}
export function parseV2Card(value) {
  const card = readObject(value);
  assert(card.spec === "chara_card_v2" && card.spec_version === "2.0", "Not a Character Card V2 (version 2.0).");
  const data = readObject(card.data);
  const name = requireString(data.name, "character name", 120).trim();
  assert(name.length > 0, "Character name is empty.");
  const desc = optionalString(data.description, "description");
  const personality = optionalString(data.personality, "personality");
  const scenario = optionalString(data.scenario, "scenario");
  const greeting = optionalString(data.first_mes, "first message");
  const alt = optionalList(data.alternate_greetings, "alternate greetings", 100);
  const examples = optionalString(data.mes_example, "example messages");
  const systemPrompt = optionalString(data.system_prompt, "system prompt");
  const postHistory = optionalString(data.post_history_instructions, "post-history instructions");
  const book = data.character_book == null ? null :
    normalizeBook(readObject(data.character_book), readObject(data.character_book).entries, "character_book_v2");
  return { kind: "character", title: name,
    fields: { name, description: desc, personality, scenario, firstMessage: greeting,
      alternateGreetings: alt, exampleMessages: examples, systemPrompt, postHistory,
      creator: text(data.creator), creatorNotes: text(data.creator_notes),
      tags: optionalList(data.tags, "tags", 128), avatarUrl: text(data.avatar),
      characterBook: book },
    original: card };
}
export function parseStandaloneLorebook(value) {
  const source = readObject(value);
  assert(source.spec !== "chara_card_v2", "Character cards must be imported as characters.");
  assert(source.entries && (Array.isArray(source.entries) || record(source.entries)), "Not a supported standalone lorebook.");
  const entries = Array.isArray(source.entries) ? source.entries : Object.values(source.entries);
  const book = normalizeBook(source, entries, "standalone_lorebook");
  return { kind: "lorebook", title: book.name, fields: book, original: source };
}
export function importEmberAsset(data, filename = "") {
  const bytes = asBytes(data);
  const isPng = pngMagic.every((b, i) => bytes[i] === b);
  const json = isPng ? readPngCard(bytes) : parseJSON(bytes);
  const parsed = json.spec === "chara_card_v2" ? parseV2Card(json) : parseStandaloneLorebook(json);
  assert(!isPng || parsed.kind === "character", "PNG metadata is not a Character Card V2.");
  return { ...parsed, sourceFormat: isPng ? "v2-png" : parsed.kind === "character" ? "v2-json" : "lorebook-json",
    filename: String(filename).slice(0, 260), sourceBytes: new Uint8Array(bytes) };
}
