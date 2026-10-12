import { createStory, createStoryFromLaunch, addPlayerTurn, addJournalNote, advanceTime, formatClock, MAX_INPUT } from "./engine.js";
import { configureStoryScope, loadStory, persistStory, getPreference, setPreference, importStory, exportStory } from "./storage.js";
import {
  readSoundPreferences, storeSoundPreferences, saveCustomRingtone,
  deleteCustomRingtone, playCodaSound,
} from "./coda-sound.js";

const root = document.querySelector("#app");
const liveSession = globalThis.__EMBER_SESSION__ ?? null;
if (liveSession) configureStoryScope(liveSession);
document.documentElement.dataset.emberMode = liveSession?.mode ?? "preview";
let { state, error: loadError } = loadStory();
let activeTab = "here";
let mode = "action";
let theme = getPreference("theme", "lamplight") === "daylight" ? "daylight" : "lamplight";
let fontSize = Math.min(26, Math.max(16, Number(getPreference("font", "20")) || 20));
let railOpen = false;
const soundUserId = liveSession?.userId;
let soundSettings = readSoundPreferences(soundUserId);
let soundBusy = false;
const modes = ["action", "speech", "thought"];
const tabs = ["here", "places", "people", "journal", "almanac"];
const safe = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const titleCase = text => text.charAt(0).toUpperCase() + text.slice(1);

