export const STORY_SCHEMA = 1;
export const MAX_INPUT = 8000;
export const MAX_NOTE = 4000;
export const MAX_TURNS = 5000;
export const MAX_NOTES = 2000;
const minutesPerDay = 1440;
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `ember-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const isText = (value, max) => typeof value === "string" && value.length <= max;
const allowedModes = new Set(["action", "speech", "thought"]);

export function createStory() {
  return {
    schema: STORY_SCHEMA,
    id: uuid(),
    title: "A new story",
    world: { name: "Bitterroot · concept preview", location: "Ranger Station", day: 1, minute: 8 * 60, season: "Unknown", weather: "Not connected", source: "preview" },
    turns: [{ id: uuid(), mode: "narrator", text: "Every story begins somewhere. The next words are yours.", source: "preview" }],
    journal: [],
    revision: 0
  };
}

/**
 * A validated Orbis launch chooses the story mode. This is a UI state seed, not
 * AI narration or a substitute for the missing world-simulation engine.
 */
export function createStoryFromLaunch(session) {
  if (!session || !["world", "character", "sandbox"].includes(session.mode)
      || (session.mode === "sandbox" && session.asset !== null)
      || (session.mode !== "sandbox" && (!session.asset || session.asset.type !== session.mode
        || typeof session.asset.name !== "string"))) throw new Error("Invalid Orbis launch context");
  const story = createStory();
  if (session.mode === "sandbox") {
    // No implied canon, places, NPCs, opening narrator or mission. The very
    // first creative act belongs to the player.
    return {
      ...story,
      title: "Free Sandbox",
      launch: { userId: session.userId, assetId: null, mode: "sandbox" },
      world: { ...story.world, name: "Free Sandbox", location: "Not established", season: "Not simulated",
        weather: "Not simulated", source: "orbis" },
      turns: [],
    };
  }
  const title = session.mode === "character" ? `Roleplay with ${session.asset.name}` : session.asset.name;
  return {
    ...story,
    title,
    launch: { userId: session.userId, assetId: session.asset.id, mode: session.mode },
    world: {
      ...story.world, name: session.mode === "world" ? session.asset.name : "Character roleplay",
      location: session.mode === "world" ? "Starting place not selected" : "One-on-one roleplay",
      season: "Not simulated", weather: "Not simulated", source: "orbis",
    },
    turns: [{
      ...story.turns[0], text: session.mode === "character"
        ? `${session.asset.name} was selected from Orbis. This is a standard, freeform character conversation. NovelAI is not connected yet.`
        : `${session.asset.name} was selected from Orbis. Your adventure is freeform. NovelAI and living-world simulation are not connected yet.`
    }]
  };
}

export function formatClock(world) {
  const hour = Math.floor(world.minute / 60);
  const minute = world.minute % 60;
  return `Day ${world.day}, ${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

// Ember-only writing macros. No app-specific editing semantics belong in Orbis.
export const COMPOSER_PAIRS = Object.freeze({
  action: ["*", "*"], speech: ['"', '"'], thought: ["(", ")"],
});

export function wrapComposerSelection(text, start, end, kind) {
  const pair = COMPOSER_PAIRS[kind];
  if (!pair || !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end < start || end > text.length) return null;
  const [open, close] = pair;
  return {
    text: text.slice(0, start) + open + text.slice(start, end) + close + text.slice(end),
    start: start + open.length,
    end: end + open.length,
  };
}

// Finds the smallest *...*, "..." or (...) surrounding the caret.
// Quotation and asterisk markers toggle; parentheses can nest.
// Skip escaped punctuation and leave ordinary editing outside pairs alone.
export function exitComposerPair(text, caret) {
  if (!Number.isInteger(caret) || caret < 0 || caret > text.length) return null;
  const pairs = [];
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") { i++; continue; }
    if (c === "(") stack.push({ open: i, marker: c });
    else if (c === ")" && stack.length && stack.at(-1).marker === "(") {
      const opened = stack.pop(); pairs.push({ start: opened.open, close: i });
    } else if (c === '"' || c === "*") {
      if (stack.length && stack.at(-1).marker === c) {
        const opened = stack.pop(); pairs.push({ start: opened.open, close: i });
      } else stack.push({ open: i, marker: c });
    }
  }
  const enclosing = pairs.filter(pair => pair.start < caret && caret <= pair.close)
    .sort((a, b) => b.start - a.start)[0];
  if (!enclosing) return null;
  const after = enclosing.close + 1;
  const hasSpace = text[after] === " ";
  return {
    text: hasSpace ? text : text.slice(0, after) + " " + text.slice(after),
    caret: after + 1,
  };
}

export function addPlayerTurn(state, mode, rawText) {
  if (!allowedModes.has(mode)) throw new Error("Unknown writing mode");
  const text = rawText.trim();
  if (!text || text.length > MAX_INPUT) throw new Error("Write between 1 and 8,000 characters");
  return {
    ...state,
    revision: state.revision + 1,
    turns: [...state.turns, { id: uuid(), mode, text, source: "player" }],
    journal: [...state.journal, { id: uuid(), kind: "turn", text: `Player ${mode} recorded`, day: state.world.day, minute: state.world.minute }]
  };
}

/**
 * Commit provider output only for the player turn that prompted it.
 * A stale reply must not attach to a newly imported/reset story.
 */
