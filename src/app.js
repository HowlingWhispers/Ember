import { createStory, createStoryFromLaunch, addPlayerTurn, addNarratorTurn, addJournalNote, advanceTime, formatClock, MAX_INPUT, cleanNarration, wrapComposerSelection, exitComposerPair } from "./engine.js";
import { configureStoryScope, loadStory, persistStory, getPreference, setPreference, importStory, exportStory } from "./storage.js";
import {
  readSoundPreferences, storeSoundPreferences, saveCustomRingtone,
  deleteCustomRingtone, playCodaSound,
} from "./coda-sound.js";
import { parseCodaCandidate, loadDiscovery, saveDiscovery, shouldDiscover } from "./coda-discovery.js";

const root = document.querySelector("#app");
const liveSession = globalThis.__EMBER_SESSION__ ?? null;
if (liveSession) configureStoryScope(liveSession);
document.documentElement.dataset.emberMode = liveSession?.mode ?? "preview";
let { state, error: loadError } = loadStory();
let activeTab = "here";
let theme = getPreference("theme", "lamplight") === "daylight" ? "daylight" : "lamplight";
// Phones: keep this query identical to the "Phone layout" block in styles.css.
const PHONE_QUERY = "(max-width: 600px), (pointer: coarse) and (max-height: 500px)";
const isPhone = typeof matchMedia === "function" && matchMedia(PHONE_QUERY).matches;
// A saved size always wins; only the unsaved default is smaller on phones.
const defaultFontSize = isPhone ? 18 : 20;
let fontSize = Math.min(26, Math.max(16, Number(getPreference("font", String(defaultFontSize))) || defaultFontSize));
const NEAR_LIMIT = Math.floor(MAX_INPUT * 0.9);
let density = getPreference("density", "compact") === "comfortable" ? "comfortable" : "compact";
let railOpen = false;
const soundUserId = liveSession?.userId;
let soundSettings = readSoundPreferences(soundUserId);
let soundBusy = false;
let narrationBusy = false;
let narrationError = "";
let codaDiscovery = loadDiscovery(liveSession?.userId, state?.id ?? "unavailable");
let codaDiscoveryBusy = false;
const tabs = ["here", "places", "people", "journal", "almanac"];
const safe = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

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
              <button type="button" id="menuButton" class="chip-button phone-only" aria-label="Story menu" aria-expanded="false" aria-controls="worldRail">☰</button>
              <button type="button" id="goButton" class="chip-button">↗ Go</button>
              <button type="button" id="waitButton" class="chip-button">◷ Wait</button>
              <button type="button" id="passButton" class="chip-button" disabled title="Available when a narrator is connected"><span class="long-label">Pass the turn</span><span class="short-label">Pass</span></button>
              
            </div>
          </div>
          <div class="composer">
            <div class="mode-switch" id="modeSwitch" aria-label="Insert roleplay formatting">
              <button type="button" data-format="action">*Action*</button>
              <button type="button" data-format="speech">&quot;Speech&quot;</button>
              <button type="button" data-format="thought">(Thought)</button>
            </div>
            <label class="visually-hidden" for="playerInput">Your freeform roleplay</label>
            <textarea id="playerInput" rows="2" maxlength="${MAX_INPUT}" placeholder="What do you do, say, or think?"></textarea>
            <div class="composer-footer">
              <span class="composer-hint" id="composeHint">Your words are recorded locally.</span>
              <span class="input-count" id="inputCount">0 / ${MAX_INPUT}</span>
              <button type="button" class="primary" id="sendButton"><span class="send-label">Send ➜</span><span class="send-glyph" aria-hidden="true">➜</span></button>
            </div>
          </div>
          <div class="narration-feedback">
            <div id="narrationStatus" class="narration-status" role="status" aria-live="polite"></div>
            <div id="narrationError" class="narration-error" role="status" hidden>
              <span id="narrationErrorText"></span>
              <button id="retryNarration" type="button" class="chip-button">Retry reply</button>
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
        <nav class="phone-menu phone-only" aria-label="Story menu">
          <p class="phone-menu-status"><span id="phoneSaveStatus">● Saved locally</span><span id="phoneClock"></span></p>
          <div class="phone-menu-actions">
            <button type="button" data-menu-action="style">Scene & style</button>
            <button type="button" data-menu-action="theme">◐ Theme</button>
            <button type="button" data-menu-action="export">Save to file</button>
            <button type="button" data-menu-action="import">Open saved file</button>
            <button type="button" data-menu-action="new">New story</button>
          </div>
        </nav>
        <footer class="rail-footer"><span class="tiny-led"></span> PREVIEW DATA · NO ORBIS CONNECTION</footer>
      </aside>
    </div>
  </div>
  <section class="coda-dock" aria-label="Coda notification companion preview">
    <div id="codaBubble" class="coda-bubble" hidden>
      <div class="coda-bubble-header"><strong>Coda</strong><button type="button" class="quiet" id="codaDismiss" aria-label="Dismiss Coda message">✕</button></div>
      <strong class="coda-greeting">Hey! Listen! 🐾</strong>
      <p id="codaIntro">I'll quietly watch for emerging characters as your story develops. Nothing is saved to Orbis.</p>
      <div id="codaSuggestion" hidden>
        <label for="codaDraftName">Proposed character name</label>
        <input id="codaDraftName" maxlength="120">
        <label for="codaDraftRole">Role or relationship</label>
        <input id="codaDraftRole" maxlength="200">
        <label for="codaDraftFacts">Established details</label>
        <textarea id="codaDraftFacts" rows="2" maxlength="200"></textarea>
        <label for="codaDraftIdeas">Coda's optional suggestions</label>
        <textarea id="codaDraftIdeas" rows="2" maxlength="200"></textarea>
        <div class="coda-draft-actions">
          <button type="button" id="codaKeep" class="chip-button">Keep locally</button>
          <button type="button" id="codaSkip" class="chip-button">Not now</button>
        </div>
      </div>
      <p class="coda-disclaimer" id="codaDisclaimer">Character drafts stay on this device until you approve them.</p>
      <button type="button" class="chip-button" id="codaSoundSettings">Notification sound settings</button>
    </div>
    <button type="button" id="codaButton" class="coda-orb" aria-label="Open Coda companion preview" aria-expanded="false" aria-controls="codaBubble" title="Coda: Hey! Listen!"><span aria-hidden="true">🐾</span><span class="coda-orb-label">Coda</span></button>
  </section>
  <dialog id="styleDialog" aria-labelledby="styleHeading"><form method="dialog" class="sheet"><div class="sheet-heading"><h2 id="styleHeading">Scene &amp; style</h2><button class="quiet" type="submit" aria-label="Close">✕</button></div>
    <p class="muted">Make the story comfortable to read. These controls affect presentation only.</p>
    <fieldset><legend>Reading theme</legend><div class="theme-choices"><label><input type="radio" name="theme" value="lamplight"> Lamplight</label><label><input type="radio" name="theme" value="daylight"> Daylight</label></div></fieldset>
    <fieldset><legend>Reading layout</legend><div class="theme-choices"><label><input type="radio" name="density" value="compact"> Compact</label><label><input type="radio" name="density" value="comfortable"> Comfortable</label></div></fieldset>
    <label for="fontControl" class="setting-label">Story text size <output id="fontOutput"></output></label><input type="range" id="fontControl" min="16" max="26" step="1">
    <fieldset class="sound-options">
      <legend>Coda's Hey! Listen! alert</legend>
      <p class="muted">Choose the sound you hear when Coda has a discovery. No story listening is active yet.</p>
      <label><input type="radio" name="codaSound" value="hey-listen"> Hey! Listen! (uploaded classic clip)</label>
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
      <p class="muted">Custom files stay in this browser on this device, scoped to your Orbis account. The built-in clip is bundled with Ember.</p>
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
// The header's World button and the phone menu button open the same drawer.
const setRail = open => {
  railOpen = open;
  $("#worldRail").classList.toggle("open", open);
  $("#railScrim").classList.toggle("show", open);
  $("#railButton").setAttribute("aria-expanded", String(open));
  $("#menuButton").setAttribute("aria-expanded", String(open));
};
const closeRail = () => setRail(false);
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
  document.documentElement.dataset.density = density;
  root.querySelectorAll('input[name="density"]').forEach(input => input.checked = input.value === density);
  document.documentElement.style.setProperty("--prose-size", `${fontSize}px`);
  $("#fontControl").value = String(fontSize);
  $("#fontOutput").value = `${fontSize}px`;
  root.querySelectorAll('input[name="theme"]').forEach(input => input.checked = input.value === theme);
}
function setStory(next) {
  persistStory(next);
  if (next.id !== state?.id) codaDiscovery = loadDiscovery(liveSession?.userId, next.id);
  state = next;
  loadError = "";
  render();
}
function renderNarrationState() {
  const live = Boolean(liveSession);
  const last = state?.turns.at(-1);
  const canRetry = live && !narrationBusy && last?.source === "player";
  $("#sendButton").disabled = !state || narrationBusy || (canRetry && !$("#playerInput").value.trim());
  // The label is unchanged on desktop; phones show only the glyph, so the
  // label also becomes the button's accessible name.
  const sendLabel = narrationBusy ? "Generating…" : live ? "Send to NovelAI ➜" : "Add to story ➜";
  $("#sendButton .send-label").textContent = sendLabel;
  $("#sendButton .send-glyph").textContent = narrationBusy ? "…" : "➜";
  $("#sendButton").setAttribute("aria-label", sendLabel.replace(" ➜", ""));
  $("#passButton").disabled = true;
  $("#playerInput").disabled = !state || narrationBusy;
  $("#composeHint").textContent = !live
    ? "Offline preview: saves your words but cannot generate narration."
    : narrationBusy ? "NovelAI is writing the next moment…"
    : canRetry ? "Last message is saved. Retry its response, or write another message."
    : "NovelAI uses the key already saved in your Orbis account.";
  $("#narrationStatus").textContent = narrationBusy ? "✧ Awaiting NovelAI's reply…" : "";
  // Pre-existing local player turns from the earlier offline-only shell
  // must be continuable after upgrade, without sending another message.
  $("#narrationError").hidden = !(narrationError || canRetry);
  $("#narrationError").setAttribute("role", narrationError ? "alert" : "status");
  $("#narrationErrorText").textContent = narrationError || "Your last message is saved and waiting for a reply.";
  $("#retryNarration").textContent = narrationError ? "Retry reply" : "Generate reply";
  $("#retryNarration").disabled = !canRetry;
  // Phones float this feedback over the story; reserve scroll room only while it shows.
  $(".story-column").classList.toggle("has-feedback", narrationBusy || !$("#narrationError").hidden);
}
async function generateLastTurn() {
  if (!liveSession || narrationBusy || !state) return;
  const last = state.turns.at(-1);
  if (!last || last.source !== "player") return;
  const expectedStoryId = state.id;
  const expectedRevision = state.revision;
  narrationBusy = true;
  narrationError = "";
  renderNarrationState();
  try {
    const history = state.turns
      .filter(turn => turn.source === "player" || turn.source === "provider")
      .slice(-48)
      .map(turn => ({ mode: turn.mode, source: turn.source, text: turn.source === "provider" ? cleanNarration(turn.text) : turn.text }));
    // Don't send an entire marathon save over a bounded generation endpoint.
    // Keep the latest complete turns; Orbis makes the final prompt truncation.
    const turns = [];
    let remaining = 65_000;
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      if (entry.text.length > remaining) break;
      turns.unshift(entry);
      remaining -= entry.text.length;
    }
    const response = await fetch("/ember/api/generate",{
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type":"application/json", "X-Ember-Request":"generation" },
      body: JSON.stringify({ turns }),
    });
    let result = {};
    try { result = await response.json(); } catch { /* gateway error */ }
    if (!response.ok || typeof result.text !== "string") {
      throw new Error(result.error || `Narration failed (HTTP ${response.status}).`);
    }
    if (!state || state.id !== expectedStoryId || state.revision !== expectedRevision) {
      throw new Error("Story changed during generation. Reply was not attached.");
    }
    const completed = addNarratorTurn(state, last.id, result.text);
    setStory(completed);
    void discoverAfterNarration(completed);
    $("#storyScroll").scrollTop = $("#storyScroll").scrollHeight;
  } catch (err) {
    narrationError = err instanceof Error ? err.message : "NovelAI failed. Retry the last turn.";
  } finally {
    narrationBusy = false;
    renderNarrationState();
  }
}
function render() {
  const disabled = !state;
  $("#waitButton").disabled = disabled || narrationBusy;
  $("#worldName").textContent = state?.world.name ?? "Unreadable save";
  $("#locationName").textContent = state?.world.location ?? "Local story could not be restored";
  $("#clock").textContent = state ? formatClock(state.world) : "Time unavailable";
  $("#storyTitle").textContent = state?.title ?? "Recovery required";
  $("#saveStatus").textContent = disabled ? "● Recovery needed" : "● Saved locally";
  $("#phoneSaveStatus").textContent = $("#saveStatus").textContent;
  $("#phoneClock").textContent = liveSession?.mode === "character" ? "" : $("#clock").textContent;
  $("#previewNotice").innerHTML = disabled
    ? `<strong>Save recovery needed.</strong> ${safe(loadError)} Use "Open saved file" to restore a backup, or "New story" after preserving the damaged browser data if needed.`
    : liveSession?.mode === "sandbox"
      ? '<strong>Free Sandbox.</strong> No package or preset world is required. Type a message and NovelAI will continue using your Orbis account settings.'
      : liveSession?.mode === "character"
        ? `<strong>Character roleplay:</strong> ${safe(liveSession.asset.name)}. Your conversation is saved locally, with narration from your Orbis NovelAI account.`
        : liveSession?.mode === "world"
          ? `<strong>World adventure:</strong> ${safe(liveSession.asset.name)}. Freeform roleplay powered by your Orbis NovelAI account. Travel and world-state simulation remain under development.`
          : '<strong>Offline concept preview.</strong> Your writing is saved locally. Sign into Orbis and enter Ember online to generate NovelAI replies.';
  $(".story-column").classList.toggle("has-turns", Boolean(state?.turns?.length));
  $("#storyTurns").replaceChildren();
  if (state) for (const turn of state.turns) {
    const el = document.createElement("article");
    el.className = `turn ${turn.mode === "narrator" ? "narrator" : "player"} ${turn.mode}`;
    const label = document.createElement("div");
    label.className = "turn-label";
    label.textContent = turn.mode === "narrator" ? (turn.source === "provider" ? "STORY" : "PREVIEW OPENING") : "YOU";
    const prose = document.createElement("p");
    prose.className = "turn-prose";
    prose.textContent = turn.source === "provider" ? cleanNarration(turn.text) : turn.text;
    el.append(label, prose);
    $("#storyTurns").append(el);
  }
  renderRail();
  renderCodaDiscovery();
  renderNarrationState();
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
    ${liveSession ? '<div class="empty-panel small">No locations established yet. Write freely to discover them.</div>' : '<div class="place-entry"><span>◇</span><div><strong>Hollowmere</strong><small>Reference only · no route loaded</small></div></div><div class="place-entry"><span>◇</span><div><strong>Brackenjaw Enclave</strong><small>Reference only · no route loaded</small></div></div>'}
    <button type="button" class="rail-action" data-rail-action="go">Go somewhere <span>→</span></button>
  `;
  if (activeTab === "people") return `
    <div class="panel-kicker">PEOPLE</div><h2>Faces in the world</h2>
    <p class="muted">Your approved characters, stored privately in this browser.</p>
    ${codaDiscovery.profiles.map(person => `<div class="person-entry"><span class="avatar">✧</span><div><strong>${safe(person.name)}</strong><small>${safe(person.role || "Story character")}</small><p>${safe(person.established)}</p>${person.suggestions ? `<small>Ideas: ${safe(person.suggestions)}</small>` : ""}</div></div>`).join("")}
    ${codaDiscovery.profiles.length ? "" : '<div class="empty-panel small"><p>No approved local characters yet. Coda may suggest one as your story develops.</p></div>'}
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

function renderCodaDiscovery() {
  const pending = codaDiscovery.pending;
  $("#codaSuggestion").hidden = !pending;
  $("#codaIntro").textContent = pending
    ? "I noticed someone taking shape in your story. Want to keep a private character profile? 🐾"
    : "I'll quietly watch for emerging characters as your story develops. Nothing is saved to Orbis.";
  $("#codaButton").classList.toggle("has-discovery", Boolean(pending));
  $("#codaButton").setAttribute("title", pending ? "Coda has a character suggestion" : "Open Coda");
  if (pending) {
    $("#codaDraftName").value = pending.name;
    $("#codaDraftRole").value = pending.role;
    $("#codaDraftFacts").value = pending.established;
    $("#codaDraftIdeas").value = pending.suggestions;
  }
}

async function discoverAfterNarration(snapshot) {
  if (liveSession?.mode !== "sandbox" || codaDiscoveryBusy || !shouldDiscover(snapshot.turns, codaDiscovery)) return;
  const storyId = snapshot.id;
  const players = snapshot.turns.filter(turn => turn.source === "player").length;
  codaDiscovery.lastChecked = players;
  try { saveDiscovery(liveSession.userId, storyId, codaDiscovery); }
  catch { return; }
  codaDiscoveryBusy = true;
  try {
    const turns = snapshot.turns.filter(turn => turn.source === "player" || turn.source === "provider")
      .slice(-24).map(turn => ({mode:turn.mode, source:turn.source, text:turn.text}));
    const response = await fetch("/ember/api/generate", {
      method:"POST", credentials:"same-origin", cache:"no-store",
      headers:{"Content-Type":"application/json","X-Ember-Request":"generation"},
      body:JSON.stringify({task:"discovery",turns}),
    });
    if (!response.ok) return;
    const result = await response.json();
    const candidate = parseCodaCandidate(result.text);
    if (!candidate || state?.id !== storyId || codaDiscovery.pending) return;
    if (codaDiscovery.profiles.some(person => person.name.toLocaleLowerCase() === candidate.name.toLocaleLowerCase())) return;
    codaDiscovery.pending = candidate;
    saveDiscovery(liveSession.userId, storyId, codaDiscovery);
    renderCodaDiscovery();
  } catch { /* Suggestions are optional; never interrupt the story. */ }
  finally { codaDiscoveryBusy = false; }
}

$("#codaKeep").addEventListener("click", () => {
  if (!state || !codaDiscovery.pending) return;
  const draft = parseCodaCandidate(JSON.stringify({candidate:{
    name:$("#codaDraftName").value,role:$("#codaDraftRole").value,
    established:$("#codaDraftFacts").value,suggestions:$("#codaDraftIdeas").value,
  }}));
  if (!draft) return toast("Enter a name and an established detail or role.");
  if (!codaDiscovery.profiles.some(person => person.name.toLocaleLowerCase() === draft.name.toLocaleLowerCase()))
    codaDiscovery.profiles.push(draft);
  codaDiscovery.pending = null;
  try { saveDiscovery(liveSession?.userId,state.id,codaDiscovery); }
  catch { return toast("Unable to save this character in the browser."); }
  renderCodaDiscovery(); renderRail(); setCodaOpen(false);
  toast("Character saved privately in this story's People tab.");
});
$("#codaSkip").addEventListener("click", () => {
  if (!state) return;
  codaDiscovery.pending = null;
  try { saveDiscovery(liveSession?.userId,state.id,codaDiscovery); }
  catch { return toast("Unable to update Coda's suggestion."); }
  renderCodaDiscovery(); setCodaOpen(false);
});

$("#sendButton").addEventListener("click", () => {
  if (!state || narrationBusy) return;
  try {
    const next = addPlayerTurn(state, "action", $("#playerInput").value);
    narrationError = "";
    $("#playerInput").value = "";
    resizeComposer();
    updateInputCount();
    setStory(next);
    $("#storyScroll").scrollTop = $("#storyScroll").scrollHeight;
    if (liveSession) void generateLastTurn();
    else toast("Saved in offline preview. NovelAI is available through your Orbis login.");
  } catch (err) { toast(err.message); }
});
$("#retryNarration").addEventListener("click", () => void generateLastTurn());
$("#playerInput").addEventListener("keydown", event => {
  if (event.key !== "Enter" || event.isComposing) return;
  const field = $("#playerInput");
  if (!event.shiftKey && !event.ctrlKey && !event.metaKey && field.selectionStart === field.selectionEnd) {
    const result = exitComposerPair(field.value, field.selectionStart);
    if (result) {
      event.preventDefault();
      field.value = result.text;
      field.setSelectionRange(result.caret, result.caret);
      resizeComposer();
      updateInputCount();
      return;
    }
  }
  if (event.ctrlKey || event.metaKey) { event.preventDefault(); $("#sendButton").click(); }
});
function resizeComposer() {
  const field = $("#playerInput");
  // Follow the stylesheet's cap, which is lower on phones.
  const max = parseFloat(getComputedStyle(field).maxHeight) || 170;
  // "auto" sizes to rows="2"; phones start at one line and grow with the text.
  field.style.height = typeof matchMedia === "function" && matchMedia(PHONE_QUERY).matches ? "0px" : "auto";
  field.style.height = `${Math.min(field.scrollHeight, max)}px`;
  field.style.overflowY = field.scrollHeight > max ? "auto" : "hidden";
}
resizeComposer();
// Phones show the count only near the limit; desktop always shows it.
function updateInputCount() {
  const length = $("#playerInput").value.length;
  $("#inputCount").textContent = `${length} / ${MAX_INPUT}`;
  $("#inputCount").classList.toggle("near-limit", length >= NEAR_LIMIT);
}
$("#playerInput").addEventListener("input", () => {
  resizeComposer();
  updateInputCount();
  renderNarrationState();
});
// Toolbar selection is preserved on desktop and touch devices.
$("#modeSwitch").addEventListener("pointerdown", event => {
  if (event.target.closest("[data-format]")) event.preventDefault();
});
$("#modeSwitch").addEventListener("click", event => {
  const kind = event.target.closest("[data-format]")?.dataset.format;
  if (!kind) return;
  const field = $("#playerInput");
  const result = wrapComposerSelection(field.value, field.selectionStart, field.selectionEnd, kind);
  if (!result || result.text.length > MAX_INPUT) return;
  field.value = result.text;
  field.focus();
  field.setSelectionRange(result.start, result.end);
  resizeComposer();
  updateInputCount();
  renderNarrationState();
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
root.querySelectorAll('input[name="density"]').forEach(input => input.addEventListener("change", event => {
  density = event.target.value === "comfortable" ? "comfortable" : "compact";
  setPreference("density", density);
  updateTheme();
}));
$("#fontControl").addEventListener("input", event => {
  fontSize = Math.min(26, Math.max(16, Number(event.target.value) || 20));
  setPreference("font", String(fontSize)); updateTheme();
});
let codaIdleTimer;
function setCodaOpen(open) {
  const bubble = $("#codaBubble");
  bubble.hidden = !open;
  $(".coda-dock").classList.toggle("is-open", open);
  $("#codaButton").setAttribute("aria-expanded", String(open));
  clearTimeout(codaIdleTimer);
  if (open) codaIdleTimer = setTimeout(() => {
    // Never close while the user is actively reading or using the popup.
    if (!$(".coda-dock").matches(":hover") && !bubble.contains(document.activeElement)) {
      setCodaOpen(false);
    }
  }, 20000);
}
$("#codaButton").addEventListener("click", () => {
  const open = $("#codaBubble").hidden;
  setCodaOpen(open);
  // Only a user-initiated opening plays audio. No automatic interruptions.
  if (open) void testCodaSound();
});
$("#codaDismiss").addEventListener("click", () => setCodaOpen(false));
$("#codaSoundSettings").addEventListener("click", () => {
  setCodaOpen(false);
  openDialog("#styleDialog");
});
document.addEventListener("pointerdown", event => {
  if (!$("#codaBubble").hidden && !$(".coda-dock").contains(event.target)) setCodaOpen(false);
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("#codaBubble").hidden) setCodaOpen(false);
});
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
    if (narrationBusy) throw new Error("Finish generation before importing a different story.");
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
  if (narrationBusy) { toast("Wait until NovelAI finishes before starting another story."); return; }
  if (!window.confirm(warning)) return;
  try {
    const fresh = liveSession ? createStoryFromLaunch(liveSession) : createStory();
    narrationError = "";
    persistStory(fresh);
    state = fresh;
    loadError = "";
    activeTab = "here";
    render();
    toast("New local story created.");
  } catch (err) { toast(`Unable to create story: ${err.message}`); }
});
// Phone menu entries reuse the header controls, which phones hide.
const menuTargets = { style: "#prefsMenuButton", theme: "#themeButton", export: "#exportButton", import: "#importButton", new: "#newButton" };
root.querySelector(".phone-menu").addEventListener("click", event => {
  const target = menuTargets[event.target.closest("[data-menu-action]")?.dataset.menuAction];
  if (!target) return;
  if (target !== "#themeButton") closeRail();
  $(target).click();
});
if (liveSession?.mode === "character") $(".rail-kicker").textContent = "STORY MENU";
$("#railButton").addEventListener("click", () => setRail(!railOpen));
$("#menuButton").addEventListener("click", () => setRail(!railOpen));
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
        || (current.asset?.id ?? null) !== (liveSession.asset?.id ?? null)) throw new Error('Session changed');
    } catch {
      root.replaceChildren();
      root.innerHTML = '<div class="signed-out"><h1>Orbis session ended</h1><p>Your local story remains saved. Reopen Ember to restore your existing Orbis session or sign in again.</p><a href="/ember/">Reopen Ember</a></div>';
    }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void verifyActiveSession(); });
  window.setInterval(() => void verifyActiveSession(), 30_000);
}
