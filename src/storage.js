import { createStory, validateStory } from "./engine.js";

const KEY = "hw:ember:story:v1";
const THEME_KEY = "hw:ember:theme:v1";
const FONT_KEY = "hw:ember:font:v1";

export function loadStory() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { state: createStory(), error: "" };
    return { state: validateStory(JSON.parse(raw)), error: "" };
  } catch {
    // Fail closed: never overwrite or silently discard the unreadable saved story.
    return { state: null, error: "The local save could not be read. Export or inspect the browser's local storage before resetting." };
  }
}

export function persistStory(state) {
  localStorage.setItem(KEY, JSON.stringify(validateStory(state)));
}

export function clearStory() {
  localStorage.removeItem(KEY);
}

export function getPreference(name, fallback) {
  const key = name === "theme" ? THEME_KEY : FONT_KEY;
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export function setPreference(name, value) {
  const key = name === "theme" ? THEME_KEY : FONT_KEY;
  try { localStorage.setItem(key, value); } catch { /* preference persistence is optional */ }
}

export function importStory(text) {
  if (text.length > 2_000_000) throw new Error("Save file is too large");
  return validateStory(JSON.parse(text));
}

export function exportStory(state) {
  return JSON.stringify(validateStory(state), null, 2);
}
