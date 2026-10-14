import { importEmberAsset, IMPORT_LIMITS } from "./asset-import.js";
import { listLocalAssets, importLocalAsset, renameLocalAsset, deleteLocalAsset,
  downloadLocalAsset, getStoryAssets, setStoryAssets } from "./asset-store.js";
import { activateLorebooks } from "./lore-engine.js";
import { exportLocalLibrary, parseLocalLibraryBackup } from "./asset-backup.js";
import { buildEditedAsset } from "./asset-edit.js";
import { renderAssetEditor, readAssetEditor, greetingEditor } from "./asset-editor-ui.js";

const escapeHtml = value => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;")
  .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const short = (value,n=180) => escapeHtml(String(value || "").slice(0,n));
export function mountAssetLibrary({root,owner,getStory,onStartCharacter}) {
  const shell = document.createElement("dialog");
  shell.className = "asset-library";
  shell.setAttribute("aria-labelledby","assetLibraryTitle");
  shell.innerHTML = '<div class="asset-frame"><header class="asset-header"><div><p class="asset-eyebrow">EMBER · LOCAL STORAGE</p><h2 id="assetLibraryTitle">My Library</h2><p>Character cards and lorebooks stored in this browser, never uploaded to Orbis.</p></div><button type="button" data-action="close" aria-label="Close library">✕</button></header><div class="asset-tools"><div class="asset-tabs" role="group" aria-label="Asset type"><button type="button" data-tab="character">Characters</button><button type="button" data-tab="lorebook">Lorebooks</button></div><label class="asset-search"><span class="visually-hidden">Search local assets</span><input id="assetSearch" type="search" placeholder="Search this library"></label><button class="asset-primary" type="button" data-action="import">＋ Import file</button><input id="assetImportFile" type="file" accept=".json,.png,application/json,image/png" hidden><button type="button" data-action="backup">Backup library</button><button type="button" data-action="restore">Restore backup</button><input id="assetBackupFile" type="file" accept=".json,application/json" hidden></div><p class="asset-notice" id="assetLibraryStatus" role="status" aria-live="polite"></p><div class="asset-body"><div class="asset-list" id="assetItems"></div><section id="assetDetail" class="asset-detail" aria-label="Selected asset"></section></div><footer class="asset-footer">Your assets stay in this browser profile. Export backups before clearing browser data. Importing does not automatically change a story.</footer></div>';
  root.append(shell);
  const $ = sel => shell.querySelector(sel);
  let assets = [], attached = [], type = "character", selectedId = null, search = "", editingAssetId = null;
  const current = () => assets.find(a => a.id === selectedId);
  const binding = id => attached.find(a => a.id === id);
  const status = value => { $("#assetLibraryStatus").textContent = value; };
  async function refresh(message = "") {
    assets = await listLocalAssets(owner());
    attached = getStory()?.id ? await getStoryAssets(owner(),getStory().id) : [];
    if (selectedId && !current()) { selectedId = null; editingAssetId = null; }
    render();
    status(message);
  }
  function render() {
    shell.querySelectorAll("[data-tab]").forEach(button=> {
      const active = button.dataset.tab === type;
      button.classList.toggle("is-active",active);
      button.setAttribute("aria-pressed",String(active));
    });
    const filtered = assets.filter(a=>a.kind === type && a.title.toLowerCase().includes(search.toLowerCase()));
    $("#assetItems").innerHTML = filtered.length ? filtered.map(asset => {
      const picked = asset.id === selectedId, isAttached = Boolean(binding(asset.id)?.enabled);
      return '<button class="asset-item '+(picked?'is-selected':'')+'" type="button" data-select="'+escapeHtml(asset.id)+'"><strong>'+escapeHtml(asset.title)+'</strong><small>'+escapeHtml(asset.sourceFormat)+' · '+(isAttached?'✓ In this story':'Locally saved')+'</small></button>';
    }).join("") : '<p class="asset-empty">No '+(type==="character"?"characters":"lorebooks")+' here yet. Import a JSON '+(type==="character"?"or PNG card":"lorebook")+'.</p>';
    const asset = current();
    if (!asset || asset.kind !== type) {
      $("#assetDetail").innerHTML = '<div class="asset-empty"><h3>Select an asset</h3><p>Preview its contents, export the original, or attach it to your current story.</p></div>';
      return;
    }
    if (editingAssetId === asset.id) { $("#assetDetail").innerHTML = renderAssetEditor(asset); return; }
    const link = binding(asset.id);
    const attach = '<label class="asset-attach"><input type="checkbox" id="assetAttach" '+(link?.enabled?'checked':'')+'> Use in current story</label>';
    const header = '<div class="asset-detail-top"><div><span>'+escapeHtml(asset.sourceFormat)+'</span><h3>'+escapeHtml(asset.title)+'</h3><small>'+escapeHtml(asset.filename)+'</small></div></div>';
    const tools = '<div class="asset-actions"><button type="button" data-action="edit">Edit copy</button><button type="button" data-action="export">Export original</button><button type="button" data-action="rename">Rename</button><button type="button" data-action="delete">Delete</button></div>';
    if (asset.kind === "character") {
      const c=asset.fields;
      const openings = [c.firstMessage,...c.alternateGreetings];
      const chosen = Math.min(link?.greeting||0,Math.max(0,openings.length-1));
      const selector = '<label class="asset-field">Opening message<select id="assetGreeting">'+openings.map((_,i)=>'<option value="'+i+'" '+(i===chosen?'selected':'')+'>'+(i===0?'Primary greeting':'Alternate greeting '+i)+'</option>').join("")+'</select></label>';
      $("#assetDetail").innerHTML = header + attach + selector
        +'<div class="asset-content"><h4>Opening preview</h4><p class="asset-prose">'+escapeHtml(openings[chosen]||"No opening defined. Start freely.")+'</p>'
        +'<h4>Description</h4><p class="asset-prose">'+escapeHtml(c.description||"Not specified")+'</p>'
        +'<h4>Personality</h4><p class="asset-prose">'+escapeHtml(c.personality||"Included in description or not specified")+'</p>'
        +'<h4>Scenario</h4><p class="asset-prose">'+escapeHtml(c.scenario||"No explicit scenario field. The greetings may establish a scene.")+'</p>'
        +'<h4>Example dialogue</h4><p class="asset-prose">'+escapeHtml(c.exampleMessages||"Not specified")+'</p>'
        +'<p class="asset-muted">Author: '+short(c.creator,100)+' · '+openings.length+' openings · '+(c.characterBook?.entries.length||0)+' embedded lore entries</p>'
        +'</div><button type="button" class="asset-primary" data-action="start">Start new scene with this character</button>'+tools;
    } else {
      const l=asset.fields;
      $("#assetDetail").innerHTML = header + attach
        +'<p class="asset-muted">'+escapeHtml(l.description)+'</p><p>'+l.entries.length+' entries · scan depth '+l.scanDepth+' · lore budget '+l.tokenBudget+' estimated tokens</p>'
        +'<div class="asset-content">'+l.entries.map(entry=>'<details class="asset-lore-entry"><summary>'+escapeHtml(entry.name)+(entry.enabled?'':' (disabled)')+'</summary><p class="asset-muted">Keywords: '+escapeHtml(entry.keys.join(", ")||"(constant or none)")+'</p><p class="asset-prose">'+escapeHtml(entry.content)+'</p></details>').join("")+'</div>'
        +'<button type="button" data-action="diagnose">Test activation against current story</button><div id="assetDiagnostics"></div>'+tools;
    }
  }
  async function toggleAttachment(asset,enabled,greeting) {
    const story=getStory();
    if (!story?.id) throw new Error("Open a readable story before attaching assets.");
    const next=attached.filter(x=>x.id!==asset.id);
    next.push({id:asset.id,enabled,greeting:greeting??binding(asset.id)?.greeting??0});
    await setStoryAssets(owner(),story.id,next);
    await refresh(enabled ? "Attached to this story locally. AI context integration is not active yet." : "Asset disabled in this story.");
  }
  async function importFile(file) {
    if (!file) return;
    if (file.size > (file.name.toLowerCase().endsWith(".png") ? IMPORT_LIMITS.pngBytes : IMPORT_LIMITS.jsonBytes))
      throw new Error("File exceeds the import size limit.");
    const parsed=importEmberAsset(await file.arrayBuffer(),file.name);
    const result=await importLocalAsset(owner(),parsed);
    type=result.asset.kind;selectedId=result.asset.id;search="";
    $("#assetSearch").value="";
    await refresh(result.duplicate ? "This exact file is already in your library." : "Imported locally. The original is preserved for export.");
  }
  shell.addEventListener("click",async event=>{
    const tab=event.target.closest("[data-tab]")?.dataset.tab;
    const id=event.target.closest("[data-select]")?.dataset.select;
    const action=event.target.closest("[data-action]")?.dataset.action;
    if(tab){type=tab;selectedId=null;editingAssetId=null;render();return;}
    if(id){selectedId=id;editingAssetId=null;render();return;}
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
    if(action==="edit"){editingAssetId=asset.id;render();return;}
    if(action==="cancel-edit"){editingAssetId=null;render();return;}
    if(action==="add-greeting"){
      $("#assetGreetingEdits")?.insertAdjacentHTML("beforeend",greetingEditor());
      return;
    }
    if(action==="remove-greeting"){event.target.closest("[data-greeting-item]")?.remove();return;}
    try {
      if(action==="start" && asset.kind==="character"){
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
      if(action==="diagnose"){
        const outcome=activateLorebooks([asset],getStory()?.turns||[]);
        $("#assetDiagnostics").textContent=outcome.entries.length+" active entries, estimated "+outcome.estimatedTokens+" tokens. "+outcome.diagnostics.map(x=>x.entryId+": "+x.reason).join("; ");
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
      } else if(asset && target.id==="assetAttach") await toggleAttachment(asset,target.checked);
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
      type=result.asset.kind;selectedId=result.asset.id;editingAssetId=null;
      await refresh(result.duplicate
        ? "An identical edited copy already exists. Opened that copy."
        : "Saved an editable JSON copy locally. Your original is unchanged.");
    }catch(error){status("Could not save edited copy: "+error.message);}
    finally{submit.disabled=false;}
  });
  $("#assetSearch").addEventListener("input", event=>{search=event.target.value;render();});
  return {
    async open() {
      shell.showModal();
      try{await refresh();}catch(error){status("Local library unavailable: "+error.message);}
    },
    close(){if(shell.open)shell.close();},
    refresh,
  };
}
