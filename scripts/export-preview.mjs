import fs from 'node:fs';
const output=process.argv[2];if(!output)throw Error('Supply an output HTML path');
const dir=new URL('../dist/',import.meta.url);let html=fs.readFileSync(new URL('index.html',dir),'utf8');
const font='data:font/ttf;base64,'+fs.readFileSync(new URL('fonts/NotoSansArabic.ttf',dir)).toString('base64');
html=html.replace(/<link rel="preload"[^>]+>/,'');
for(const name of ['clinic.css','stage2.css','experience.css']){let css=fs.readFileSync(new URL(name,dir),'utf8').replace("fonts/NotoSansArabic.ttf",font);html=html.replace(`<link rel="stylesheet" href="${name}">`,'<style>'+css+'</style>');}
for(const name of ['config.js','domain.js','supabase-client.js','icons.js','stage2.js']){const content=name==='config.js'?"globalThis.CLINIC_CONFIG={supabaseUrl:'',publishableKey:'',clinicSlug:''};":fs.readFileSync(new URL(name,dir),'utf8');html=html.replace(`<script src="${name}"></script>`,'<script>'+content+'</script>');}
fs.writeFileSync(output,html);console.log('Standalone DEMO preview exported; live configuration excluded.');
