import { createStory, createStoryFromLaunch, addPlayerTurn, addNarratorTurn, addJournalNote, advanceTime, formatClock, MAX_INPUT, cleanNarration, setStoryMemory, setStoryPersona, replacePlayerTurn, replaceProviderTurn, removeProviderTurn, removePlayerTurn, wrapComposerSelection, exitComposerPair } from "./engine.js";
import { configureStoryScope, loadStory, persistStory, getPreference, setPreference, importStory, exportStory } from "./storage.js";
import {
  readSoundPreferences, storeSoundPreferences, saveCustomRingtone,
  deleteCustomRingtone, playCodaSound,
} from "./coda-sound.js";
import { parseCodaCandidate, loadDiscovery, saveDiscovery, shouldDiscover } from "./coda-discovery.js";
import { mountAssetLibrary } from "./library-ui.js";
import { getStoryAssets, getLocalAsset, setStoryAssets } from "./asset-store.js";
import { compileEmberContext } from "./context-compiler.js";
import {DEFAULT_REPLY_LENGTH,REPLY_LENGTHS,replyLengthOrDefault} from "./reply-length.js";
import { segmentStoryText, storyCharacterHeading } from "./story-format.js";
import { exportSanitizedStory } from "./story-share.js";
import {detectPlayerAgency} from "./player-agency.js";
import {personaTurnBlocker,cleanPersonaDraft} from "./persona-turn.js";
import {PERSONA_FLAVORS,PERSONA_DECISIONS,PERSONA_DIRECTIONS,PERSONA_CREATIVITY,normalizePersonaOptions,resolvePersonaFlavor,rememberRejectedDrafts} from "./persona-options.js";

