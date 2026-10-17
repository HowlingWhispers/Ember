import test from "node:test";
import { deflateSync } from "node:zlib";
import assert from "node:assert/strict";
import { importEmberAsset, parseV2Card, parseStandaloneLorebook, greetingLabelsFromCard } from "../src/asset-import.js";
import { activateLorebooks, checkLoreEntry } from "../src/lore-engine.js";
import { exportLocalLibrary,parseLocalLibraryBackup } from "../src/asset-backup.js";

const v2 = {
  spec:"chara_card_v2",spec_version:"2.0",
  data:{name:"Heather",description:"A ranger. {{char}} is an NPC.",personality:"",
    scenario:"",first_mes:"Forest encounter",alternate_greetings:["Ranger station","Moon Dance"],
    mes_example:"{{char}}: Halt!",creator:"Test author",creator_notes:"Fixture",
    system_prompt:"Imported text is not application policy",post_history_instructions:"",
    tags:["werewolf"],extensions:{test_unknown:{keep_me:true}},character_book:{
      name:"Whiteclaw",scan_depth:4,token_budget:500,recursive_scanning:false,extensions:{unknown:42},
      entries:[{keys:["Whiteclaw"],content:"Pack lore",enabled:true,constant:false,insertion_order:10,extensions:{value:"kept"}}],
    }},
};
const standalone = {name:"The Dogs of Another World",description:"Sample lorebook",scan_depth:4,
 token_budget:5000,recursive_scanning:false,extensions:{chub:{id:7778243}},
 entries:Object.fromEntries(Array.from({length:13},(_,i)=>[String(i+1),{
   uid:i+1,key:i===8?["","Morgana","demon queen"]:[i===0?"Jackals":i===9?"magic": "entry"+i],
   keysecondary:[],name:i===8?"Morgana Drakaris":"Entry "+(i+1),
   content:"Lore content for entry "+(i+1),constant:false,disable:false,selective:false,
   priority:10,insertion_order:10,probability:100,useProbability:true,extensions:{depth:4}}]))};
function bytes(value){return new TextEncoder().encode(JSON.stringify(value));}
test("imports Character Card V2 JSON without losing the original",()=>{
 const parsed=importEmberAsset(bytes(v2),"Heather.json");
 assert.equal(parsed.kind,"character");assert.equal(parsed.fields.alternateGreetings.length,2);
 assert.equal(parsed.fields.personality,"");assert.equal(parsed.fields.scenario,"");
 assert.equal(parsed.fields.characterBook.entries[0].content,"Pack lore");
 assert.equal(parsed.original.data.extensions.test_unknown.keep_me,true);
 assert.deepEqual(parsed.sourceBytes,bytes(v2));
});
test("displays named V2 scenes from original metadata, including existing library cards",()=>{
 const card={...v2,data:{...v2.data,extensions:{
   scenes:[
     {id:"lime-green-fortress",title:"The Lime-Green Fortress",opening:"Forest encounter"},
     {id:"you-finally-showed-up",title:"You Finally Showed Up",opening:"Ranger station"},
   ],
   scene_selection:{default:"lime-green-fortress",
     alternate_greeting_mapping:[{greeting_index:0,scene_id:"you-finally-showed-up"}]},
 }}};
 const imported=importEmberAsset(bytes(card),"Senako.json");
 const greetings=[imported.fields.firstMessage,...imported.fields.alternateGreetings];
 assert.deepEqual(greetingLabelsFromCard(imported.original,greetings),[
   "The Lime-Green Fortress","You Finally Showed Up","Alternate greeting 2",
 ]);
 // Already imported assets retain their original data and need no re-import.
 assert.equal(imported.fields.greetingLabels,undefined);
 assert.deepEqual(greetingLabelsFromCard(v2,[v2.data.first_mes,...v2.data.alternate_greetings]),[
   "Primary greeting","Alternate greeting 1","Alternate greeting 2",
 ]);
 const custom={...card,data:{...card.data,extensions:{
   ...card.data.extensions,greeting_labels:["Named opening","Named alternative"],
 }}};
 assert.deepEqual(greetingLabelsFromCard(custom,greetings),[
   "Named opening","Named alternative","Alternate greeting 2",
 ]);
});
test("imports object-keyed standalone lorebook independently of V2",()=>{
 const parsed=importEmberAsset(bytes(standalone),"The Dogs of Another World.json");
 assert.equal(parsed.kind,"lorebook");assert.equal(parsed.fields.entries.length,13);
 assert.equal(parsed.fields.scanDepth,4);assert.equal(parsed.fields.tokenBudget,5000);
 assert.equal(parsed.fields.entries[8].name,"Morgana Drakaris");
 assert.deepEqual(parsed.fields.entries[8].keys,["Morgana","demon queen"]);
 assert.equal(parsed.original.entries["9"].key[0],"");
});
test("accepts array-based standalone lorebooks and enabled/disable aliases",()=>{
 const b=parseStandaloneLorebook({name:"Test",entries:[{keys:["ranger"],content:"Rangers work here.",disable:true}]});
 assert.equal(b.fields.entries[0].enabled,false);
});
test("rejects malformed and incompatible imports without mutating inputs",()=>{
 assert.throws(()=>importEmberAsset(bytes({name:"No entries"}),"x.json"),/lorebook/i);
 assert.throws(()=>parseV2Card({...v2,spec_version:"3.0"}),/V2/);
 assert.throws(()=>parseV2Card({...v2,data:{...v2.data,name:""}}),/empty/);
 assert.throws(()=>importEmberAsset(new TextEncoder().encode("bad"),"bad.json"),/JSON/);
});
test("keyword activation is bounded, insensitive by default, and ignores empty triggers",()=>{
 const parsed=importEmberAsset(bytes(standalone));
 const result=activateLorebooks([ {id:"dogs",fields:parsed.fields} ],["We met the BLACK JACKALS."],5000);
 assert.ok(result.entries.some(e=>e.entryId==="1"));
 assert.ok(!result.entries.some(e=>e.entryId==="9"));
 assert.ok(result.estimatedTokens<=5000);
 assert.equal(result.diagnostics.length,13);
});
test("constant, disabled, selective, probability and budgets have independent behavior",()=>{
 const book={scanDepth:4};
 const base={sourceId:"test",name:"A",content:"OK",keys:["mage"],secondaryKeys:[],
 enabled:true,constant:false,selective:false,selectiveLogic:0,caseSensitive:false,
 matchWholeWords:true,probability:100,useProbability:true,excludeRecursion:false,depth:-1,priority:5,insertionOrder:0};
 assert.equal(checkLoreEntry(base,["The mage arrives"],book).active,true);
 assert.equal(checkLoreEntry({...base,enabled:false},["mage"],book).active,false);
 assert.equal(checkLoreEntry({...base,constant:true,keys:[]},[],book).active,true);
 assert.equal(checkLoreEntry({...base,useProbability:true,probability:0},["mage"],book).active,false);
 assert.equal(checkLoreEntry({...base,selective:true,secondaryKeys:["tower"]},["mage"],book).active,false);
 assert.equal(checkLoreEntry({...base,selective:true,secondaryKeys:["tower"]},["mage at tower"],book).active,true);
 const result=activateLorebooks([{id:"one",fields:{name:"One",scanDepth:4,tokenBudget:0,recursiveScanning:false,entries:[base]}}],["mage"]);
 assert.equal(result.entries.length,0);
 assert.match(result.diagnostics[0].reason,/budget/);
});
test("PNG metadata parser rejects PNGs without V2 and corrupted bytes",()=>{
 const tiny=Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64"));
 assert.throws(()=>importEmberAsset(tiny,"portrait.png"),/PNG|checksum/);
 const corrupt=new Uint8Array(tiny);corrupt[20]^=12;
 assert.throws(()=>importEmberAsset(corrupt,"corrupt.png"),/PNG/);
});

