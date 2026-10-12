/**
 * Coda notification audio.
 *
 * The built-in chime is synthesized from original tones. A user's custom
 * ringtone is kept locally in IndexedDB and is never uploaded to Ember/Orbis.
 * Sound settings are isolated per Orbis user on the current browser.
 */
const PREF_PREFIX = "hw:ember:coda-sound:v1:";
const DB_NAME = "hw:ember:personal-audio";
const DB_STORE = "ringtones";
export const MAX_RINGTONE_BYTES = 2_000_000;
export const CODA_SOUND_MODES = Object.freeze(["coda", "custom", "silent"]);
export const DEFAULT_SOUND = Object.freeze({ mode: "coda", volume: 0.6, customName: "" });

export function soundScope(userId) {
  return typeof userId === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(userId)
    ? userId.toLowerCase()
    : "local-preview";
}

export function normalizeSoundPreferences(value) {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    mode: CODA_SOUND_MODES.includes(candidate.mode) ? candidate.mode : DEFAULT_SOUND.mode,
    volume: typeof candidate.volume === "number" && Number.isFinite(candidate.volume)
      ? Math.min(1, Math.max(0, candidate.volume))
      : DEFAULT_SOUND.volume,
    customName: typeof candidate.customName === "string" ? candidate.customName.slice(0, 120) : "",
  };
}

export function readSoundPreferences(userId, storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(PREF_PREFIX + soundScope(userId));
    return raw ? normalizeSoundPreferences(JSON.parse(raw)) : { ...DEFAULT_SOUND };
  } catch {
    return { ...DEFAULT_SOUND };
  }
}

export function storeSoundPreferences(userId, settings, storage = globalThis.localStorage) {
  const normalized = normalizeSoundPreferences(settings);
  storage.setItem(PREF_PREFIX + soundScope(userId), JSON.stringify(normalized));
  return normalized;
}

export function validateRingtoneFile(file) {
  if (!file || typeof file.name !== "string" || typeof file.size !== "number") {
    throw new Error("Choose an audio file first.");
  }
  const suffix = file.name.toLowerCase().match(/\.(mp3|wav|ogg)$/)?.[1];
  const compatible = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/ogg", "application/ogg", ""]);
  if (!suffix || !compatible.has((file.type ?? "").toLowerCase())) {
    throw new Error("Choose an MP3, WAV, or OGG audio file.");
  }
  if (file.size < 1 || file.size > MAX_RINGTONE_BYTES) {
    throw new Error("Custom Coda ringtones must be between 1 byte and 2 MB.");
  }
  return { name: file.name.slice(0, 120), bytes: file.size };
}

function openAudioDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("This browser does not support local ringtone storage."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
    };
    request.onerror = () => reject(new Error("Local ringtone storage is unavailable."));
    request.onsuccess = () => resolve(request.result);
    request.onblocked = () => reject(new Error("Close other Ember tabs and retry saving the ringtone."));
  });
}

async function audioRecord(userId, operation, value) {
  const db = await openAudioDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, operation === "read" ? "readonly" : "readwrite");
      const store = tx.objectStore(DB_STORE);
      const key = soundScope(userId);
      let request;
      if (operation === "read") request = store.get(key);
      else if (operation === "delete") request = store.delete(key);
      else request = store.put(value, key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(new Error("Could not access this browser's ringtone storage."));
      tx.onabort = () => reject(new Error("Could not complete local ringtone storage."));
    });
  } finally {
    db.close();
  }
}

export async function saveCustomRingtone(userId, file) {
  const metadata = validateRingtoneFile(file);
  // File is a Blob. Store original bytes, not a base64 payload in localStorage.
  await audioRecord(userId, "save", { blob: file, name: metadata.name });
  return metadata;
}

export async function readCustomRingtone(userId) {
  const result = await audioRecord(userId, "read");
  if (!result || !(result.blob instanceof Blob)) return null;
  return result;
}

export async function deleteCustomRingtone(userId) {
  await audioRecord(userId, "delete");
}

/** Original gentle rising chime, not a sampled Zelda/Nintendo recording. */
export async function playOriginalCodaChime(volume = DEFAULT_SOUND.volume) {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("Your browser does not support synthesized audio.");
  const context = new Context();
  try {
    if (context.state === "suspended") await context.resume();
    const level = Math.min(1, Math.max(0, Number(volume) || 0));
    if (level === 0) return;
    const now = context.currentTime + 0.015;
    for (const [offset, frequency, duration] of [
      [0, 622.25, 0.23],
      [0.13, 932.33, 0.32],
      [0.33, 1244.51, 0.23],
    ]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level * 0.16), now + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + duration + 0.01);
    }
    await new Promise(resolve => setTimeout(resolve, 730));
  } finally {
    await context.close();
  }
}

export async function playCodaSound(settings, userId) {
  const sound = normalizeSoundPreferences(settings);
  if (sound.mode === "silent" || sound.volume === 0) return "silent";
  if (sound.mode === "coda") {
    await playOriginalCodaChime(sound.volume);
    return "coda";
  }
  const stored = await readCustomRingtone(userId);
  if (!stored) throw new Error("Choose a custom ringtone first, or switch to Coda's Chime.");
  const url = URL.createObjectURL(stored.blob);
  const audio = new Audio(url);
  audio.volume = sound.volume;
  try {
    // Register end/error listeners before play() so a short clip cannot finish
    // before its playback promise settles.
    const ended = new Promise((resolve, reject) => {
      audio.addEventListener("ended", resolve, { once: true });
      audio.addEventListener("error", () => reject(new Error("This audio file could not be played.")), { once: true });
    });
    await audio.play();
    await ended;
    return "custom";
  } finally {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
  }
}