/**
 * Remove provider role-continuation wrappers, not fictional dialogue or prose.
 * Deliberately narrow: only standalone line-start narrator tokens are removed.
 */
export function cleanNarration(rawText) {
  if (typeof rawText !== "string") return rawText;
  let text = rawText.replace(/\r\n?/g, "\n").trim();
  // Correct a specific provider failure: outer double-quoted prose with
  // single-quoted dialogue. Only normalize when the response is fully wrapped,
  // and avoid treating apostrophes inside words as quote delimiters.
  const outerWrapped = text.startsWith('"') && text.endsWith('"') && text.length > 2;
  if (outerWrapped) {
    text = text.slice(1, -1).trim();
    text = text.replace(/(^|[^\p{L}\p{N}])'((?:[\p{L}\p{N}]+'[\p{L}\p{N}]+|[^'\n])*)'(?=$|[^\p{L}\p{N}])/gmu,
      (_, prefix, spoken) => prefix + '"' + spoken + '"');
  }
  text = text.replace(/^[ \t]*(?:\*\*)?(?:NARRATOR\s*(?:\(\s*CONT(?:INUED)?\s*\))?|\[\s*NARRATOR\s*\]|PREVIEW OPENING)(?:\*\*)?\s*:\s*/gim, "");
  // Orbis labels turns "PLAYER (ACTION):", and models copy that shape for their
  // own characters ("NPC (RELIC):"). Strip only uppercase NPC labels at line start.
  text = text.replace(/^[ \t]*(?:\*\*)?NPC\s*(?:\([^()\n]{1,60}\))?(?:\*\*)?\s*:\s*/gm, "");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

export function addNarratorTurn(state, playerTurnId, rawText) {
  const last = state.turns.at(-1);
  if (!last || last.id !== playerTurnId || last.source !== "player") {
    throw new Error("Narration no longer matches the latest player turn");
  }
  const text = cleanNarration(rawText);
  if (!text || text.length > 32000) throw new Error("Invalid narration text");
  return {
    ...state,
    revision: state.revision + 1,
    turns: [...state.turns, { id: uuid(), mode: "narrator", text, source: "provider" }],
  };
}

export function advanceTime(state, elapsedMinutes) {
  if (!Number.isInteger(elapsedMinutes) || elapsedMinutes < 1 || elapsedMinutes > 1440) {
    throw new Error("Wait must be between 1 minute and 1 day");
  }
  const total = state.world.minute + elapsedMinutes;
  const day = state.world.day + Math.floor(total / minutesPerDay);
  const minute = total % minutesPerDay;
  return {
    ...state,
    revision: state.revision + 1,
    world: { ...state.world, day, minute },
    journal: [...state.journal, { id: uuid(), kind: "time", text: `Waited ${elapsedMinutes} minutes (preview clock only)`, day, minute }]
  };
}

export function addJournalNote(state, rawText) {
  const text = rawText.trim();
  if (!text || text.length > MAX_NOTE) throw new Error("Note must be between 1 and 4,000 characters");
  return {
    ...state,
    revision: state.revision + 1,
    journal: [...state.journal, { id: uuid(), kind: "note", text, day: state.world.day, minute: state.world.minute }]
  };
}

export function validateStory(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || data.schema !== STORY_SCHEMA) throw new Error("Unsupported or invalid Ember save format");
  if (!isText(data.id, 160) || !data.id || !isText(data.title, 200) || !Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error("Invalid story metadata");
  if (data.launch !== undefined) {
    const link = data.launch;
    if (!link || typeof link !== "object" || Array.isArray(link)
      || !isText(link.userId, 160) || !link.userId
      || !["character", "world", "sandbox"].includes(link.mode)
      || (link.mode === "sandbox" ? link.assetId !== null : !isText(link.assetId, 160) || !link.assetId))
      throw new Error("Invalid Orbis launch binding");
  }
  const w = data.world;
  if (!w || !isText(w.name, 200) || !isText(w.location, 200) || !isText(w.season, 100) || !isText(w.weather, 100) || w.source !== "preview" && w.source !== "orbis" || !Number.isSafeInteger(w.day) || w.day < 1 || !Number.isInteger(w.minute) || w.minute < 0 || w.minute >= minutesPerDay) throw new Error("Invalid world data");
  if (!Array.isArray(data.turns) || data.turns.length > MAX_TURNS || !data.turns.every(t => t && isText(t.id, 160) && t.id && isText(t.text, MAX_INPUT * 4) && ["narrator", ...allowedModes].includes(t.mode) && ["player", "preview", "provider"].includes(t.source))) throw new Error("Invalid story turns");
  if (!Array.isArray(data.journal) || data.journal.length > MAX_NOTES || !data.journal.every(j => j && isText(j.id, 160) && j.id && ["turn", "time", "note"].includes(j.kind) && isText(j.text, MAX_NOTE) && Number.isSafeInteger(j.day) && j.day >= 1 && Number.isInteger(j.minute) && j.minute >= 0 && j.minute < minutesPerDay)) throw new Error("Invalid journal");
  if (data.turns.some((turn) => turn.source === "player" && turn.mode === "narrator")) throw new Error("Invalid narrator attribution");
  return structuredClone(data);
}
