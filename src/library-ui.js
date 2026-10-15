import { importEmberAsset, IMPORT_LIMITS } from "./asset-import.js";
import { listLocalAssets, importLocalAsset, renameLocalAsset, deleteLocalAsset,
  downloadLocalAsset, getStoryAssets, setStoryAssets } from "./asset-store.js";
import { activateLorebooks } from "./lore-engine.js";
import {applyLoreOverrides,isLoreMode,normalizeEntryOverrides} from "./lore-overrides.js";
import { exportLocalLibrary, parseLocalLibraryBackup } from "./asset-backup.js";
import { buildEditedAsset } from "./asset-edit.js";
import { renderAssetEditor, readAssetEditor, greetingEditor } from "./asset-editor-ui.js";

const escapeHtml = value => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;")
  .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const short = (value,n=180) => escapeHtml(String(value || "").slice(0,n));
export function mountAssetLibrary({root,owner,getStory,onStartCharacter,onSelectPersona}) {
  const shell = document.createElement("dialog");
  shell.className = "asset-library";
  shell.setAttribute("aria-labelledby","assetLibraryTitle");
  shell.innerHTML = '<div class="asset-frame"><header class="asset-header"><div><p class="asset-eyebrow">EMBER · LOCAL STORAGE</p><h2 id="assetLibraryTitle">My Library</h2><p>Character cards and lorebooks stored in this browser, never uploaded to Orbis.</p></div><button type="button" data-action="close" aria-label="Close library">✕</button></header><div class="asset-tools"><div class="asset-tabs" role="group" aria-label="Asset type"><button type="button" data-tab="character">Characters</button><button type="button" data-tab="persona">My Persona</button><button type="button" data-tab="lorebook">Lorebooks</button></div><label class="asset-search"><span class="visually-hidden">Search local assets</span><input id="assetSearch" type="search" placeholder="Search this library"></label><button class="asset-primary" type="button" data-action="import">＋ Import file</button><input id="assetImportFile" type="file" accept=".json,.png,application/json,image/png" hidden><button type="button" data-action="backup">Backup library</button><button type="button" data-action="restore">Restore backup</button><input id="assetBackupFile" type="file" accept=".json,application/json" hidden></div><p class="asset-notice" id="assetLibraryStatus" role="status" aria-live="polite"></p><div class="asset-body"><div class="asset-list" id="assetItems"></div><section id="assetDetail" class="asset-detail" aria-label="Selected asset"></section></div><footer class="asset-footer">Your assets stay in this browser profile. Export backups before clearing browser data. Importing does not automatically change a story.</footer></div>';
  root.append(shell);
  const $ = sel => shell.querySelector(sel);
  let assets = [], attached = [], type = "character", selectedId = null, search = "", editingAssetId = null;
  let managingModes = false, modeView = "modes", modeSearch = "";
  const current = () => assets.find(a => a.id === selectedId);
  const binding = id => attached.find(a => a.id === id);
  const status = value => { $("#assetLibraryStatus").textContent = value; };
  async function refresh(message = "") {
    assets = await listLocalAssets(owner());
    attached = getStory()?.id ? await getStoryAssets(owner(),getStory().id) : [];
    if (selectedId && !current()) { selectedId = null; editingAssetId = null; managingModes = false; }
    render();
    status(message);
  }
  function render() {
    shell.querySelectorAll("[data-tab]").forEach(button=> {
      const active = button.dataset.tab === type;
      button.classList.toggle("is-active",active);
      button.setAttribute("aria-pressed",String(active));
    });
    const filtered = assets.filter(a=>(type==="persona" ? a.kind==="character" : a.kind===type) && a.title.toLowerCase().includes(search.toLowerCase()));
    $("#assetItems").innerHTML = filtered.length ? filtered.map(asset => {
      const picked = asset.id === selectedId, isAttached = Boolean(binding(asset.id)?.enabled);
      const isPersona=asset.id===getStory()?.assetSetup?.personaId;
      return '<button class="asset-item '+(picked?'is-selected':'')+'" type="button" data-select="'+escapeHtml(asset.id)+'"><strong>'+escapeHtml(asset.title)+'</strong><small>'+escapeHtml(asset.sourceFormat)+' · '+(type==="persona" ? (isPersona?"★ Current persona":"Available as persona") : isAttached?"✓ In this story":"Locally saved")+'</small></button>';
    }).join("") : '<p class="asset-empty">No '+(type==="persona"?"personas":type==="character"?"characters":"lorebooks")+' here yet. Import a JSON '+(type==="lorebook"?"lorebook":"or PNG V2 card")+'.</p>';
    const asset = current();
    if (!asset || (type==="persona" ? asset.kind!=="character" : asset.kind!==type)) {
      $("#assetDetail").innerHTML = '<div class="asset-empty"><h3>Select an asset</h3><p>Preview its contents, export the original, or attach it to your current story.</p></div>';
      return;
    }
    if (editingAssetId === asset.id) { $("#assetDetail").innerHTML = renderAssetEditor(asset); return; }
    if (asset.kind==="lorebook" && managingModes) {
      $("#assetDetail").innerHTML=renderLoreManager(asset);
      return;
    }
    const link = binding(asset.id);
    const attach = type==="persona" ? "" : '<label class="asset-attach"><input type="checkbox" id="assetAttach" '+(link?.enabled?'checked':'')+'> Use in current story</label>';
    const header = '<div class="asset-detail-top"><div><span>'+escapeHtml(asset.sourceFormat)+'</span><h3>'+escapeHtml(asset.title)+'</h3><small>'+escapeHtml(asset.filename)+'</small></div></div>';
    const tools = '<div class="asset-actions"><button type="button" data-action="edit">Edit copy</button><button type="button" data-action="export">Export original</button><button type="button" data-action="rename">Rename</button><button type="button" data-action="delete">Delete</button></div>';
    if (asset.kind === "character") {
      const c=asset.fields;
      const openings = [c.firstMessage,...c.alternateGreetings];
      const chosen = Math.min(link?.greeting||0,Math.max(0,openings.length-1));
      const selector = type==="persona"
        ? '<p class="asset-muted">Player-controlled V2 identity. Ember uses this card to describe you, not to speak or decide for you. Its greeting is not used as your opening.</p>'
        : '<label class="asset-field">Opening message<select id="assetGreeting">'+openings.map((_,i)=>'<option value="'+i+'" '+(i===chosen?'selected':'')+'>'+(i===0?'Primary greeting':'Alternate greeting '+i)+'</option>').join("")+'</select></label>';
      $("#assetDetail").innerHTML = header + attach + selector
        +'<div class="asset-content">'+(type==="persona"?"":'<h4>Opening preview</h4><p class="asset-prose">'+escapeHtml(openings[chosen]||"No opening defined. Start freely.")+'</p>')
        +'<h4>Description</h4><p class="asset-prose">'+escapeHtml(c.description||"Not specified")+'</p>'
        +'<h4>Personality</h4><p class="asset-prose">'+escapeHtml(c.personality||"Included in description or not specified")+'</p>'
        +'<h4>Scenario</h4><p class="asset-prose">'+escapeHtml(c.scenario||"No explicit scenario field. The greetings may establish a scene.")+'</p>'
        +'<h4>Example dialogue</h4><p class="asset-prose">'+escapeHtml(c.exampleMessages||"Not specified")+'</p>'
        +'<p class="asset-muted">Author: '+short(c.creator,100)+' · '+openings.length+' openings · '+(c.characterBook?.entries.length||0)+' embedded lore entries</p>'
        +'</div>'+(type==="persona"
        ? (getStory()?.assetSetup?.personaId===asset.id
          ? '<button type="button" class="asset-primary" data-action="clear-persona">Stop using this persona</button>'
          : '<button type="button" class="asset-primary" data-action="select-persona">Play as this V2 persona</button>')
        : '<button type="button" class="asset-primary" data-action="start">Start new scene with this character</button>')+tools;
    } else {
      const l=asset.fields;
      $("#assetDetail").innerHTML = header + attach
        +'<p class="asset-muted">'+escapeHtml(l.description)+'</p><p>'+l.entries.length+' entries · scan depth '+l.scanDepth+' · lore budget '+l.tokenBudget+' estimated tokens</p>'
        +'<div class="asset-content">'+l.entries.map(entry=>'<details class="asset-lore-entry"><summary>'+escapeHtml(entry.name)+(entry.enabled?'':' (disabled)')+'</summary><p class="asset-muted">Keywords: '+escapeHtml(entry.keys.join(", ")||"(constant or none)")+'</p><p class="asset-prose">'+escapeHtml(entry.content)+'</p></details>').join("")+'</div>'
        +'<button type="button" class="asset-primary" data-action="manage-lore">Manage Modes &amp; Entries</button>'
        +'<button type="button" data-action="diagnose">Test activation against current story</button><div id="assetDiagnostics"></div>'+tools;
    }
  }
  function renderLoreManager(asset) {
    const link=binding(asset.id);
    const effective=applyLoreOverrides({...asset,entryOverrides:link?.entryOverrides||{}});
    const entries=effective.fields.entries;
    const filtered=entries.filter(entry=>(modeView!=="modes"||isLoreMode(entry))
      && (entry.name+" "+entry.keys.join(" ")).toLowerCase().includes(modeSearch.toLowerCase()));
    const diag=link?.enabled ? activateLorebooks([{
      id:asset.id,fields:asset.fields,original:asset.original,entryOverrides:link.entryOverrides||{},
    }],getStory()?.turns||[]) : null;
    const included=new Set((diag?.entries||[]).map(e=>String(e.entryId)));
    const statusText=link?.enabled
      ? (diag.entries.length+" eligible under lore activation budgets; "+diag.estimatedTokens+" estimated tokens.")
      : "Attach this lorebook to the story to include enabled entries in generation.";
    const rows=filtered.map(entry=>{
      const original=asset.fields.entries.find(e=>String(e.sourceId)===String(entry.sourceId));
      const changed=Boolean(link?.entryOverrides?.[String(entry.sourceId)]);
      const indicator=link?.enabled
        ? included.has(String(entry.sourceId)) ? "Eligible" : "Not activated"
        : "Not attached";
      return '<details class="asset-mode-entry"><summary><strong>'+escapeHtml(entry.name)
        +'</strong><span>'+escapeHtml(indicator)+(changed?" · Story override":"")+'</span></summary>'
        +'<div class="asset-mode-fields">'
        +'<label><input type="checkbox" data-lore-enabled="'+escapeHtml(entry.sourceId)+'" '+(entry.enabled?"checked":"")+'> Enabled in this story</label>'
        +'<label><input type="checkbox" data-lore-constant="'+escapeHtml(entry.sourceId)+'" '+(entry.constant?"checked":"")+'> Always active (no keyword required)</label>'
        +'<label for="lore-keys-'+escapeHtml(entry.sourceId)+'">Trigger keywords, one per line</label>'
        +'<textarea data-lore-keywords="'+escapeHtml(entry.sourceId)+'" rows="2" id="lore-keys-'+escapeHtml(entry.sourceId)+'">'+escapeHtml(entry.keys.join("\n"))+'</textarea>'
        +'<div class="asset-mode-actions"><button type="button" data-action="save-lore-keywords" data-entry-id="'+escapeHtml(entry.sourceId)+'">Save keywords</button>'
        +'<button type="button" data-action="reset-lore-entry" data-entry-id="'+escapeHtml(entry.sourceId)+'" '+(changed?"":"disabled")+'>Restore source settings</button></div>'
        +'<p class="asset-muted">Source defaults: '+(original?.enabled?"enabled":"disabled")
        +', '+(original?.constant?"always active":"keyword-triggered")+'. Unchanged JSON export is available from the main lorebook card.</p>'
        +'</div></details>';
    }).join("");
    return '<div class="asset-mode-heading"><button type="button" data-action="back-to-lore">← Lorebook details</button>'
      +'<h3>Manage Modes &amp; Entries</h3><small>'+escapeHtml(asset.title)+'</small></div>'
      +'<p class="asset-muted">Changes apply only to this story. Imported originals are never modified.</p>'
      +'<p class="asset-muted">'+escapeHtml(statusText)+'</p>'
      +'<div class="asset-mode-tabs"><button type="button" data-mode-tab="modes" aria-pressed="'+(modeView==="modes")+'">Modes</button>'
      +'<button type="button" data-mode-tab="entries" aria-pressed="'+(modeView==="entries")+'">All entries ('+entries.length+')</button></div>'
      +'<label class="asset-field">Find a mode or keyword<input id="loreModeSearch" type="search" value="'+escapeHtml(modeSearch)+'" placeholder="Filter by name or keyword"></label>'
      +'<div class="asset-mode-list">'+(rows||'<p class="asset-muted">No matching entries.</p>')+'</div>'
      +'<button type="button" data-action="diagnose">Run activation diagnostics</button>'
      +'<pre class="asset-mode-diagnostics" id="assetDiagnostics">'+escapeHtml(statusText)+'</pre>';
  }
  async function updateLoreEntry(asset,id,change,reset=false) {
    const story=getStory();
    if(!story?.id)throw new Error("Open a story to configure lorebook modes.");
    const currentBinding=binding(asset.id);
    const overrides={...(currentBinding?.entryOverrides||{})};
    const key=String(id);
    if(!asset.fields.entries.some(e=>String(e.sourceId)===key))
      throw new Error("The selected lorebook entry no longer exists.");
    if(reset)delete overrides[key];
    else overrides[key]={...(overrides[key]||{}),...change};
    const normalized=normalizeEntryOverrides(overrides,asset.fields.entries.map(e=>e.sourceId));
    const next=attached.filter(link=>link.id!==asset.id);
    next.push({id:asset.id,enabled:currentBinding?.enabled===true,
      greeting:currentBinding?.greeting||0,entryOverrides:normalized});
    await setStoryAssets(owner(),story.id,next);
    await refresh("Story-only lore settings saved. Imported JSON is untouched.");
  }
  async function toggleAttachment(asset,enabled,greeting) {
    const story=getStory();
    if (!story?.id) throw new Error("Open a readable story before attaching assets.");
    if(enabled && asset.kind==="character" && story.assetSetup?.personaId===asset.id)
      throw new Error("Your player persona cannot also be attached as an NPC.");
    const next=attached.filter(x=>x.id!==asset.id);
    next.push({id:asset.id,enabled,greeting:greeting??binding(asset.id)?.greeting??0,
      ...(asset.kind==="lorebook"?{entryOverrides:binding(asset.id)?.entryOverrides||{}}:{})});
    await setStoryAssets(owner(),story.id,next);
    await refresh(enabled ? "Attached to this story locally." : "Asset disabled in this story.");
  }
  async function importFile(file) {
    if (!file) return;
    if (file.size > (file.name.toLowerCase().endsWith(".png") ? IMPORT_LIMITS.pngBytes : IMPORT_LIMITS.jsonBytes))
      throw new Error("File exceeds the import size limit.");
    const parsed=importEmberAsset(await file.arrayBuffer(),file.name);
    const result=await importLocalAsset(owner(),parsed);
    type=type==="persona" && result.asset.kind==="character" ? "persona" : result.asset.kind;selectedId=result.asset.id;search="";
    $("#assetSearch").value="";
    await refresh(result.duplicate ? "This exact file is already in your library." : "Imported locally. The original is preserved for export.");
  }
  shell.addEventListener("click",async event=>{
    const tab=event.target.closest("[data-tab]")?.dataset.tab;
    const id=event.target.closest("[data-select]")?.dataset.select;
    const action=event.target.closest("[data-action]")?.dataset.action;
    if(tab){type=tab;selectedId=null;editingAssetId=null;managingModes=false;modeSearch="";render();return;}
    if(id){selectedId=id;editingAssetId=null;managingModes=false;modeSearch="";render();return;}
    const modeTab=event.target.closest("[data-mode-tab]")?.dataset.modeTab;
    if(modeTab){modeView=modeTab;render();return;}
    if(!action)return;
    if(action==="close"){shell.close();return;}
    if(action==="import"){$("#assetImportFile").click();return;}
    if(action==="restore"){$("#assetBackupFile").click();return;}
    if(action==="backup"){
      try {
        const data=exportLocalLibrary(assets);
        const blob=new Blob([data],{type:"application/json"});
        const url=URL.createObjectURL(blob);
        const link=document.createElement("a");link.href=url;link.download="ember-library-backup.json";link.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
        status("Library backup exported. Store this file somewhere safe.");
      }catch(error){status(error.message);}
      return;
    }
    const asset=current();
    if(!asset)return;
    if(action==="manage-lore" && asset.kind==="lorebook"){
      managingModes=true;modeView="modes";modeSearch="";render();return;
    }
    if(action==="back-to-lore"){managingModes=false;modeSearch="";render();return;}
    if(action==="edit"){editingAssetId=asset.id;managingModes=false;render();return;}
    if(action==="cancel-edit"){editingAssetId=null;render();return;}
    if(action==="add-greeting"){
      $("#assetGreetingEdits")?.insertAdjacentHTML("beforeend",greetingEditor());
      return;
    }
    if(action==="remove-greeting"){event.target.closest("[data-greeting-item]")?.remove();return;}
    try {
      if(action==="select-persona" && type==="persona" && asset.kind==="character"){
        if(getStory()?.assetSetup?.characterId===asset.id)
          throw new Error("Choose a different V2 card; the selected card is your story character.");
        if(binding(asset.id)?.enabled)
          throw new Error("Disable this card's NPC attachment before using it as your persona.");
        await onSelectPersona(asset);
        await refresh("Playing as "+asset.fields.name+". This choice is saved with your story.");
      }
      if(action==="clear-persona" && type==="persona" && getStory()?.assetSetup?.personaId===asset.id){
        await onSelectPersona(null);
        await refresh("Player persona cleared. Choose another V2 card at any time.");
      }
      if(action==="start" && type==="character" && asset.kind==="character"){
        const index=Number($("#assetGreeting").value)||0;
        const launched=await onStartCharacter(asset,index);
        if(launched){ await setStoryAssets(owner(),getStory().id,[{id:asset.id,enabled:true,greeting:index}]);shell.close(); }
      }
      if(action==="export"){downloadLocalAsset(asset);status("Original file exported.");}
      if(action==="rename"){
        const proposed=window.prompt("Library display name (original file is unchanged):",asset.title);
        if(proposed===null)return;
        await renameLocalAsset(owner(),asset.id,proposed);await refresh("Local library label updated.");
      }
      if(action==="delete"){
        if(!window.confirm("Delete this local asset? Export it first if you need a backup."))return;
        await deleteLocalAsset(owner(),asset.id);await refresh("Deleted from the local library.");
      }
      if(action==="save-lore-keywords" || action==="reset-lore-entry") {
        const entryId=event.target.closest("[data-entry-id]")?.dataset.entryId;
        if(!entryId)throw new Error("No entry selected.");
        if(action==="reset-lore-entry")await updateLoreEntry(asset,entryId,{},true);
        else {
          const input=[...shell.querySelectorAll("[data-lore-keywords]")]
            .find(el=>el.dataset.loreKeywords===entryId);
          if(!input)throw new Error("Keywords editor is missing.");
          await updateLoreEntry(asset,entryId,{keys:input.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)});
        }
      }
      if(action==="diagnose"){
        const link=binding(asset.id);
        const outcome=activateLorebooks([{
          id:asset.id,fields:asset.fields,original:asset.original,
          entryOverrides:link?.entryOverrides||{},
        }],getStory()?.turns||[]);
        $("#assetDiagnostics").textContent=(link?.enabled?"Attached. ":"Not attached. ")
          +outcome.entries.length+" eligible entries, estimated "+outcome.estimatedTokens+" tokens.\n"
          +outcome.diagnostics.map(x=>x.entryId+": "+x.reason).join("\n")
          +"\nNote: final context may omit entries to preserve history.";
      }
    } catch(error){status(error.message);}
  });
  shell.addEventListener("change",async event=>{
    const target=event.target, asset=current();
    try{
      if(target.id==="assetBackupFile"){
        const file=target.files?.[0];target.value="";if(!file)return;
        if(file.size>48_000_000)throw new Error("Backup exceeds the size limit.");
        const parsed=parseLocalLibraryBackup(await file.text());
        if(!window.confirm("Restore "+parsed.length+" assets into this local library? Existing assets will not be overwritten."))return;
        let added=0;
        for(const entry of parsed){ const result=await importLocalAsset(owner(),entry);if(!result.duplicate)added++; }
        await refresh("Restored "+added+" new assets. "+(parsed.length-added)+" duplicates were skipped.");
      }else if(target.id==="assetImportFile"){
        const file=target.files?.[0];target.value="";await importFile(file);
      } else if(asset && target.dataset.loreEnabled!==undefined)
        await updateLoreEntry(asset,target.dataset.loreEnabled,{enabled:target.checked});
      else if(asset && target.dataset.loreConstant!==undefined)
        await updateLoreEntry(asset,target.dataset.loreConstant,{constant:target.checked});
      else if(asset && target.id==="assetAttach") await toggleAttachment(asset,target.checked);
      else if(asset && target.id==="assetGreeting"){
        const greeting=Number(target.value);
        // Greeting preference can be staged locally without activating the character.
        await toggleAttachment(asset,binding(asset.id)?.enabled??false,greeting);
        status("Opening preference saved for this story. Story launch integration is pending.");
      }
    }catch(error){status(error.message);}
  });
  shell.addEventListener("submit",async event=>{
    if(event.target.id!=="assetEditor")return;
    event.preventDefault();
    const asset=current();
    if(!asset || editingAssetId!==asset.id)return;
    const submit=event.target.querySelector('[type="submit"]');
    submit.disabled=true;
    try{
      const updated=buildEditedAsset(asset,readAssetEditor(event.target,asset));
      const result=await importLocalAsset(owner(),updated);
      type=type==="persona" && result.asset.kind==="character" ? "persona" : result.asset.kind;selectedId=result.asset.id;editingAssetId=null;
      await refresh(result.duplicate
        ? "An identical edited copy already exists. Opened that copy."
        : "Saved an editable JSON copy locally. Your original is unchanged.");
    }catch(error){status("Could not save edited copy: "+error.message);}
    finally{submit.disabled=false;}
  });
  $("#assetSearch").addEventListener("input", event=>{search=event.target.value;render();});
  shell.addEventListener("input",event=>{if(event.target.id==="loreModeSearch"){
    modeSearch=event.target.value;const pos=event.target.selectionStart;render();
    const input=$("#loreModeSearch");input?.focus();if(input)input.setSelectionRange(pos,pos);
  }});
  return {
    async open(tab="character") {
      if (["character","persona","lorebook"].includes(tab)) type=tab;
      selectedId=null;editingAssetId=null;managingModes=false;modeSearch="";
      shell.showModal();
      try{await refresh();}catch(error){status("Local library unavailable: "+error.message);}
    },
    close(){if(shell.open)shell.close();},
    refresh,
  };
}
