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
  if (!session || !["world", "character"].includes(session.mode)
      || !session.asset || session.asset.type !== session.mode
      || typeof session.asset.name !== "string") throw new Error("Invalid Orbis launch context");
  const story = createStory();
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
      || !isText(link.assetId, 160) || !link.assetId
      || !["character", "world"].includes(link.mode)) throw new Error("Invalid Orbis launch binding");
  }
  const w = data.world;
  if (!w || !isText(w.name, 200) || !isText(w.location, 200) || !isText(w.season, 100) || !isText(w.weather, 100) || w.source !== "preview" && w.source !== "orbis" || !Number.isSafeInteger(w.day) || w.day < 1 || !Number.isInteger(w.minute) || w.minute < 0 || w.minute >= minutesPerDay) throw new Error("Invalid world data");
  if (!Array.isArray(data.turns) || data.turns.length > MAX_TURNS || !data.turns.every(t => t && isText(t.id, 160) && t.id && isText(t.text, MAX_INPUT * 4) && ["narrator", ...allowedModes].includes(t.mode) && ["player", "preview", "provider"].includes(t.source))) throw new Error("Invalid story turns");
  if (!Array.isArray(data.journal) || data.journal.length > MAX_NOTES || !data.journal.every(j => j && isText(j.id, 160) && j.id && ["turn", "time", "note"].includes(j.kind) && isText(j.text, MAX_NOTE) && Number.isSafeInteger(j.day) && j.day >= 1 && Number.isInteger(j.minute) && j.minute >= 0 && j.minute < minutesPerDay)) throw new Error("Invalid journal");
  if (data.turns.some((turn) => turn.source === "player" && turn.mode === "narrator")) throw new Error("Invalid narrator attribution");
  return structuredClone(data);
}