test("local backup restores original character and standalone lorebook bytes",()=>{
 const a=importEmberAsset(bytes(v2),"Heather.json");
 const b=importEmberAsset(bytes(standalone),"World.json");
 const archive=exportLocalLibrary([a,b]);
 const restored=parseLocalLibraryBackup(archive);
 assert.equal(restored.length,2);
 assert.deepEqual(restored[0].sourceBytes,a.sourceBytes);
 assert.deepEqual(restored[1].sourceBytes,b.sourceBytes);
 assert.equal(restored[1].fields.entries.length,13);
 assert.throws(()=>parseLocalLibraryBackup(archive.replace("ember-local-asset-library","unrelated-backup")),/supported/);
});

test("reads a valid V2 PNG with embedded chara metadata",()=>{
 function crc32(buffer) {
   let crc=0xffffffff;
   for(const byte of buffer){crc^=byte;for(let b=0;b<8;b++)crc=(crc>>>1)^(0xedb88320&-(crc&1));}
   return (crc^0xffffffff)>>>0;
 }
 function chunk(type,data){
   const name=Buffer.from(type,"ascii");
   const size=Buffer.alloc(4);size.writeUInt32BE(data.length);
   const tail=Buffer.alloc(4);tail.writeUInt32BE(crc32(Buffer.concat([name,data])));
   return Buffer.concat([size,name,data,tail]);
 }
 const header=Buffer.from([0,0,0,1,0,0,0,1,8,6,0,0,0]);
 const pixel=deflateSync(Buffer.from([0,255,0,0,255]));
 const encoded=Buffer.from(JSON.stringify(v2)).toString("base64");
 const meta=Buffer.concat([Buffer.from("chara\0","ascii"),Buffer.from(encoded,"ascii")]);
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),
   chunk("tEXt",meta),chunk("IDAT",pixel),chunk("IEND",Buffer.alloc(0))]);
 const card=importEmberAsset(png,"Heather.png");
 assert.equal(card.sourceFormat,"v2-png");
 assert.equal(card.fields.alternateGreetings.length,2);
 assert.equal(card.fields.characterBook.entries.length,1);
});