root.innerHTML = `
  <div class="ember-shell">
    <header class="topbar">
      <div class="identity"><span class="flame" aria-hidden="true">✦</span><div><span class="brand">EMBER</span><span class="brand-sub">HOWLING WHISPERS</span></div></div>
      <div class="world-heading"><p id="worldName" class="world-name"></p><p class="breadcrumb" id="locationName"></p></div>
      <div class="top-actions">
        <span class="world-clock" id="clock"></span>
        <span class="saved" id="saveStatus">● Local preview</span>
        <button class="quiet desktop-only" id="themeButton" type="button" title="Switch Lamplight / Daylight">◐ <span>Theme</span></button>
        <button class="quiet desktop-only" id="prefsButton" type="button">Scene &amp; style</button>
        <details class="overflow"><summary class="quiet" aria-label="More story options">•••</summary><div class="popover">
          <button type="button" id="exportButton">Save to file</button>
          <button type="button" id="importButton">Open saved file</button>
          <button type="button" id="newButton">New story</button>
          <button type="button" id="prefsMenuButton">Scene &amp; style</button>
        </div></details>
        <button class="quiet mobile-world" type="button" id="railButton" aria-expanded="false" aria-controls="worldRail">World ☰</button>
      </div>
    </header>
    <div class="layout">
      <main class="story-column" aria-label="Story reader and writing desk">
        <div class="story-scroll" id="storyScroll">
          <div class="story-inner">
            <div class="chapter-heading">
              <div class="eyebrow"><span class="ornament">✧</span> ${liveSession?.mode === "character" ? "CHARACTER ROLEPLAY" : "YOUR ADVENTURE"} <span class="ornament">✧</span></div>
              <h1 id="storyTitle"></h1>
              <p class="scene-subtitle">${liveSession?.mode === "character" ? "A conversation led only by your imagination." : "A place for your story to unfold, without mandatory paths."}</p>
            </div>
            <div class="notice" id="previewNotice" role="note"><strong>Offline concept preview.</strong> Your writing is saved locally. NovelAI, Orbis, and world simulation are not connected; no AI narration or canonical events are being generated.</div>
            <div id="storyTurns" class="story-turns" aria-live="polite"></div>
          </div>
        </div>
        <section class="writing-desk" aria-label="Writing desk">
          <div class="desk-top">
            <div class="desk-heading"><span aria-hidden="true">✒</span> Write your next moment</div>
            <div class="desk-tools">
              <button type="button" id="goButton" class="chip-button">↗ Go</button>
              <button type="button" id="waitButton" class="chip-button">◷ Wait</button>
              <button type="button" id="passButton" class="chip-button" disabled title="Available when a narrator is connected">Pass the turn</button>
            </div>
          </div>
          <div class="composer">
            <div class="mode-switch" id="modeSwitch" aria-label="Writing mode">
              <button type="button" data-mode="action" class="selected">Action</button>
              <button type="button" data-mode="speech">Speech</button>
              <button type="button" data-mode="thought">Thought</button>
            </div>
            <label class="visually-hidden" for="playerInput">Your freeform roleplay</label>
            <textarea id="playerInput" rows="3" maxlength="${MAX_INPUT}" placeholder="What do you do, say, or think?"></textarea>
            <div class="composer-footer">
              <span class="composer-hint" id="composeHint">Your words are recorded. Narration requires a provider connection.</span>
              <span class="input-count" id="inputCount">0 / ${MAX_INPUT}</span>
              <button type="button" class="primary" id="sendButton">Add to story <span aria-hidden="true">➜</span></button>
            </div>
          </div>
        </section>
      </main>
      <div class="rail-scrim" id="railScrim"></div>
      <aside class="world-rail" id="worldRail" aria-label="World information">
        <div class="rail-heading"><span class="rail-kicker">THE WORLD BESIDE THE STORY</span><button type="button" class="quiet mobile-world" id="closeRail">✕</button></div>
        <nav class="rail-tabs" aria-label="World panels">
          <button type="button" data-tab="here" class="active">Here</button>
          <button type="button" data-tab="places">Places</button>
          <button type="button" data-tab="people">People</button>
          <button type="button" data-tab="journal">Journal</button>
          <button type="button" data-tab="almanac">Almanac</button>
        </nav>
        <div id="railContent" class="rail-content"></div>
        <footer class="rail-footer"><span class="tiny-led"></span> PREVIEW DATA · NO ORBIS CONNECTION</footer>
      </aside>
    </div>
  </div>
  <section class="coda-dock" aria-label="Coda notification companion preview">
    <div id="codaBubble" class="coda-bubble" hidden>
      <div class="coda-bubble-header"><strong>Coda</strong><button type="button" class="quiet" id="codaDismiss" aria-label="Dismiss Coda message">✕</button></div>
      <strong class="coda-greeting">Hey! Listen! 🐾</strong>
      <p>Found a character worth keeping? Once Coda's discovery engine is connected, I can suggest a private Orbis draft here.</p>
      <p class="coda-disclaimer">Companion preview only. Coda isn't monitoring your roleplay yet.</p>
      <button type="button" class="chip-button" id="codaSoundSettings">Notification sound settings</button>
    </div>
    <button type="button" id="codaButton" class="coda-orb" aria-label="Open Coda companion preview" aria-expanded="false" aria-controls="codaBubble" title="Coda: Hey! Listen!"><span aria-hidden="true">🐾</span><span class="coda-orb-label">Coda</span></button>
  </section>
  <dialog id="styleDialog" aria-labelledby="styleHeading"><form method="dialog" class="sheet"><div class="sheet-heading"><h2 id="styleHeading">Scene &amp; style</h2><button class="quiet" type="submit" aria-label="Close">✕</button></div>
    <p class="muted">Make the story comfortable to read. These controls affect presentation only.</p>
    <fieldset><legend>Reading theme</legend><div class="theme-choices"><label><input type="radio" name="theme" value="lamplight"> Lamplight</label><label><input type="radio" name="theme" value="daylight"> Daylight</label></div></fieldset>
    <label for="fontControl" class="setting-label">Story text size <output id="fontOutput"></output></label><input type="range" id="fontControl" min="16" max="26" step="1">
    <fieldset class="sound-options">
      <legend>Coda's Hey! Listen! alert</legend>
      <p class="muted">Choose the chime you hear when Coda has a discovery. No story listening is active yet.</p>
      <label><input type="radio" name="codaSound" value="coda"> Coda's original chime</label>
      <label><input type="radio" name="codaSound" value="custom"> My own ringtone (MP3, WAV or OGG)</label>
      <label><input type="radio" name="codaSound" value="silent"> Silent notification</label>
      <div class="coda-upload-controls">
        <button type="button" id="codaUploadButton" class="quiet">Choose sound file</button>
        <button type="button" id="codaRemoveButton" class="quiet">Remove custom sound</button>
      </div>
      <p id="codaFileName" class="sound-file-name" aria-live="polite">No custom file chosen</p>
      <label class="setting-label" for="codaVolume">Volume <output id="codaVolumeValue"></output></label>
      <input type="range" id="codaVolume" min="0" max="100" step="5">
      <button type="button" id="codaTestButton" class="chip-button">▶ Test sound</button>
      <p class="muted">Custom files stay in this browser on this device, scoped to your Orbis account.</p>
    </fieldset>
    <div class="sheet-foot"><button class="primary" type="submit">Done</button></div>
  </form></dialog>
  <dialog id="waitDialog" aria-labelledby="waitHeading"><form method="dialog" class="sheet"><div class="sheet-heading"><h2 id="waitHeading">Wait</h2><button class="quiet" type="submit" aria-label="Close">✕</button></div>
    <p class="muted">Advance the <strong>local preview clock</strong>. NPC schedules, weather, and consequences are not simulated yet.</p>
    <div class="wait-choices">
      <button type="button" data-wait="15">15 minutes</button>
      <button type="button" data-wait="60">1 hour</button>
      <button type="button" data-wait="180">3 hours</button>
      <button type="button" data-wait="720">12 hours</button>
    </div>
  </form></dialog>
  <dialog id="goDialog" aria-labelledby="goHeading"><form method="dialog" class="sheet"><div class="sheet-heading"><h2 id="goHeading">Go</h2><button class="quiet" type="submit" aria-label="Close">✕</button></div>
    <p>Travel is part of the planned living world. Ember has not yet loaded Orbis's canonical route graph or implemented authoritative journeys, so it will not invent routes or move your character.</p>
    <p class="muted">You can still write a travel attempt freely in the writing desk. Validated travel requires later Orbis world-data and simulation integration.</p>
    <div class="sheet-foot"><button class="primary" type="submit">Back to story</button></div>
  </form></dialog>
  <input id="fileInput" type="file" accept=".json,application/json" hidden>
  <input id="codaAudioInput" type="file" accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg" hidden>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
`;

