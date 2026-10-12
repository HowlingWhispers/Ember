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
