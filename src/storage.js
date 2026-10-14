import { createStory, createStoryFromLaunch, validateStory } from "./engine.js";

const KEY = "hw:ember:story:v1";
let activeKey = KEY;
let sessionContext = null;
export function configureStoryScope(session) {
  const sandbox = session?.mode === "sandbox" && session.asset === null;
  const assetLaunch = ["character", "world"].includes(session?.mode)
    && session.asset && typeof session.asset.id === "string"
    && /^[0-9a-f-]{36}$/i.test(session.asset.id);
  if (!session || typeof session.userId !== "string"
    || !/^[0-9a-f-]{36}$/i.test(session.userId)
    || (!sandbox && !assetLaunch)) throw new Error("Invalid Orbis story scope");
  sessionContext = session;
  activeKey = `${KEY}:${session.userId}:${session.mode}:${sandbox ? "blank" : session.asset.id}`;
}
function checkStoryBinding(story) {
  const valid = validateStory(story);
  if (sessionContext) {
    if (valid.launch?.userId !== sessionContext.userId
      || valid.launch?.assetId !== (sessionContext.asset?.id ?? null)
      || valid.launch?.mode !== sessionContext.mode) throw new Error("This save belongs to a different Orbis account or launch");
  } else if (valid.launch) {
    throw new Error("An Orbis-bound save cannot be opened in offline preview");
  }
  return valid;
}
const THEME_KEY = "hw:ember:theme:v1";
const FONT_KEY = "hw:ember:font:v1";

// Each preference needs its own key. Density used to share the font key, so
// choosing a layout reset the text size and moving the slider reset the layout.
const PREFERENCE_KEYS = { theme: THEME_KEY, font: FONT_KEY, density: "hw:ember:density:v1", replyLength: "hw:ember:reply-length:v1" };

export function loadStory() {
  try {
    const raw = localStorage.getItem(activeKey);
    if (!raw) {
      const fresh = sessionContext ? createStoryFromLaunch(sessionContext) : createStory();
      persistStory(fresh);
      return { state: fresh, error: "" };
    }
    return { state: checkStoryBinding(JSON.parse(raw)), error: "" };
  } catch {
    // Fail closed: never overwrite or silently discard the unreadable saved story.
    return { state: null, error: "The local save could not be read. Export or inspect the browser's local storage before resetting." };
  }
}

export function persistStory(state) {
  localStorage.setItem(activeKey, JSON.stringify(checkStoryBinding(state)));
}

export function clearStory() {
  localStorage.removeItem(activeKey);
}

export function getPreference(name, fallback) {
  const key = PREFERENCE_KEYS[name];
  if (!key) return fallback;
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export function setPreference(name, value) {
  const key = PREFERENCE_KEYS[name];
  if (!key) return;
  try { localStorage.setItem(key, value); } catch { /* preference persistence is optional */ }
}

export function importStory(text) {
  if (text.length > 2_000_000) throw new Error("Save file is too large");
  return checkStoryBinding(JSON.parse(text));
}

export function exportStory(state) {
  return JSON.stringify(checkStoryBinding(state), null, 2);
}