const $ = selector => root.querySelector(selector);
let toastTimer;
const toast = message => {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 4500);
};
const hideToast = () => $("#toast").classList.remove("visible");
const openDialog = selector => $(selector).showModal();
const closeRail = () => {
  railOpen = false;
  $("#worldRail").classList.remove("open");
  $("#railScrim").classList.remove("show");
  $("#railButton").setAttribute("aria-expanded", "false");
};
function saveSoundSettings() {
  try {
    soundSettings = storeSoundPreferences(soundUserId, soundSettings);
  } catch {
    toast("Your browser blocked saving the notification preference.");
  }
  updateSoundSettings();
}
function updateSoundSettings() {
  root.querySelectorAll('input[name="codaSound"]').forEach(input => {
    input.checked = input.value === soundSettings.mode;
  });
  $("#codaVolume").value = String(Math.round(soundSettings.volume * 100));
  $("#codaVolumeValue").value = `${Math.round(soundSettings.volume * 100)}%`;
  $("#codaFileName").textContent = soundSettings.customName
    ? `Local file: ${soundSettings.customName}`
    : "No custom file chosen";
  $("#codaTestButton").disabled = soundBusy;
  $("#codaTestButton").textContent = soundBusy ? "Playing…" : "▶ Test sound";
  $("#codaRemoveButton").disabled = !soundSettings.customName;
}
async function testCodaSound() {
  if (soundBusy) return;
  soundBusy = true;
  updateSoundSettings();
  try {
    const result = await playCodaSound(soundSettings, soundUserId);
    if (result === "silent") toast("Silent mode is on. Coda won't make a sound.");
  } catch (error) {
    toast(error instanceof Error ? error.message : "Unable to play the ringtone.");
  } finally {
    soundBusy = false;
    updateSoundSettings();
  }
}
function updateTheme() {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--prose-size", `${fontSize}px`);
  $("#fontControl").value = String(fontSize);
  $("#fontOutput").value = `${fontSize}px`;
  root.querySelectorAll('input[name="theme"]').forEach(input => input.checked = input.value === theme);
}
function setStory(next) {
  persistStory(next);
  state = next;
  loadError = "";
  render();
}
function render() {
  const disabled = !state;
  $("#sendButton").disabled = disabled;
  $("#waitButton").disabled = disabled;
  $("#playerInput").disabled = disabled;
  $("#worldName").textContent = state?.world.name ?? "Unreadable save";
  $("#locationName").textContent = state?.world.location ?? "Local story could not be restored";
  $("#clock").textContent = state ? formatClock(state.world) : "Time unavailable";
  $("#storyTitle").textContent = state?.title ?? "Recovery required";
  $("#saveStatus").textContent = disabled ? "● Recovery needed" : "● Saved locally";
  $("#previewNotice").innerHTML = disabled
    ? `<strong>Save recovery needed.</strong> ${safe(loadError)} Use "Open saved file" to restore a backup, or "New story" after preserving the damaged browser data if needed.`
    : liveSession?.mode === "character"
      ? `<strong>Orbis character selected:</strong> ${safe(liveSession.asset.name)}. Your conversation is saved locally. NovelAI narration is not connected yet. No quests, travel or world simulation in this mode.`
      : liveSession?.mode === "world"
        ? `<strong>Orbis world selected:</strong> ${safe(liveSession.asset.name)}. Your adventure is freeform; writing is saved locally. NovelAI, travel, quests and world simulation are not connected yet.`
        : '<strong>Offline concept preview.</strong> Your writing is saved locally. NovelAI, Orbis, and world simulation are not connected; no AI narration or canonical events are being generated.';
  $("#storyTurns").replaceChildren();
  if (state) for (const turn of state.turns) {
    const el = document.createElement("article");
    el.className = `turn ${turn.mode === "narrator" ? "narrator" : "player"} ${turn.mode}`;
    const label = document.createElement("div");
    label.className = "turn-label";
    label.textContent = turn.mode === "narrator" ? "PREVIEW OPENING" : `YOU · ${turn.mode.toUpperCase()}`;
    const prose = document.createElement("p");
    prose.className = "turn-prose";
    prose.textContent = turn.text;
    el.append(label, prose);
    $("#storyTurns").append(el);
  }
  renderRail();
}
function railMarkup() {
  if (!state) return '<div class="empty-panel"><h3>Story unavailable</h3><p>Restore a saved story to inspect its world.</p></div>';
  const w = state.world;
  if (activeTab === "here") return `
    <div class="panel-kicker">THE PRESENT MOMENT</div><h2>${safe(w.location)}</h2>
    <p class="muted">Concept location only. Scene presence, weather, and NPC activity await a world-state connection.</p>
    <div class="info-panel"><span class="info-icon">⌖</span><div><strong>Where</strong><p>${safe(w.name)}</p></div></div>
    <div class="info-panel"><span class="info-icon">◷</span><div><strong>When</strong><p>${safe(formatClock(w))}</p></div></div>
    <div class="info-panel"><span class="info-icon">☁</span><div><strong>Conditions</strong><p>${safe(w.weather)}</p></div></div>
    <button type="button" class="rail-action" data-rail-action="wait">Wait here <span>→</span></button>
  `;
  if (activeTab === "places") return `
    <div class="panel-kicker">PLACES &amp; ROUTES</div><h2>Where the world leads</h2>
    <p class="muted">These are known <em>design references</em>, not player discoveries or confirmed travel links.</p>
    <div class="place-entry current"><span>⌖</span><div><strong>${safe(w.location)}</strong><small>Current preview location</small></div></div>
    ${liveSession ? '<div class="empty-panel small">Canonical travel routes have not been loaded from Orbis.</div>' : '<div class="place-entry"><span>◇</span><div><strong>Hollowmere</strong><small>Reference only · no route loaded</small></div></div><div class="place-entry"><span>◇</span><div><strong>Brackenjaw Enclave</strong><small>Reference only · no route loaded</small></div></div>'}
    <button type="button" class="rail-action" data-rail-action="go">Go somewhere <span>→</span></button>
  `;
  if (activeTab === "people") return `
    <div class="panel-kicker">PEOPLE</div><h2>Faces in the world</h2>
    <p class="muted">Character presence, relationships and player knowledge will come from validated story state.</p>
    ${liveSession ? '' : '<div class="person-entry"><span class="avatar">RH</span><div><strong>Ragna Holt</strong><small>Design reference · presence unknown</small></div></div>'}
    <div class="empty-panel small"><p>No live cast or relationship data yet.</p></div>
  `;
  if (activeTab === "journal") return `
    <div class="panel-kicker">YOUR NOTES &amp; EVENTS</div><h2>Journal</h2>
    <p class="muted">Personal notes and local actions. Quest threads and memories are not AI-evaluated.</p>
    <form id="noteForm" class="note-form"><label for="noteInput">Add your own note</label><textarea id="noteInput" maxlength="4000" rows="3" placeholder="A thought, clue, or reminder..."></textarea><button class="rail-action" type="submit">Record note <span>＋</span></button></form>
    <div class="journal-list">${state.journal.length ? [...state.journal].reverse().map(j=> `<div class="journal-entry"><small>DAY ${j.day} · ${String(Math.floor(j.minute/60)).padStart(2,"0")}:${String(j.minute%60).padStart(2,"0")} · ${safe(j.kind.toUpperCase())}</small><p>${safe(j.text)}</p></div>`).join("") : '<div class="empty-panel small">No entries yet.</div>'}</div>
  `;
  return `
    <div class="panel-kicker">YOUR WORLD KNOWLEDGE</div><h2>Almanac</h2>
    <p class="muted">This panel will show Orbis canon your character has actually learned, separately from story-local changes. That knowledge feed is not connected yet.</p>
    <div class="empty-panel"><span aria-hidden="true">⌁</span><h3>Pages still unwritten</h3><p>The Orbis knowledge feed is not connected. Hidden lore is not being revealed or invented.</p></div>
  `;
}
function renderRail() {
  $("#railContent").innerHTML = railMarkup();
  root.querySelectorAll("[data-tab]").forEach(btn => {
    const selected = btn.dataset.tab === activeTab;
    btn.classList.toggle("active", selected);
    btn.setAttribute("aria-current", selected ? "page" : "false");
  });
}

