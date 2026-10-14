// Ember Library editor form. The original asset is never overwritten.
const html = value => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;")
  .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const field = (label,name,value,rows=4) =>
  '<label class="asset-edit-field"><span>'+html(label)+'</span><textarea name="'+name+'" rows="'+rows+'">'+html(value)+'</textarea></label>';
const input = (label,name,value,type="text") =>
  '<label class="asset-edit-field"><span>'+html(label)+'</span><input type="'+type+'" name="'+name+'" value="'+html(value)+'"></label>';
const checked = (name,label,on) => '<label class="asset-edit-check"><input type="checkbox" name="'+name+'" '+(on?'checked':'')+'> '+html(label)+'</label>';
export function greetingEditor(value="") {
  return '<div data-greeting-item class="asset-greeting-row">'+field("Alternate greeting","alternate",value,5)
    +'<button type="button" class="asset-secondary" data-action="remove-greeting">Remove greeting</button></div>';
}
export function renderAssetEditor(asset) {
  const a=asset.fields;
  let content;
  if (asset.kind==="character") {
    content=field("Description","description",a.description,7)
      +field("Personality","personality",a.personality,5)
      +field("Scenario","scenario",a.scenario,5)
      +field("Primary greeting","firstMessage",a.firstMessage,7)
      +'<fieldset class="asset-edit-group"><legend>Alternate greetings</legend><div id="assetGreetingEdits">'
      +a.alternateGreetings.map(greetingEditor).join("")
      +'</div><button type="button" class="asset-secondary" data-action="add-greeting">+ Add greeting</button></fieldset>'
      +field("Example dialogue","exampleMessages",a.exampleMessages,6)
      +'<p class="asset-muted">Other V2 fields, embedded character books, and unknown extensions are preserved. For PNG imports, the edited copy is exported as V2 JSON; the original PNG remains unchanged.</p>';
  } else {
    content=field("Description","description",a.description,4)
      +'<div class="asset-edit-grid">'+input("Scan depth","scanDepth",a.scanDepth,"number")
      +input("Token budget","tokenBudget",a.tokenBudget,"number")+'</div>'
      +checked("recursiveScanning","Recursive scanning",a.recursiveScanning)
      +'<fieldset class="asset-edit-group"><legend>Lorebook entries ('+a.entries.length+')</legend>'
      +a.entries.map((entry,i)=>'<details class="asset-edit-entry" data-lore-entry="'+i+'"><summary>'
        +html(entry.name||"Entry "+(i+1))+'</summary>'
        +input("Entry name","entry-name-"+i,entry.name)
        +field("Primary keywords (one per line)","entry-keys-"+i,entry.keys.join("\n"),3)
        +field("Secondary keywords (one per line)","entry-secondary-"+i,entry.secondaryKeys.join("\n"),3)
        +field("Lore content","entry-content-"+i,entry.content,8)
        +'<div class="asset-edit-grid">'+checked("entry-enabled-"+i,"Enabled",entry.enabled)
        +checked("entry-constant-"+i,"Always active",entry.constant)
        +checked("entry-selective-"+i,"Require secondary condition",entry.selective)+'</div>'
        +'</details>').join("")+'</fieldset>'
      +'<p class="asset-muted">Entry IDs, priorities, advanced activation settings, and unknown extensions stay intact. Unsupported controls are not silently rewritten.</p>';
  }
  return '<form id="assetEditor" class="asset-editor">'
    +'<h3>Edit '+(asset.kind==="character"?"character":"lorebook")+'</h3>'
    +'<p class="asset-muted">Save as new local copy. Your imported original stays available.</p>'
    +input("Name","name",asset.kind==="character"?a.name:a.name)
    +content
    +'<div class="asset-edit-actions"><button type="submit" class="asset-primary">Save as new copy</button>'
    +'<button type="button" class="asset-secondary" data-action="cancel-edit">Cancel</button></div></form>';
}
function get(form,name) {
  const field=form.elements.namedItem(name);
  if(!field || typeof field.value!=="string") throw new Error("Missing editor field: "+name);
  return field.value;
}
function on(form,name){return form.elements.namedItem(name)?.checked === true;}
export function readAssetEditor(form,asset) {
  const name=get(form,"name");
  if(asset.kind==="character")return {
    name, description:get(form,"description"),personality:get(form,"personality"),
    scenario:get(form,"scenario"),firstMessage:get(form,"firstMessage"),
    alternateGreetings:[...form.querySelectorAll("[data-greeting-item] textarea")].map(e=>e.value),
    exampleMessages:get(form,"exampleMessages"),
  };
  return {
    name, description:get(form,"description"),scanDepth:get(form,"scanDepth"),
    tokenBudget:get(form,"tokenBudget"),recursiveScanning:on(form,"recursiveScanning"),
    entries:asset.fields.entries.map((_,i)=>({
      name:get(form,"entry-name-"+i),content:get(form,"entry-content-"+i),
      keys:get(form,"entry-keys-"+i),secondaryKeys:get(form,"entry-secondary-"+i),
      enabled:on(form,"entry-enabled-"+i),constant:on(form,"entry-constant-"+i),selective:on(form,"entry-selective-"+i),
    })),
  };
}