const root = document.querySelector("#app");
const liveSession = globalThis.__EMBER_SESSION__ ?? null;
const isGuest = liveSession?.identity === "guest";
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
let personaBusy = false;
let personaPreview = null;
let personaHistoryScope = "";
let personaRejected = [];
let personaLastFlavor = "";
let personaOptions;
try { personaOptions=normalizePersonaOptions(JSON.parse(getPreference("personaTurnOptions","{}"))); }
catch { personaOptions=normalizePersonaOptions(); }
let generationLength=replyLengthOrDefault(getPreference("replyLength",DEFAULT_REPLY_LENGTH));
let latestContextCoverage = null;
let activeCardName = {storyId:null,characterId:null,name:""};
let activePersonaName = {storyId:null,personaId:null,name:""};
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
        <button class="quiet desktop-only" id="libraryButton" type="button">My Library</button>
        <button class="quiet desktop-only" id="personaButton" type="button">My Persona</button>
        ${isGuest ? '<a class="quiet desktop-only" id="accountButton" href="/ember/account">Account &amp; NovelAI</a>' : ""}
        <button class="quiet desktop-only" id="prefsButton" type="button">Scene &amp; style</button>
        <details class="overflow"><summary class="quiet" aria-label="More story options">•••</summary><div class="popover">
          <button type="button" id="libraryMenuButton">My Library</button>
          <button type="button" id="personaMenuButton">My Persona</button>
          ${isGuest ? '<button type="button" id="accountMenuButton">Account &amp; NovelAI</button>' : ""}
          <button type="button" id="memoryMenuButton">Story Memory &amp; context</button>
          <button type="button" id="copySanitizedMenuButton">📋 Copy sanitized story</button>
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
              <button type="button" id="memoryButton" class="story-share-button" title="Pin important story facts and see how much history NovelAI receives.">✧ Story Memory</button>
              <button type="button" id="copySanitizedButton" class="story-share-button" title="Copy the readable story only, without account data, app controls or internal metadata. Fictional names and story content are preserved.">📋 Copy sanitized story</button>
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
              <button type="button" id="personaAIButton" class="chip-button" title="Choose a V2 player persona first">✧ AI Turn</button>
              <button type="button" id="passButton" class="chip-button" disabled title="Available when a narrator is connected"><span class="long-label">Pass the turn</span><span class="short-label">Pass</span></button>
              
            </div>
          </div>
          <div class="composer">
            <div class="mode-switch" id="modeSwitch" aria-label="Insert roleplay formatting">
              <button type="button" data-format="action">*Action*</button>
              <button type="button" data-format="speech">&quot;Speech&quot;</button>
              <button type="button" data-format="thought">(Thought)</button>
              ${isGuest ? '<label class="reply-length-picker" for="replyLengthSelect">AI reply <select id="replyLengthSelect" aria-label="NovelAI reply length"><option value="short">Short · 80 words</option><option value="normal">Normal · 135 words</option><option value="long">Long · 250 words</option></select></label>' : ""}
            </div>
            <label class="visually-hidden" for="playerInput">Your freeform roleplay</label>
            <textarea id="playerInput" rows="2" maxlength="${MAX_INPUT}" placeholder="What do you do, say, or think?"></textarea>
            <div class="composer-footer">
              <span class="composer-hint" id="composeHint">Your words are recorded locally.</span>
              <span class="input-count" id="inputCount">0 / ${MAX_INPUT}</span>
              <button type="button" class="primary" id="sendButton"><span class="send-label">Send ➜</span><span class="send-glyph" aria-hidden="true">➜</span></button>
            </div>
          </div>
          <p id="contextCoverage" class="context-coverage" aria-live="polite"></p>
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
            <button type="button" data-menu-action="library">My Library</button>
            <button type="button" data-menu-action="persona">My Persona</button>
            ${isGuest ? '<button type="button" data-menu-action="account">Account &amp; NovelAI</button>' : ""}
            <button type="button" data-menu-action="style">Scene & style</button>
            <button type="button" data-menu-action="theme">◐ Theme</button>
            <button type="button" data-menu-action="memory">Story Memory &amp; context</button>
            <button type="button" data-menu-action="copySanitized">📋 Copy sanitized story</button>
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
  <dialog id="personaDialog" aria-labelledby="personaHeading">
    <div class="sheet">
      <div class="sheet-heading"><h2 id="personaHeading">✧ Persona AI turn</h2><button id="personaClose" class="quiet" type="button" aria-label="Close persona draft">✕</button></div>
      <p class="persona-intro">One player turn at a time. Nothing is sent until you approve.</p>
      <label for="personaFlavor" class="setting-label">Turn flavor</label>
      <select id="personaFlavor" class="persona-choice">
        ${PERSONA_FLAVORS.map(item=>`<option value="${safe(item.value)}">${safe(item.label)}</option>`).join("")}
      </select>
      <details id="personaExtraSettings" class="persona-settings">
        <summary>Decision style, creativity and direction</summary>
        <div class="persona-settings-grid">
          <label for="personaDecision">Decision style
            <select id="personaDecision" class="persona-choice">
              ${PERSONA_DECISIONS.map(item=>`<option value="${safe(item.value)}">${safe(item.label)}</option>`).join("")}
            </select>
          </label>
          <label for="personaCreativity">Creativity
            <select id="personaCreativity" class="persona-choice">
              ${PERSONA_CREATIVITY.map(item=>`<option value="${safe(item.value)}">${safe(item.label)}</option>`).join("")}
            </select>
          </label>
          <label for="personaDirection">Turn direction
            <select id="personaDirection" class="persona-choice">
              ${PERSONA_DIRECTIONS.map(item=>`<option value="${safe(item.value)}">${safe(item.label)}</option>`).join("")}
            </select>
          </label>
        </div>
        <label class="persona-repeat-label"><input type="checkbox" id="personaAvoidRepeats"> Avoid repeating rejected turns</label>
      </details>
      <label for="personaSuggestion" class="setting-label">Suggestion for this turn (optional)</label>
      <textarea id="personaSuggestion" rows="2" maxlength="1000" placeholder="Guide your next action, speech or thoughts."></textarea>
      <label for="personaDraft" class="setting-label">Review or edit the proposed turn</label>
      <textarea id="personaDraft" rows="7" maxlength="${MAX_INPUT}" placeholder="Your persona's proposed action, speech or thoughts"></textarea>
      <p id="personaDraftNotice" role="status" aria-live="polite"></p>
      <p id="personaDraftError" role="alert" aria-live="polite"></p>
      <div class="sheet-foot">
        <button type="button" id="personaCancel" class="quiet">Cancel</button>
        <button type="button" id="personaGenerate" class="chip-button">Generate turn</button>
        <button type="button" id="personaRegenerate" class="chip-button" title="Keep the decision but rewrite its words">↻ Rewrite</button>
        <button type="button" id="personaDifferent" class="chip-button" title="Make a materially different choice">⤨ Different approach</button>
        <button type="button" id="personaAccept" class="primary">Accept &amp; send</button>
      </div>
    </div>
  </dialog>
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
  <dialog id="memoryDialog" aria-labelledby="memoryHeading"><form id="memoryForm" class="sheet">
    <div class="sheet-heading"><h2 id="memoryHeading">Story Memory &amp; context</h2><button class="quiet" type="button" id="closeMemoryButton" aria-label="Close memory panel">✕</button></div>
    <p class="muted">Pin established facts you want Ember to keep in every future generation. This is your own story continuity note, not an AI-generated summary. Don't add facts your character hasn't learned.</p>
    <label for="storyMemoryInput" class="setting-label">Pinned story facts (up to 4,000 characters)</label>
    <textarea id="storyMemoryInput" maxlength="4000" rows="7" placeholder="Example: The player owned an ancestral home for 400 years. Rainier's orphanage replaced it, and the house was burned without notice or compensation. Rainier has only just learned this and has not resolved it."></textarea>
    <p class="muted" id="memoryCount"></p>
    <div class="sheet-foot"><button class="quiet" type="button" id="inspectContextButton">Check context coverage</button><button class="primary" type="submit">Save Story Memory</button></div>
    <p id="contextDetails" class="muted" role="status" aria-live="polite"></p>
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
async function loadActiveCardName(snapshot=state) {
  const id=snapshot?.assetSetup?.characterId;
  if (!snapshot || !id) return;
  try {
    const asset=await getLocalAsset(liveSession?.userId ?? "local",id);
    if (state?.id!==snapshot.id || state.assetSetup?.characterId!==id) return;
    const name=asset?.kind==="character" && typeof asset.fields?.name==="string"
      ? asset.fields.name.trim() : "";
    if (activeCardName.storyId===snapshot.id && activeCardName.characterId===id
      && activeCardName.name===name) return;
    activeCardName={storyId:snapshot.id,characterId:id,name};
    render();
  } catch { /* Keep the saved V2 story-title fallback if IndexedDB is unavailable. */ }
}
async function loadActivePersonaName(snapshot=state) {
  const id=snapshot?.assetSetup?.personaId;
  if (!snapshot || !id) return;
  try {
    const card=await getLocalAsset(liveSession?.userId ?? "local",id);
    if(state?.id!==snapshot.id || state?.assetSetup?.personaId!==id) return;
    const name=card?.kind==="character" && typeof card.fields?.name==="string"
      ? card.fields.name.trim() : "";
    if(activePersonaName.storyId===snapshot.id && activePersonaName.personaId===id
      && activePersonaName.name===name) return;
    activePersonaName={storyId:snapshot.id,personaId:id,name};
    render();
  } catch { /* Keep player identity private and use a neutral heading. */ }
}
function playerPersonaName(snapshot=state) {
  const id=snapshot?.assetSetup?.personaId;
  return id && activePersonaName.storyId===snapshot?.id && activePersonaName.personaId===id
    ? (activePersonaName.name || "YOU") : "YOU";
}
function storySpeakerName(snapshot=state) {
  const id=snapshot?.assetSetup?.characterId;
  const verified=activeCardName.storyId===snapshot?.id && activeCardName.characterId===id
    ? activeCardName.name : "";
  const launchName=liveSession?.mode==="character" ? liveSession.asset?.name : "";
  return storyCharacterHeading(snapshot,verified,launchName);
}
function setStory(next) {
  persistStory(next);
  if(next.id!==state?.id || next.revision!==state?.revision){
    $("#personaSuggestion").value="";
  }
  if (next.id !== state?.id) {
    codaDiscovery = loadDiscovery(liveSession?.userId, next.id);
    latestContextCoverage = null;
  }
  state = next;
  loadError = "";
  render();
  void loadActiveCardName(next);
  void loadActivePersonaName(next);
}
function renderNarrationState() {
  const live = Boolean(liveSession);
  const last = state?.turns.at(-1);
  const canRetry = live && !narrationBusy && last?.source === "player";
  $("#sendButton").disabled = !state || narrationBusy || personaBusy || (canRetry && !$("#playerInput").value.trim());
  // The label is unchanged on desktop; phones show only the glyph, so the
  // label also becomes the button's accessible name.
  const sendLabel = narrationBusy ? "Generating…" : live ? "Send to NovelAI ➜" : "Add to story ➜";
  $("#sendButton .send-label").textContent = sendLabel;
  $("#sendButton .send-glyph").textContent = narrationBusy ? "…" : "➜";
  $("#sendButton").setAttribute("aria-label", sendLabel.replace(" ➜", ""));
  $("#passButton").disabled = true;
  $("#playerInput").disabled = !state || narrationBusy || personaBusy;
  const personaBlocker=personaTurnBlocker(state);
  $("#personaAIButton").disabled = !isGuest || !!personaBlocker || narrationBusy || personaBusy;
  $("#personaAIButton").title = !isGuest ? "Persona AI requires the native Ember guest provider; the Orbis bridge is not supported yet." : personaBlocker || "Let your V2 persona propose one editable player turn.";
  const previewCurrent = personaPreview && state && personaPreview.storyId===state.id && personaPreview.revision===state.revision && personaPreview.personaId===state.assetSetup?.personaId;
  $("#personaAccept").disabled = !previewCurrent || narrationBusy || personaBusy || !$("#personaDraft").value.trim();
  $("#personaRegenerate").disabled = narrationBusy || personaBusy || !previewCurrent;
  $("#personaDifferent").disabled = narrationBusy || personaBusy || !previewCurrent;
  $("#personaDraft").disabled = narrationBusy || personaBusy;
  $("#personaSuggestion").disabled = narrationBusy || personaBusy;
  $("#personaGenerate").disabled = !isGuest || !!personaBlocker || narrationBusy || personaBusy;
  $("#composeHint").textContent = !live
    ? "Offline preview: saves your words but cannot generate narration."
    : narrationBusy ? "NovelAI is writing the next moment…"
    : canRetry ? "Last message is saved. Retry its response, or write another message."
    : isGuest ? "NovelAI uses the key configured in Ember Account settings."
    : "NovelAI uses the key already saved in your Orbis account.";
  $("#narrationStatus").textContent = narrationBusy ? "✧ Awaiting NovelAI's reply…" : "";
  // Pre-existing local player turns from the earlier offline-only shell
  // must be continuable after upgrade, without sending another message.
  $("#narrationError").hidden = !(narrationError || canRetry);
  $("#narrationError").setAttribute("role", narrationError ? "alert" : "status");
  $("#narrationErrorText").textContent = narrationError || "Your last message is saved and waiting for a reply.";
  $("#retryNarration").textContent = narrationError ? "Retry reply" : "Generate reply";
  $("#retryNarration").disabled = !canRetry;
  // Toolbar buttons are created while generation is still busy. Explicitly
  // release them on completion without requiring a page refresh.
  root.querySelectorAll("#storyTurns button[data-reply-action]").forEach(button => {
    button.disabled = narrationBusy;
  });
  // Phones float this feedback over the story; reserve scroll room only while it shows.
  const coverage=$("#contextCoverage");
  if(!isGuest){
    coverage.textContent="Context coverage: legacy Orbis bridge (history details unavailable).";
  } else if(latestContextCoverage?.storyId===state?.id){
    const c=latestContextCoverage;
    coverage.textContent="AI context: "+c.included+"/"+c.available+" story turns, "
      +c.omitted+" older omitted · Pinned memory: "+(c.pinned?"included":"none")
      +" · approx. "+c.estimatedTokens+" input tokens";
    coverage.classList.toggle("context-warning",c.omitted>0);
  } else {
    coverage.textContent="AI context: not checked yet · Open Story Memory to inspect.";
    coverage.classList.remove("context-warning");
  }
  $(".story-column").classList.toggle("has-feedback", narrationBusy || !$("#narrationError").hidden);
}
async function compileGuestHistory(snapshot,requestedLength=generationLength,task="narration",options={},regeneration={}) {
  const bindings=await getStoryAssets(liveSession.userId,snapshot.id);
  const ids=[...new Set([...bindings.filter(b=>b.enabled!==false).map(b=>b.id),
    snapshot.assetSetup?.personaId].filter(Boolean))];
  const assets=(await Promise.all(ids.map(id=>getLocalAsset(liveSession.userId,id)))).filter(Boolean);
  return compileEmberContext({story:snapshot,assets,bindings,generationLength:requestedLength,task,
    personaOptions:options,personaRegeneration:regeneration});
}
function recordContextCoverage(compiled,storyId) {
  latestContextCoverage={
    storyId,included:compiled.historyTurnsIncluded,available:compiled.historyTurnsAvailable,
    omitted:compiled.historyTurnsOmitted,pinned:compiled.storyMemoryIncluded,
    estimatedTokens:compiled.estimatedTokens,opening:compiled.openingExcerptIncluded,
    warnings:compiled.warnings.slice(0,12),
  };
  renderNarrationState();
}
async function generateLastTurn(replaceReplyId=null) {
  if (!liveSession || narrationBusy || !state) return;
  const isReplacement=typeof replaceReplyId==="string";
  const originalReply=state.turns.at(-1);
  if (isReplacement && (originalReply?.id!==replaceReplyId || originalReply?.source!=="provider"
    || state.turns.at(-2)?.source!=="player")) return;
  const generationStory=isReplacement ? {...state,turns:state.turns.slice(0,-1)} : state;
  const last=generationStory.turns.at(-1);
  if (!last || last.source!=="player") return;
  const expectedStoryId = state.id;
  const expectedRevision = state.revision;
  const requestedLength=generationLength;
  narrationBusy = true;
  narrationError = "";
  renderNarrationState();
  try {
    const history = generationStory.turns
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
    let requestBody = { turns, characters: codaDiscovery.profiles.map(({name,role,established}) => ({name,role,established})).slice(0,12) };
    if (isGuest) {
      const compiled=await compileGuestHistory(generationStory,requestedLength);
      recordContextCoverage(compiled,generationStory.id);
      requestBody = {prompt:compiled.prompt,length:requestedLength};
    }
    const response = await fetch(isGuest ? "/ember/api/guest/generate" : "/ember/api/generate",{
      method:"POST",credentials:"same-origin",cache:"no-store",
      headers:{"Content-Type":"application/json","X-Ember-Request":"generation"},
      body:JSON.stringify(requestBody),
    });
    let result = {};
    try { result = await response.json(); } catch { /* gateway error */ }
    if (!response.ok || typeof result.text !== "string") {
      throw new Error(result.error || `Narration failed (HTTP ${response.status}).`);
    }
    if (!state || state.id !== expectedStoryId || state.revision !== expectedRevision) {
      throw new Error("Story changed during generation. Reply was not attached.");
    }
    const completed = isReplacement
      ? replaceProviderTurn(state,replaceReplyId,result.text)
      : addNarratorTurn(state,last.id,result.text);
    setStory(completed);
    if(result.shortened===true) toast("NovelAI reply stopped at the last complete sentence within your selected length.");
    void discoverAfterNarration(completed);
    $("#storyScroll").scrollTop = $("#storyScroll").scrollHeight;
  } catch (err) {
    narrationError = err instanceof Error ? err.message : "NovelAI failed. Retry the last turn.";
  } finally {
    narrationBusy = false;
    renderNarrationState();
  }
}
// Persona AI drafts and rejected approaches stay in memory until a single turn is accepted.
let personaRequestToken=0;
function personaSceneCurrent(preview) {
  return Boolean(preview && state && state.id===preview.storyId
    && state.revision===preview.revision
    && state.assetSetup?.personaId===preview.personaId);
}
function resetPersonaHistory() {
  personaHistoryScope="";
  personaRejected=[];
  personaLastFlavor="";
}
for(const [id,value] of [
  ["personaFlavor",personaOptions.flavor],["personaDecision",personaOptions.decision],
  ["personaCreativity",personaOptions.creativity],["personaDirection",personaOptions.direction],
]) $( "#" + id ).value=value;
$("#personaAvoidRepeats").checked=personaOptions.avoidRepeats;
function savePersonaOptions() {
  personaOptions=normalizePersonaOptions({
    flavor:$("#personaFlavor").value,
    decision:$("#personaDecision").value,
    creativity:$("#personaCreativity").value,
    direction:$("#personaDirection").value,
    avoidRepeats:$("#personaAvoidRepeats").checked,
  });
  setPreference("personaTurnOptions",JSON.stringify(personaOptions));
}
for(const id of ["personaFlavor","personaDecision","personaCreativity","personaDirection","personaAvoidRepeats"])
  $("#"+id).addEventListener("change",savePersonaOptions);
