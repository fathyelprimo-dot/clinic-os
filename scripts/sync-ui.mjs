// One shared UI for the dependency-free preview and framework route.
import fs from 'node:fs';
const root=new URL('../',import.meta.url),target=new URL('public/clinic/',root);
fs.mkdirSync(target,{recursive:true});
for(const name of ['index.html','clinic.css','stage2.css','experience.css','icons.js','domain.js','config.js','supabase-client.js','stage2.js'])fs.copyFileSync(new URL('dist/'+name,root),new URL(name,target));
fs.cpSync(new URL('dist/fonts/',root),new URL('fonts/',target),{recursive:true});
fs.writeFileSync(new URL('components/clinic-app.tsx',root),`'use client';
import {useEffect,useState} from 'react';
// Both entry points use the same UI and Supabase/RLS adapter.
export default function ClinicApp(){const [src,setSrc]=useState<string|null>(null);useEffect(()=>setSrc('/clinic/index.html'+window.location.search),[]);return src?<iframe src={src} title="Clinic OS" style={{border:0,width:'100%',height:'100dvh',display:'block'}}/>:null;}
`);
const path=new URL('package.json',root),pkg=JSON.parse(fs.readFileSync(path,'utf8'));pkg.scripts['ui:sync']='node scripts/sync-ui.mjs';pkg.scripts.predev='node scripts/sync-ui.mjs';pkg.scripts.prebuild='node scripts/sync-ui.mjs';pkg.scripts['test:phase2']='node scripts/test-phase2.mjs';fs.writeFileSync(path,JSON.stringify(pkg,null,2)+'\n');
console.log('Shared UI synchronized to the framework route.');
