// One shared UI for the dependency-free preview and framework route.
import fs from 'node:fs';
const root=new URL('../',import.meta.url),target=new URL('public/clinic/',root),publicRoot=new URL('public/',root);
fs.mkdirSync(target,{recursive:true});fs.mkdirSync(publicRoot,{recursive:true});
for(const name of ['index.html','clinic.css','stage2.css','experience.css','icons.js','domain.js','config.js','supabase-client.js','stage2.js','push-sw.js','reset-password.html','recovery.js','auth-entry.js'])fs.copyFileSync(new URL('dist/'+name,root),new URL(name,target));
fs.cpSync(new URL('dist/fonts/',root),new URL('fonts/',target),{recursive:true});
for(const name of ['owner.html','owner.css','owner.js','auth-entry.js'])fs.copyFileSync(new URL('dist/'+name,root),new URL(name,publicRoot));
fs.copyFileSync(new URL('dist/config.js',root),new URL('config.js',publicRoot));
fs.cpSync(new URL('dist/fonts/',root),new URL('fonts/',publicRoot),{recursive:true});
fs.writeFileSync(new URL('components/clinic-app.tsx',root),`'use client';
import {useSyncExternalStore} from 'react';
// Both entry points use the same UI and Supabase/RLS adapter.
const subscribeToSearch=()=>()=>{};
const getSearch=()=>window.location.search;
const getServerSearch=()=>'';
export default function ClinicApp(){const search=useSyncExternalStore(subscribeToSearch,getSearch,getServerSearch);return <iframe src={'/clinic/index.html'+search} title="Clinic OS" style={{border:0,width:'100%',height:'100dvh',display:'block'}}/>;}
`);
const path=new URL('package.json',root),pkg=JSON.parse(fs.readFileSync(path,'utf8'));pkg.scripts['ui:sync']='node scripts/sync-ui.mjs';pkg.scripts.predev='node scripts/sync-ui.mjs';pkg.scripts.prebuild='node scripts/sync-ui.mjs';pkg.scripts['test:phase2']='node scripts/test-phase2.mjs';fs.writeFileSync(path,JSON.stringify(pkg,null,2)+'\n');
console.log('Shared UI synchronized to the framework route.');
