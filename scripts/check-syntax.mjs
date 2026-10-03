import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
let count=0;
function check(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){
 if(['client','server','node_modules'].includes(item.name))continue;
 const file=path.join(dir,item.name);
 if(item.isDirectory())check(file);
 else if(/\.(?:js|mjs)$/.test(file)){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0)throw Error(result.stderr);count++;
 }
}}
for(const dir of ['dist','public','scripts'])check(dir);
console.log(`${count} JavaScript files passed syntax checks.`);
