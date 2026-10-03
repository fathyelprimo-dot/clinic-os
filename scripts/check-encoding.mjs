import fs from 'node:fs';import assert from 'node:assert/strict';
const files=['app/page.tsx','dist/index.html','dist/owner.html','dist/owner.js','dist/reset-password.html','dist/recovery.js','dist/auth-entry.js','dist/stage2.js','dist/supabase-client.js','supabase/functions/clinic-platform-admin/index.ts','supabase/functions/clinic-platform-admin/operations.ts','supabase/migrations/20261003004126_owner_provision_delete_recovery.sql'];
for(const file of files){const text=new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file));assert.ok(!text.includes('\uFFFD'),file+': replacement character');assert.ok(!text.includes('????'),file+': damaged question-mark text');}
console.log(`${files.length} source files passed strict UTF-8/corrupt-text checks.`);
