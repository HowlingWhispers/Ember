import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
const app = readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
function rule(selector) {
  const start=css.indexOf(selector+' {');
  assert.ok(start>=0,`Expected CSS rule: ${selector}`);
  const content=css.slice(start+selector.length+2);
  const end=content.indexOf('}');
  assert.ok(end>0);
  return content.slice(0,end);
}
test('the reader scrolls independently instead of pushing the writing desk offscreen',()=>{
  assert.match(rule('.ember-shell'),/height:\s*100dvh/);
  assert.match(rule('.ember-shell'),/overflow:\s*hidden/);
  assert.match(rule('.layout'),/min-height:\s*0/);
  assert.match(rule('.layout'),/overflow:\s*hidden/);
  assert.match(rule('.story-column'),/min-height:\s*0/);
  assert.match(rule('.story-column'),/overflow:\s*hidden/);
  assert.match(rule('.story-scroll'),/min-height:\s*0/);
  assert.match(rule('.story-scroll'),/overflow-y:\s*auto/);
  assert.match(rule('.writing-desk'),/flex:\s*0 0 auto/);
});
test('status feedback has stable reserved height across generation and errors',()=>{
  assert.match(rule('.narration-feedback'),/height:\s*40px/);
  assert.match(rule('.narration-feedback'),/flex:\s*0 0 40px/);
  assert.match(app,/class="narration-feedback"/);
  assert.match(app,/function renderNarrationState\(/);
});
test('Coda is half-hidden at the outer edge, not floating over the writing desk',()=>{
  const dock=rule('.coda-dock');
  assert.match(dock,/position:\s*fixed/);
  assert.match(dock,/right:\s*0/);
  assert.match(dock,/width:\s*48px/);
  assert.match(dock,/transform:\s*translateX\(50%\)/);
  assert.match(rule('.coda-bubble'),/position:\s*absolute/);
  assert.match(app,/setCodaOpen\(false\)/);
  assert.match(css,/body:has\(\.writing-desk:focus-within\) \.coda-dock:not\(\.is-open\)/);
});

const phoneBlock = (() => {
  const start = css.indexOf('@media (max-width: 600px), (pointer: coarse) and (max-height: 500px)');
  assert.ok(start >= 0, 'Expected the phone layout media query');
  return css.slice(start);
})();

test('phone layout query is shared between the stylesheet and the app',()=>{
  assert.match(app,/const PHONE_QUERY = "\(max-width: 600px\), \(pointer: coarse\) and \(max-height: 500px\)"/);
});
test('phones drop the header and the desk heading, keeping every control in the dock',()=>{
  assert.match(phoneBlock,/\.topbar \{ display: none; \}/);
  assert.match(phoneBlock,/\.desk-heading \{ display: none; \}/);
  assert.match(app,/id="menuButton"[^>]*aria-controls="worldRail"/);
  assert.match(app,/class="phone-menu phone-only"/);
  for (const action of ['style','theme','export','import','new']) assert.match(app,new RegExp(`data-menu-action="${action}"`));
});
test('phones put the field and send button on one row, with touch-sized controls',()=>{
  assert.match(phoneBlock,/\.composer-footer \{ display: contents; \}/);
  assert.match(phoneBlock,/#sendButton \{[^}]*width: 40px; height: 40px;/);
  assert.match(phoneBlock,/\.desk-tools \.chip-button \{ min-height: 40px;/);
  assert.match(phoneBlock,/font-size: 16px/);
  assert.match(app,/setAttribute\("aria-label", sendLabel/);
});
test('phones show the character count only near the limit',()=>{
  assert.match(phoneBlock,/\.input-count \{ display: none;/);
  assert.match(phoneBlock,/\.input-count\.near-limit \{ display: block;/);
  assert.match(app,/classList\.toggle\("near-limit", length >= NEAR_LIMIT\)/);
});
test('phone status feedback floats over the story instead of reserving a row',()=>{
  assert.match(phoneBlock,/\.narration-feedback \{ position: absolute;[^}]*bottom: 100%;/);
  assert.match(phoneBlock,/\.story-column\.has-feedback \.story-inner \{ padding-bottom: 84px; \}/);
  assert.match(app,/classList\.toggle\("has-feedback"/);
});
test('phone Coda tab stays inside the story padding with an invisible tap extension',()=>{
  assert.match(phoneBlock,/\.story-inner, :root\[data-density="comfortable"\] \.story-inner \{ padding: 14px 24px/);
  assert.match(phoneBlock,/\.coda-dock \{ top: 38%; transform: translateX\(72%\); \}/);
  assert.match(phoneBlock,/\.coda-orb::before \{ content: "";/);
});
test('character roleplay keeps a phone drawer for the story menu',()=>{
  assert.match(phoneBlock,/:root\[data-ember-mode="character"\] \.world-rail \{ display: flex !important; \}/);
  assert.match(phoneBlock,/:root\[data-ember-mode="character"\] #closeRail \{ display: inline-block !important; \}/);
});
test('desktop markup and controls are unchanged outside the phone layout',()=>{
  assert.match(css,/\n\.phone-only, \.short-label, \.send-glyph \{ display: none; \}/);
  assert.ok(css.indexOf('.phone-only, .short-label') < css.indexOf('@media (max-width: 600px), (pointer: coarse)'));
  assert.match(app,/<span class="long-label">Pass the turn<\/span>/);
  assert.match(app,/data-format="action"/);
  assert.match(app,/data-format="speech"/);
  assert.match(app,/data-format="thought"/);
  assert.match(phoneBlock,/\.mode-switch \{ display: flex; grid-column: 1 \/ -1;/);
  assert.doesNotMatch(app,/id="modeCycle"/);
});


test("provider turn heading is a V2 character name, not hardcoded STORY",()=>{
  assert.match(app,/storySpeakerName\(\)/);
  assert.match(app,/turn\.source === "provider"[\s\S]{0,120}\? storySpeakerName\(\)/);
  assert.doesNotMatch(app,/\?\s*"STORY"\s*:\s*"PREVIEW OPENING"/);
  assert.match(app,/loadActiveCardName/);
});
test("generated replies expose accessible copy, edit, delete and regenerate controls",()=>{
  for(const action of ["copy","edit","delete","regenerate"]){
    assert.match(app,new RegExp('\\["'+action+'","'));
    assert.match(app,new RegExp('action==="'+action+'"'));
  }
  assert.match(app,/button\.setAttribute\("aria-label",accessibleTitle\)/);
  assert.match(app,/className="reply-tools"/);
  assert.match(app,/regenerate this reply/i);
  assert.match(css,/\.reply-tools \{/);
  assert.match(css,/\.reply-tool \{[^}]*min-width: 38px/);
});
test("reroll preserves original reply until generation succeeds and requires latest player response",()=>{
  assert.match(app,/const generationStory=isReplacement \? \{\.\.\.state,turns:state\.turns\.slice\(0,-1\)\} : state/);
  assert.match(app,/state\.revision !== expectedRevision/);
  assert.match(app,/replaceProviderTurn\(state,replaceReplyId,result\.text\)/);
  assert.match(app,/removeProviderTurn\(state,turn\.id\)/);
  assert.match(app,/state\.turns\.at\(-2\)\?\.source!=="player"/);
});


test("Account & NovelAI header link uses readable Ember colors in every link state",()=>{
  assert.match(app,/id="accountButton" href="\/ember\/account"/);
  assert.match(css,/\.top-actions #accountButton:link,\s*\.top-actions #accountButton:visited\s*\{[^}]*color:\s*var\(--text\)/);
  assert.match(css,/\.top-actions #accountButton:link,\s*\.top-actions #accountButton:visited\s*\{[^}]*text-decoration:\s*none/);
  assert.match(css,/\.top-actions #accountButton:hover\s*\{[^}]*color:\s*var\(--gold\)/);
  assert.match(css,/\.top-actions #accountButton:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--gold\)/);
  assert.match(css,/:root\[data-theme="daylight"\]\s*\{/);
});


test("player turns provide Copy, Edit and Delete, but only AI turns offer Regenerate",()=>{
  assert.match(app,/if \(turn\.source === "provider" \|\| turn\.source === "player"\)/);
  assert.match(app,/isProvider=turn\.source==="provider"/);
  assert.match(app,/\["delete","✕","Delete turn and all later turns"\]/);
  assert.match(app,/if \(action==="regenerate" && !latest\) continue/);
  assert.doesNotMatch(app,/if \(action==="delete" && !isProvider\) continue/);
  assert.match(app,/item\.source==="provider" \|\| item\.source==="player"/);
  assert.match(app,/replacePlayerTurn\(state,turn\.id,field\.value\)/);
  assert.match(app,/removePlayerTurn\(state,turn\.id\)/);
  assert.match(app,/field\.maxLength=turn\.source==="player" \? MAX_INPUT : 32000/);
  assert.match(app,/title=accessibleTitle/);
});
test("generation cleanup restores toolbar interactivity without refreshing the browser",()=>{
  assert.match(app,/root\.querySelectorAll\("#storyTurns button\[data-reply-action\]"\)\.forEach\(button => \{\s*button\.disabled = narrationBusy;\s*\}\)/);
  assert.match(app,/finally \{\s*narrationBusy = false;\s*renderNarrationState\(\)/);
  assert.match(app,/narrationBusy = true;\s*narrationError = "";\s*renderNarrationState\(\)/);
  assert.match(app,/button\.disabled=narrationBusy/);
});
test("historical sent-message edits warn when future narration exists",()=>{
  assert.match(app,/turn\.source==="player" && currentIndex>=0 && currentIndex<state\.turns\.length-1/);
  assert.match(app,/Editing it will not rewrite or remove them/);
  assert.match(app,/state\.revision!==expectedRevision/);
});


test("sanitized full-story copy has a visible reader button and desktop plus phone menu actions",()=>{
  assert.match(app,/id="copySanitizedButton"[^>]*class="story-share-button"/);
  assert.match(app,/id="copySanitizedMenuButton"/);
  assert.match(app,/data-menu-action="copySanitized"/);
  assert.match(app,/copySanitized:"#copySanitizedMenuButton"/);
  assert.match(app,/exportSanitizedStory\(current,\{characterName,personaName\}\)/);
  assert.match(css,/\.story-share-button \{[^}]*color: var\(--text\)/);
  assert.match(css,/\.story-share-button:hover, \.story-share-button:focus-visible \{[^}]*color: var\(--gold\)/);
});
test("story copy uses async clipboard with a manual read-only selection fallback",()=>{
  assert.match(app,/navigator\.clipboard\?\.writeText/);
  assert.match(app,/showManualStoryCopy\(transcript\)/);
  assert.match(app,/input\.readOnly=true/);
  assert.match(app,/input\.select\(\)/);
  assert.match(app,/Review fictional names and content before sharing/);
});


test("deleting an AI reply or player message rewinds all newer turns with an accurate warning",()=>{
  assert.match(app,/\["delete","✕","Delete turn and all later turns"\]/);
  assert.match(app,/if \(action==="regenerate" && !latest\) continue/);
  assert.match(app,/const removedCount=state\.turns\.length-index/);
  assert.match(app,/Rewind the story by deleting /);
  assert.match(app,/turn"\+\(removedCount===1\?"":"s"\)/);
  assert.match(app,/newer messages and replies/);
  assert.match(app,/Earlier story content will be kept/);
  assert.match(app,/removePlayerTurn\(state,turn\.id\) : removeProviderTurn\(state,turn\.id\)/);
  assert.match(app,/Pinned Story Memory is not automatically changed/);
  assert.match(app,/if\(!window\.confirm\(message\)\)return/);
});
