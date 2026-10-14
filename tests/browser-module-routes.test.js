import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const server=readFileSync(join(root,"server/index.js"),"utf8");
const routes=new Map([...server.matchAll(/\['(\/ember\/[^']+)',\s*\['([^']+)',\s*'[^']+'\]\]/g)]
  .map(([,route,path])=>[route,path]));
const jsRoutes=[...routes.entries()].filter(([,path])=>path.startsWith("src/")&&path.endsWith(".js"));
const matches=(source,pattern)=>[...source.matchAll(pattern)].map(m=>m[1]);

test("every local browser module dependency has an HTTP allowlist route",()=>{
  assert.ok(jsRoutes.length>10,"The browser modules were not parsed from server allowlist");
  const failures=[];
  for(const [route,path] of jsRoutes){
    const source=readFileSync(join(root,path),"utf8");
    const deps=[
      ...matches(source,/\bfrom\s*["'](\.[^"']+)["']/g),
      ...matches(source,/\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g),
      ...matches(source,/\bimport\s*["'](\.[^"']+)["']/g),
    ];
    for(const dependency of deps){
      const importedPath=new URL(dependency,"https://ember.example"+route).pathname;
      if(!routes.has(importedPath))failures.push(route+" imports "+importedPath+" without an allowed HTTP route");
      else assert.equal(resolve(root,routes.get(importedPath)),
        resolve(dirname(join(root,path)),dependency),"Wrong file served for "+importedPath);
    }
  }
  assert.deepEqual(failures,[]);
});
test("formatter and its JavaScript MIME route exist for production transcript display",()=>{
  assert.equal(routes.get("/ember/src/story-format.js"),"src/story-format.js");
  assert.match(server,/\['\/ember\/src\/story-format\.js',\s*\['src\/story-format\.js',\s*'text\/javascript; charset=utf-8'\]\]/);
});