$("#sendButton").addEventListener("click", () => {
  if (!state) return;
  try {
    const text = $("#playerInput").value;
    const next = addPlayerTurn(state, mode, text);
    setStory(next);
    $("#playerInput").value = "";
    $("#inputCount").textContent = `0 / ${MAX_INPUT}`;
    $("#storyScroll").scrollTop = $("#storyScroll").scrollHeight;
    toast("Player turn saved locally. Narration is not connected.");
  } catch (err) { toast(err.message); }
});
$("#playerInput").addEventListener("keydown", event => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $("#sendButton").click(); }
});
$("#playerInput").addEventListener("input", () => {
  $("#inputCount").textContent = `${$("#playerInput").value.length} / ${MAX_INPUT}`;
});
$("#modeSwitch").addEventListener("click", event => {
  const button = event.target.closest("[data-mode]");
  if (!button || !modes.includes(button.dataset.mode)) return;
  mode = button.dataset.mode;
  $("#modeSwitch").querySelectorAll("button").forEach(btn => btn.classList.toggle("selected", btn.dataset.mode === mode));
  $("#playerInput").focus();
});
$("#railContent").addEventListener("submit", event => {
  if (event.target.id !== "noteForm") return;
  event.preventDefault();
  try { setStory(addJournalNote(state, $("#noteInput").value)); toast("Note saved locally."); }
  catch (err) { toast(err.message); }
});
$("#railContent").addEventListener("click", event => {
  const action = event.target.closest("[data-rail-action]")?.dataset.railAction;
  if (action === "wait") openDialog("#waitDialog");
  if (action === "go") openDialog("#goDialog");
});
root.querySelectorAll("[data-tab]").forEach(btn => btn.addEventListener("click", () => {
  activeTab = btn.dataset.tab;
  renderRail();
}));
$("#goButton").addEventListener("click", () => openDialog("#goDialog"));
$("#waitButton").addEventListener("click", () => openDialog("#waitDialog"));
root.querySelectorAll("[data-wait]").forEach(btn => btn.addEventListener("click", () => {
  try {
    setStory(advanceTime(state, Number(btn.dataset.wait)));
    $("#waitDialog").close();
    toast("Preview time advanced. No world events simulated.");
  } catch (err) { toast(err.message); }
}));
$("#prefsButton").addEventListener("click", () => openDialog("#styleDialog"));
$("#prefsMenuButton").addEventListener("click", () => { $(".overflow").open = false; openDialog("#styleDialog"); });
$("#themeButton").addEventListener("click", () => {
  theme = theme === "lamplight" ? "daylight" : "lamplight";
  setPreference("theme", theme);
  updateTheme();
});
root.querySelectorAll('input[name="theme"]').forEach(input => input.addEventListener("change", () => {
  theme = input.value; setPreference("theme", theme); updateTheme();
}));
$("#fontControl").addEventListener("input", event => {
  fontSize = Math.min(26, Math.max(16, Number(event.target.value) || 20));
  setPreference("font", String(fontSize)); updateTheme();
});
$("#codaButton").addEventListener("click", () => {
  const bubble = $("#codaBubble");
  bubble.hidden = !bubble.hidden;
  $("#codaButton").setAttribute("aria-expanded", String(!bubble.hidden));
  // Play only on a direct click, not on each generation or automatic popup.
  if (!bubble.hidden) void testCodaSound();
});
$("#codaDismiss").addEventListener("click", () => {
  $("#codaBubble").hidden = true;
  $("#codaButton").setAttribute("aria-expanded", "false");
});
$("#codaSoundSettings").addEventListener("click", () => openDialog("#styleDialog"));
root.querySelectorAll('input[name="codaSound"]').forEach(input => input.addEventListener("change", () => {
  soundSettings.mode = input.value;
  saveSoundSettings();
}));
$("#codaVolume").addEventListener("input", event => {
  soundSettings.volume = Number(event.target.value) / 100;
  saveSoundSettings();
});
$("#codaUploadButton").addEventListener("click", () => $("#codaAudioInput").click());
$("#codaAudioInput").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const saved = await saveCustomRingtone(soundUserId, file);
    soundSettings = { ...soundSettings, mode: "custom", customName: saved.name };
    saveSoundSettings();
    toast("Custom sound saved on this device. Test it to hear Coda.");
  } catch (error) {
    toast(error instanceof Error ? error.message : "Unable to save ringtone.");
  } finally {
    event.target.value = "";
  }
});
$("#codaRemoveButton").addEventListener("click", async () => {
  try {
    await deleteCustomRingtone(soundUserId);
    soundSettings = { ...soundSettings, mode: "coda", customName: "" };
    saveSoundSettings();
    toast("Custom sound removed from this browser.");
  } catch {
    toast("Unable to remove the saved custom sound.");
  }
});
$("#codaTestButton").addEventListener("click", () => void testCodaSound());
$("#exportButton").addEventListener("click", () => {
  $(".overflow").open = false;
  if (!state) { toast("No readable story to export. Browser data was not overwritten."); return; }
  const blob = new Blob([exportStory(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ember-story-${state.id.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Story backup prepared.");
});
$("#importButton").addEventListener("click", () => { $(".overflow").open = false; $("#fileInput").click(); });
$("#fileInput").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error("Save file is too large");
    const next = importStory(await file.text());
    if (!window.confirm("Replace the currently open local story with this backup?")) return;
    setStory(next);
    toast("Story imported and saved locally.");
  } catch (err) { toast(`Import failed: ${err.message}`); }
  finally { event.target.value = ""; }
});
$("#newButton").addEventListener("click", () => {
  $(".overflow").open = false;
  const warning = loadError
    ? "The current browser save is unreadable. A new story will overwrite it. Continue only if you no longer need to recover that data."
    : "Create a new story? Export the current story first if you want to keep it.";
  if (!window.confirm(warning)) return;
  try {
    const fresh = liveSession ? createStoryFromLaunch(liveSession) : createStory();
    persistStory(fresh);
    state = fresh;
    loadError = "";
    activeTab = "here";
    render();
    toast("New local story created.");
  } catch (err) { toast(`Unable to create story: ${err.message}`); }
});
$("#railButton").addEventListener("click", () => {
  railOpen = !railOpen;
  $("#worldRail").classList.toggle("open", railOpen);
  $("#railScrim").classList.toggle("show", railOpen);
  $("#railButton").setAttribute("aria-expanded", String(railOpen));
});
$("#railScrim").addEventListener("click", closeRail);
$("#closeRail").addEventListener("click", closeRail);
document.addEventListener("keydown", event => { if (event.key === "Escape") { closeRail(); hideToast(); } });
updateTheme();
updateSoundSettings();
render();
if (loadError) toast(loadError);
// An Ember tab must stop showing private material when its Orbis session ends.
if (liveSession) {
  const verifyActiveSession = async () => {
    try {
      const response = await fetch('/ember/api/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('Session expired');
      const current = await response.json();
      if (current.userId !== liveSession.userId || current.mode !== liveSession.mode
        || current.asset?.id !== liveSession.asset.id) throw new Error('Session changed');
    } catch {
      root.replaceChildren();
      root.innerHTML = '<div class="signed-out"><h1>Orbis session ended</h1><p>Your local story remains saved for your account. Return to Orbis and select a character or world to continue.</p><a href="https://lib.thehowlingwhispers.com/">Return to Orbis</a></div>';
    }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void verifyActiveSession(); });
  window.setInterval(() => void verifyActiveSession(), 30_000);
}