async function generatePersonaDraft(mode="fresh") {
  if(!isGuest || !state || personaBusy || narrationBusy)return;
  const blocker=personaTurnBlocker(state);
  if(blocker){toast(blocker);return;}
  if($("#playerInput").value.trim()){
    toast("Send or clear your own unsent draft before asking Persona AI.");
    return;
  }
  const snapshot=state;
  const reference={storyId:snapshot.id,revision:snapshot.revision,personaId:snapshot.assetSetup.personaId};
  const scope=JSON.stringify(reference);
  if(personaHistoryScope!==scope){
    resetPersonaHistory();
    personaHistoryScope=scope;
  }
  const previous=personaSceneCurrent(personaPreview)
    ? {...personaPreview,text:$("#personaDraft").value} : null;
  if(mode!=="fresh" && !previous)return;
  const suggestion=$("#personaSuggestion").value.trim().slice(0,1000);
  const options=normalizePersonaOptions(personaOptions);
  const effectiveFlavor=resolvePersonaFlavor(options.flavor,personaLastFlavor);
  const candidates=mode==="different" && options.avoidRepeats && previous
    ? rememberRejectedDrafts(personaRejected,previous.text)
    : personaRejected;
  const token=++personaRequestToken;
  personaBusy=true;
  personaPreview=null;
  $("#personaDraft").value=previous?.text||"";
  $("#personaDraftError").textContent="";
  $("#personaDraftNotice").textContent=mode==="different"
    ?"Finding a different decision…" : mode==="rewrite"
      ?"Rewriting the same decision…" : "Writing a character-driven turn…";
  if(!$("#personaDialog").open)openDialog("#personaDialog");
  renderNarrationState();
  try {
    const compiled=await compileGuestHistory(snapshot,generationLength,"persona",options,{
      effectiveFlavor,mode,suggestion,previousDraft:previous?.text||"",
      rejectedDrafts:options.avoidRepeats?candidates:[],
    });
    if(!state || state.id!==reference.storyId || state.revision!==reference.revision
      || state.assetSetup?.personaId!==reference.personaId || token!==personaRequestToken)return;
    recordContextCoverage(compiled,snapshot.id);
    const response=await fetch("/ember/api/guest/generate",{
      method:"POST",credentials:"same-origin",cache:"no-store",
      headers:{"Content-Type":"application/json","X-Ember-Request":"generation"},
      body:JSON.stringify({task:"persona",prompt:compiled.prompt,
        length:generationLength,creativity:options.creativity}),
    });
    let result={};
    try{result=await response.json();}catch{/* gateway returned non-JSON */}
    if(!response.ok || typeof result.text!=="string")
      throw new Error(result.error||"Persona AI could not generate a player turn.");
    if(token!==personaRequestToken || !state || state.id!==reference.storyId
      || state.revision!==reference.revision || state.assetSetup?.personaId!==reference.personaId)return;
    const text=cleanPersonaDraft(result.text,{personaName:playerPersonaName(snapshot)});
    personaPreview={...reference,text};
    personaRejected=candidates;
    personaLastFlavor=effectiveFlavor;
    $("#personaDraft").value=text;
    $("#personaDraftError").textContent="";
    const flavorLabel=PERSONA_FLAVORS.find(x=>x.value===effectiveFlavor)?.label||"Natural";
    $("#personaDraftNotice").textContent=(result.shortened===true
      ? "Draft stopped at a complete point. Review before accepting. "
      : "Review or edit before sending. ")+ "Flavor: "+flavorLabel+".";
  }catch(err){
    if(token===personaRequestToken && $("#personaDialog").open){
      if(previous && personaSceneCurrent(previous)){
        personaPreview=previous;
        $("#personaDraft").value=previous.text;
        $("#personaDraftNotice").textContent="Your previous draft is still available.";
      }else $("#personaDraftNotice").textContent="";
      $("#personaDraftError").textContent=err instanceof Error?err.message:"Persona AI could not write a turn.";
    }
  }finally{
    personaBusy=false;
    renderNarrationState();
  }
}
function openPersonaTurn() {
  if(!isGuest || !state || personaBusy || narrationBusy)return;
  const blocker=personaTurnBlocker(state);
  if(blocker){toast(blocker);return;}
  if($("#playerInput").value.trim()){
    toast("Send or clear your own unsent draft before asking Persona AI.");
    return;
  }
  personaPreview=null;
  $("#personaDraft").value="";
  $("#personaDraftError").textContent="";
  $("#personaDraftNotice").textContent="Choose your options, add an optional suggestion, then click Generate turn.";
  openDialog("#personaDialog");
  renderNarrationState();
}
$("#personaAIButton").addEventListener("click",openPersonaTurn);
$("#personaGenerate").addEventListener("click",()=>void generatePersonaDraft());
$("#personaRegenerate").addEventListener("click",()=>void generatePersonaDraft("rewrite"));
$("#personaDifferent").addEventListener("click",()=>void generatePersonaDraft("different"));
$("#personaDraft").addEventListener("input",renderNarrationState);
function closePersonaDraft(){
  ++personaRequestToken;
  personaPreview=null;
  resetPersonaHistory();
  if($("#personaDialog").open)$("#personaDialog").close();
  renderNarrationState();
}
$("#personaCancel").addEventListener("click",closePersonaDraft);
$("#personaClose").addEventListener("click",closePersonaDraft);
$("#personaDialog").addEventListener("close",()=>{
  ++personaRequestToken;
  personaPreview=null;
  resetPersonaHistory();
  renderNarrationState();
});
$("#personaAccept").addEventListener("click",()=>{
  if(!personaSceneCurrent(personaPreview)||narrationBusy||personaBusy){
    toast("The scene changed. Generate a fresh persona turn.");
    return;
  }
  try{
    const text=cleanPersonaDraft($("#personaDraft").value);
    const next=addPlayerTurn(state,"action",text);
    ++personaRequestToken;
    personaPreview=null;
    resetPersonaHistory();
    $("#personaDialog").close();
    narrationError="";
    setStory(next);
    $("#storyScroll").scrollTop=$("#storyScroll").scrollHeight;
    if(liveSession)void generateLastTurn();
  }catch(err){
    $("#personaDraftError").textContent=err instanceof Error?err.message:"Unable to accept the persona turn.";
  }
});

