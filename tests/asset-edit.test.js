import test from "node:test";
import assert from "node:assert/strict";
import { importEmberAsset } from "../src/asset-import.js";
import { buildEditedAsset, applyAssetEdits } from "../src/asset-edit.js";
import { renderAssetEditor } from "../src/asset-editor-ui.js";
import { exportLocalLibrary, parseLocalLibraryBackup } from "../src/asset-backup.js";

function imported(source,filename) {
  return importEmberAsset(new TextEncoder().encode(JSON.stringify(source)),filename);
}
const exampleCard={
  spec:"chara_card_v2",spec_version:"2.0",
  data:{name:"Heather",description:"Original description",personality:"",
    scenario:"",first_mes:"First scene",alternate_greetings:["At the station","Moon Dance"],
    mes_example:"{{char}}: Halt!",creator:"Example author",extensions:{unknown_custom:{keep:"yes"}},
    character_book:{entries:[{keys:["ranger"],content:"Never lost.",extensions:{unknown:42}}],extensions:{id:100}}},
};
const exampleLore={
 name:"Dogs of Another World",description:"Original",
 scan_depth:4,token_budget:5000,recursive_scanning:false,
 extensions:{platform_unknown:{secret:false}},
 entries:{"1":{name:"Morgana",uid:1,key:["","Morgana"],keys:["","Morgana"],
   keysecondary:[],secondary_keys:[],content:"Original lore",disable:false,enabled:true,
   constant:false,selective:false,probability:100,extensions:{extra:"kept"}},
   "2":{name:"Tech",uid:2,key:["tech"],content:"Original technologies",disable:false}},
};
test("character editor creates a valid V2 copy without changing the imported card",()=>{
 const original=imported(exampleCard,"Heather.json");
 const edits={name:"Heather Revised",description:"Expanded story",personality:"Reserved",
   scenario:"At the station",firstMessage:"A new opening",alternateGreetings:["One","Two","Three"],
   exampleMessages:"{{char}}: Welcome."};
 const derived=buildEditedAsset(original,edits);
 assert.equal(derived.kind,"character");assert.equal(derived.sourceFormat,"v2-json");
 assert.equal(derived.fields.firstMessage,"A new opening");
 assert.deepEqual(derived.fields.alternateGreetings,["One","Two","Three"]);
 assert.equal(derived.original.data.extensions.unknown_custom.keep,"yes");
 assert.equal(derived.original.data.character_book.entries[0].extensions.unknown,42);
 assert.equal(original.original.data.name,"Heather");
 assert.equal(original.original.data.first_mes,"First scene");
 assert.equal(original.fields.alternateGreetings.length,2);
 assert.match(derived.filename,/edited\.json$/);
});
test("lorebook editor updates keywords and flags, retains original metadata and entry IDs",()=>{
 const original=imported(exampleLore,"Dogs.json");
 const edits={name:"Dogs Revised",description:"Revised",scanDepth:"5",tokenBudget:"6000",
   recursiveScanning:true,entries:[
     {name:"Morgana revised",content:"She is a queen.",keys:"Morgana\ndemon queen\n",secondaryKeys:"court",
      enabled:false,constant:false,selective:true},
     {name:"Technology",content:"New details",keys:"tech\nradios",secondaryKeys:"",
      enabled:true,constant:false,selective:false},
   ]};
 const derived=buildEditedAsset(original,edits);
 assert.equal(derived.fields.entries.length,2);
 assert.equal(derived.fields.scanDepth,5);assert.equal(derived.fields.tokenBudget,6000);
 assert.equal(derived.fields.entries[0].enabled,false);
 assert.deepEqual(derived.fields.entries[0].keys,["Morgana","demon queen"]);
 assert.deepEqual(derived.original.entries["1"].keys,["Morgana","demon queen"]);
 assert.deepEqual(derived.original.entries["1"].key,["Morgana","demon queen"]);
 assert.deepEqual(derived.original.entries["1"].keysecondary,["court"]);
 assert.equal(derived.original.entries["1"].uid,1);
 assert.equal(derived.original.entries["1"].extensions.extra,"kept");
 assert.equal(derived.original.extensions.platform_unknown.secret,false);
 assert.equal(original.original.entries["1"].content,"Original lore");
 assert.equal(original.original.entries["1"].enabled,true);
});
test("array-entry standalone lorebook remains an array after editing",()=>{
 const source={name:"ArrayBook",entries:[{content:"Lorem",keys:["one"],enabled:true}]};
 const original=imported(source,"Array.json");
 const edited=buildEditedAsset(original,{name:"Array V2",description:"Updated",
   scanDepth:"4",tokenBudget:"2048",recursiveScanning:false,
   entries:[{name:"Example",content:"New",keys:"new",secondaryKeys:"",enabled:true,constant:false,selective:false}]});
 assert.equal(Array.isArray(edited.original.entries),true);
 assert.equal(edited.original.entries[0].content,"New");
});
test("editing a PNG card produces a portable JSON copy and keeps the original format",()=>{
 const original=imported(exampleCard,"Character.json");
 original.sourceFormat="v2-png";
 const edited=buildEditedAsset(original,{name:"Heather",description:"Updated",personality:"",
   scenario:"",firstMessage:"New",alternateGreetings:[],exampleMessages:""});
 assert.equal(edited.sourceFormat,"v2-json");
 assert.equal(original.sourceFormat,"v2-png");
 const restored=parseLocalLibraryBackup(exportLocalLibrary([edited]));
 assert.equal(restored[0].fields.description,"Updated");
});
test("editor rejects invalid edits without touching original data",()=>{
 const original=imported(exampleCard,"Heather.json");
 const form={name:"",description:"",personality:"",scenario:"",firstMessage:"",alternateGreetings:[],exampleMessages:""};
 assert.throws(()=>applyAssetEdits(original,form),/Name/);
 assert.equal(original.original.data.name,"Heather");
 const book=imported(exampleLore,"Dogs.json");
 assert.throws(()=>applyAssetEdits(book,{name:"Dogs",description:"",scanDepth:"-1",tokenBudget:"20",
   recursiveScanning:false,entries:[{},{}]}),/Scan depth/);
 assert.equal(book.original.scan_depth,4);
});
test("editor renders uploaded text as escaped, inert markup",()=>{
 const original=imported({...exampleCard,data:{...exampleCard.data,description:'<script>alert("x")</script>'}},"X.json");
 const markup=renderAssetEditor({...original,fields:{...original.fields,description:'<script>alert("x")</script>'}});
 assert.ok(!markup.includes('<script>'));
 assert.match(markup,/&lt;script&gt;/);
 assert.match(markup,/Save as new copy/);
});
