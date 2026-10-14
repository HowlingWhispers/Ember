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
  assert.match(app,/data-mode="action" class="selected"/);
});