// Render only DOM text nodes. Character cards and provider prose are never trusted HTML.
function renderStoryProse(container,text,narratorName="") {
  for (const paragraph of segmentStoryText(text,{narratorName})) {
    const line=document.createElement("p");
    line.className="story-paragraph";
    if (paragraph.speaker) {
      const speaker=document.createElement("strong");
      speaker.className="story-speaker";
      speaker.textContent=paragraph.speaker+": ";
      line.append(speaker);
    }
    for (const part of paragraph.parts) {
      if (part.kind==="narration") {
        line.append(document.createTextNode(part.text));
      } else {
        const span=document.createElement("span");
        span.className=part.kind==="dialogue"?"story-dialogue":"story-action";
        span.textContent=part.text;
        line.append(span);
      }
    }
    container.append(line);
  }
}
function render() {
  const disabled = !state;
  $("#waitButton").disabled = disabled || narrationBusy || personaBusy;
  $("#worldName").textContent = state?.world.name ?? "Unreadable save";
  $("#locationName").textContent = state?.world.location ?? "Local story could not be restored";
  $("#clock").textContent = state ? formatClock(state.world) : "Time unavailable";
  $("#storyTitle").textContent = state?.title ?? "Recovery required";
  $("#saveStatus").textContent = disabled ? "● Recovery needed" : "● Saved locally";
  $("#phoneSaveStatus").textContent = $("#saveStatus").textContent;
  $("#phoneClock").textContent = liveSession?.mode === "character" ? "" : $("#clock").textContent;
  $("#previewNotice").innerHTML = disabled
    ? `<strong>Save recovery needed.</strong> ${safe(loadError)} Use "Open saved file" to restore a backup, or "New story" after preserving the damaged browser data if needed.`
    : isGuest
      ? '<strong>Ember guest account.</strong> Your V2 cards and lorebooks stay private in this browser. <a href="/ember/account">Configure NovelAI in Account settings</a> to generate without Orbis.'
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
    label.textContent = turn.mode === "narrator" ? (turn.source === "provider"
      ? storySpeakerName() : "PREVIEW OPENING") : playerPersonaName();
    const prose = document.createElement("div");
    prose.className = "turn-prose";
    renderStoryProse(prose,turn.source === "provider" ? cleanNarration(turn.text) : turn.text,
      turn.source==="provider" ? storySpeakerName() : "");
    el.append(label, prose);
    if (turn.source==="provider") {
      const agency=detectPlayerAgency(turn.text,{personaName:playerPersonaName()});
      if(agency.suspected){
        const warning=document.createElement("p");
        warning.className="agency-warning";
        warning.setAttribute("role","note");
        warning.textContent="⚠ Possible player-control leak. Review or edit this reply; you can regenerate the latest reply.";
        warning.title=agency.reason;
        el.append(warning);
      }
    }
    if (turn.source === "provider" || turn.source === "player") {
      const isProvider=turn.source==="provider";
      const latest=isProvider && state.turns.at(-1)?.id===turn.id
        && state.turns.at(-2)?.source==="player";
      const tools=document.createElement("div");
      tools.className="reply-tools";
      tools.setAttribute("role","group");
      tools.setAttribute("aria-label",isProvider ? "Generated reply controls" : "Your message controls");
      for (const [action,glyph,title] of [
        ["copy","📋","Copy reply"],["edit","✎","Edit reply"],
        ["delete","✕","Delete turn and all later turns"],["regenerate","↻","Regenerate latest reply"],
      ]) {
        if (action==="regenerate" && !latest) continue;
        const button=document.createElement("button");
        button.type="button";
        button.className="reply-tool";
        button.dataset.replyAction=action;
        button.dataset.replyId=turn.id;
        const accessibleTitle=action==="delete" ? (isProvider ? "Delete reply and everything after it" : "Delete your message and everything after it")
          : isProvider ? title : (action==="copy" ? "Copy your message" : "Edit your message");
        button.title=accessibleTitle;
        button.setAttribute("aria-label",accessibleTitle);
        button.textContent=glyph;
        button.disabled=narrationBusy;
        tools.append(button);
      }
      el.append(tools);
    }
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
  if (isGuest || liveSession?.mode !== "sandbox" || codaDiscoveryBusy || !shouldDiscover(snapshot.turns, codaDiscovery)) return;
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
  if (!state || narrationBusy || personaBusy) return;
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
if(isGuest) {
  $("#replyLengthSelect").value=generationLength;
  $("#replyLengthSelect").addEventListener("change",event=>{
    generationLength=replyLengthOrDefault(event.target.value);
    setPreference("replyLength",generationLength);
    toast("NovelAI reply length: "+REPLY_LENGTHS[generationLength].label
      +" (up to "+REPLY_LENGTHS[generationLength].maxWords+" words).");
  });
}
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
function showManualStoryCopy(transcript) {
  // Read-only modal fallback when clipboard permissions block automatic copy.
  const dialog=document.createElement("dialog");
  dialog.className="story-copy-dialog";
  const wrap=document.createElement("div");
  const heading=document.createElement("h2");
  heading.textContent="Copy sanitized story";
  const note=document.createElement("p");
  note.textContent="Your browser blocked automatic copying. Select the text and press Ctrl+C (or Cmd+C). Review fictional names and content before sharing.";
  const input=document.createElement("textarea");
  input.setAttribute("aria-label","Sanitized story transcript");
  input.readOnly=true;
  input.value=transcript;
  input.spellcheck=false;
  const close=document.createElement("button");
  close.type="button";close.textContent="Close";
  close.addEventListener("click",()=>dialog.close());
  wrap.append(heading,note,input,close);
  dialog.append(wrap);
  root.append(dialog);
  dialog.addEventListener("close",()=>dialog.remove(),{once:true});
  dialog.showModal();
  input.focus();
  input.select();
}
async function copySanitizedStory() {
  $(".overflow").open=false;
  if (!state) {toast("No readable story is available to copy.");return;}
  try {
    const current=state;
    let characterName=storySpeakerName(current);
    const characterId=current.assetSetup?.characterId;
    if(characterId){
      try {
        const character=await getLocalAsset(liveSession?.userId??"local",characterId);
        if(character?.kind==="character" && character.fields?.name)characterName=character.fields.name;
      } catch { /* Allow transcript copy even if the local V2 library is unavailable. */ }
    }
    let personaName=playerPersonaName(current);
    const personaId=current.assetSetup?.personaId;
    if(personaId){
      try {
        const persona=await getLocalAsset(liveSession?.userId??"local",personaId);
        if(persona?.kind==="character" && persona.fields?.name)personaName=persona.fields.name;
      } catch { /* Keep a neutral player label if IndexedDB is unavailable. */ }
    }
    const transcript=exportSanitizedStory(current,{characterName,personaName});
    if(navigator.clipboard?.writeText){
      try {
        await navigator.clipboard.writeText(transcript);
        toast("Sanitized story copied. Fictional names and narrative details remain.");
        return;
      } catch { /* Permission denied: provide a selectable fallback. */ }
    }
    showManualStoryCopy(transcript);
  } catch(error) {
    toast(error instanceof Error ? error.message : "Unable to copy the story.");
  }
}
function openStoryMemory() {
  $(".overflow").open=false;
  if(!state){toast("Restore or open a readable story before editing memory.");return;}
  $("#storyMemoryInput").value=state.storyMemory||"";
  $("#memoryCount").textContent=$("#storyMemoryInput").value.length+" / 4,000 characters";
  $("#contextDetails").textContent=isGuest
    ? "Choose Check context coverage to see what NovelAI would receive. This does not use provider credits."
    : "The legacy Orbis generation bridge does not use Ember Story Memory. Use the independent guest provider path for native memory.";
  $("#memoryDialog").showModal();
}
$("#memoryButton").addEventListener("click",openStoryMemory);
$("#memoryMenuButton").addEventListener("click",openStoryMemory);
$("#closeMemoryButton").addEventListener("click",()=>$("#memoryDialog").close());
$("#storyMemoryInput").addEventListener("input",()=>{
  $("#memoryCount").textContent=$("#storyMemoryInput").value.length+" / 4,000 characters";
});
$("#memoryForm").addEventListener("submit",event=>{
  event.preventDefault();
  if(narrationBusy){$("#contextDetails").textContent="Wait until NovelAI finishes generating before editing memory.";return;}
  if(!state){$("#contextDetails").textContent="Story unavailable.";return;}
  try {
    setStory(setStoryMemory(state,$("#storyMemoryInput").value));
    $("#memoryDialog").close();
    toast("Story Memory saved locally and included in future Ember guest generations.");
  }catch(error){$("#contextDetails").textContent=error.message;}
});
$("#inspectContextButton").addEventListener("click",async()=>{
  if(!isGuest){$("#contextDetails").textContent="Legacy Orbis generation does not expose context coverage. Use Ember guest generation.";return;}
  if(!state){$("#contextDetails").textContent="No story loaded.";return;}
  const snapshot=state;
  const recent=snapshot.turns.at(-1)?.source==="provider"
    ? {...snapshot,turns:snapshot.turns.slice(0,-1)} : snapshot;
  if(recent.turns.at(-1)?.source!=="player"){
    $("#contextDetails").textContent="Write a player message first. Then Ember can calculate the actual generation context without contacting NovelAI.";
    return;
  }
  $("#inspectContextButton").disabled=true;
  try{
    const compiled=await compileGuestHistory(recent);
    if(!state || state.id!==snapshot.id || state.revision!==snapshot.revision)
      throw new Error("The story changed while checking context. Try again.");
    recordContextCoverage(compiled,snapshot.id);
    $("#contextDetails").textContent="Would send "+compiled.historyTurnsIncluded+" of "
      +compiled.historyTurnsAvailable+" turns. Older omitted: "+compiled.historyTurnsOmitted
      +". Earliest included turn: #"+(compiled.oldestIncludedTurnIndex+1)
      +". Opening excerpt: "+(compiled.openingExcerptIncluded?"yes":"not needed")
      +". Pinned continuity: "+(compiled.storyMemoryIncluded?"included":"none")
      +". Approximate input tokens: "+compiled.estimatedTokens+". "
      +(compiled.warnings.length?compiled.warnings.join(" "):"All eligible turns currently fit.");
  }catch(error){$("#contextDetails").textContent=error.message;}
  finally{$("#inspectContextButton").disabled=false;}
});
$("#copySanitizedButton").addEventListener("click",()=>void copySanitizedStory());
$("#copySanitizedMenuButton").addEventListener("click",()=>void copySanitizedStory());
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
  if (narrationBusy || personaBusy) { toast("Wait for AI generation to finish before starting another story."); return; }
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
const menuTargets = { library: "#libraryMenuButton", persona:"#personaMenuButton", memory:"#memoryMenuButton", copySanitized:"#copySanitizedMenuButton", account: "#accountMenuButton", style: "#prefsMenuButton", theme: "#themeButton", export: "#exportButton", import: "#importButton", new: "#newButton" };
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
const assetLibrary = mountAssetLibrary({
  root, owner: () => liveSession?.userId ?? "local", getStory: () => state,
  onSelectPersona: async asset => {
    if (narrationBusy || personaBusy) throw new Error("Wait until generation finishes before switching personas.");
    if (!state) throw new Error("Open a story before choosing a persona.");
    if (asset && asset.kind!=="character") throw new Error("Personas must be Character Card V2 files.");
    if (asset && state.assetSetup?.characterId===asset.id)
      throw new Error("You cannot play as the NPC character in the same story.");
    const next=setStoryPersona(state,asset?.id??null);
    setStory(next);
    toast(asset ? "Playing as "+asset.fields.name+" (V2 persona)." : "Player persona cleared.");
    return true;
  },
  onStartCharacter: async (asset, openingIndex) => {
    if (narrationBusy || personaBusy) { toast("Wait for AI generation to finish before changing stories."); return false; }
    if (!window.confirm("Start a new story with this character? Export your current story first if you want to keep it.")) return false;
    const fresh = liveSession ? createStoryFromLaunch(liveSession) : createStory();
    const message = [asset.fields.firstMessage, ...asset.fields.alternateGreetings][openingIndex] || "";
    const greeting = message.replaceAll("{{char}}", asset.fields.name).replaceAll("{{user}}", "you");
    fresh.title = "Story with " + asset.fields.name;
    fresh.assetSetup = { characterId: asset.id, openingIndex, scenario: asset.fields.scenario,
      ...(state?.assetSetup?.personaId && state.assetSetup.personaId!==asset.id
        ? {personaId:state.assetSetup.personaId} : {}) };
    if (greeting) fresh.turns = [{ id: crypto.randomUUID(), source: "preview", mode: "narrator", text: greeting }];
    if (isGuest) await setStoryAssets(liveSession.userId,fresh.id,[{id:asset.id,enabled:true,greeting:openingIndex}]);
    narrationError = "";
    setStory(fresh);
    toast(isGuest ? "Character opened with native V2 context ready for generation." : "New story opened with the selected greeting. AI character context integration is pending.");
    return true;
  },
});
$("#storyTurns").addEventListener("click",event=>{
  const button=event.target.closest("button[data-reply-action]");
  if (!button || narrationBusy || personaBusy || !state) return;
  const turn=state.turns.find(item=>item.id===button.dataset.replyId
    && (item.source==="provider" || item.source==="player"));
  if (!turn) return;
  const action=button.dataset.replyAction;
  if (action==="copy") {
    void navigator.clipboard.writeText(turn.text)
      .then(()=>toast(turn.source==="player" ? "Your message copied." : "Reply copied to clipboard."))
      .catch(()=>toast("Copy unavailable. Your browser may block clipboard access."));
  } else if (action==="edit") {
    const article=button.closest(".turn");
    if (article.querySelector(".reply-editor")) return;
    const editor=document.createElement("div");
    editor.className="reply-editor";
    const field=document.createElement("textarea");
    field.setAttribute("aria-label",turn.source==="player" ? "Edit your sent message" : "Edit generated reply");
    field.value=turn.text;
    field.maxLength=turn.source==="player" ? MAX_INPUT : 32000;
    field.rows=8;
    const actions=document.createElement("div");
    actions.className="reply-editor-actions";
    const save=document.createElement("button");
    save.type="button";save.textContent=turn.source==="player" ? "Save message" : "Save reply";save.className="reply-save";
    const cancel=document.createElement("button");
    cancel.type="button";cancel.textContent="Cancel";
    cancel.addEventListener("click",()=>editor.remove());
    const expectedRevision=state.revision;
    save.addEventListener("click",()=>{
      if (narrationBusy || state.revision!==expectedRevision
        || !state.turns.some(item=>item.id===turn.id && item.source===turn.source)) {
        toast("Story changed while editing. Reopen the editor.");return;
      }
      try {
        const currentIndex=state.turns.findIndex(item=>item.id===turn.id);
        if(turn.source==="player" && currentIndex>=0 && currentIndex<state.turns.length-1
          && field.value.trim()!==turn.text.trim()
          && !window.confirm("This message has later story replies. Editing it will not rewrite or remove them. Keep the later story unchanged?")) return;
        const next=turn.source==="player"
          ? replacePlayerTurn(state,turn.id,field.value)
          : replaceProviderTurn(state,turn.id,field.value);
        setStory(next);
        toast(turn.source==="player" ? "Your message edited and saved locally." : "Reply edited and saved locally.");
      } catch(error){toast(error.message);}
    });
    actions.append(save,cancel);editor.append(field,actions);
    article.append(editor);field.focus();
  } else if (action==="delete") {
    const index=state.turns.findIndex(item=>item.id===turn.id && item.source===turn.source);
    if(index<0)return;
    const removedCount=state.turns.length-index;
    const isPlayer=turn.source==="player";
    const what=isPlayer ? "your message" : "this AI reply";
    const message="Rewind the story by deleting "+what+"? "
      +removedCount+" turn"+(removedCount===1?"":"s")+" will be permanently removed, including "
      +Math.max(0,removedCount-1)+" newer messages and replies. "
      +(isPlayer
        ? "Earlier story content will be kept. You can write a new message from that point."
        : "The player message that prompted this reply will be kept. You can generate another response.")
      +(state.storyMemory?.trim()
        ? " Pinned Story Memory is not automatically changed; review it if it refers to deleted events." : "")
      +" Continue?";
    if(!window.confirm(message))return;
    try {
      setStory(isPlayer ? removePlayerTurn(state,turn.id) : removeProviderTurn(state,turn.id));
      toast("Story rewound by "+removedCount+" turn"+(removedCount===1?"":"s")+". Earlier history remains.");
    }catch(error){toast(error.message);}
  } else if (action==="regenerate") {
    if (!window.confirm("Regenerate this reply? The existing version will stay until a replacement succeeds.")) return;
    void generateLastTurn(turn.id);
  }
});
$("#libraryButton").addEventListener("click", () => void assetLibrary.open("character"));
$("#personaButton").addEventListener("click", () => void assetLibrary.open("persona"));
$("#personaMenuButton").addEventListener("click", () => { $(".overflow").open = false; void assetLibrary.open("persona"); });
$("#libraryMenuButton").addEventListener("click", () => { $(".overflow").open = false; void assetLibrary.open(); });
if (isGuest) $("#accountMenuButton").addEventListener("click",()=>{window.location.href="/ember/account";});
updateTheme();
updateSoundSettings();
render();
void loadActiveCardName();
void loadActivePersonaName();
if (new URLSearchParams(window.location.search).get("library")==="persona") {
  void assetLibrary.open("persona");
}
if (loadError) toast(loadError);
// An Ember tab must stop showing private material when its Orbis session ends.
if (liveSession) {
  const verifyActiveSession = async () => {
    try {
      const response = await fetch(isGuest ? '/ember/api/guest/session' : '/ember/api/session', { credentials: 'same-origin', cache: 'no-store' });
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
