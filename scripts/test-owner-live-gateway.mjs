import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
// Read-only production probe. Uses only the browser publishable key and an invalid token.
const context=vm.createContext({});vm.runInContext(fs.readFileSync('public/config.js','utf8'),context);
const config=context.CLINIC_CONFIG;
const response=await fetch(config.supabaseUrl+'/functions/v1/clinic-platform-admin',{method:'POST',headers:{apikey:config.publishableKey,Authorization:'Bearer invalid-verification-token','Content-Type':'application/json'},body:JSON.stringify({action:'list-owner-operations'})});
assert.equal(response.status,401,'Deployed gateway must reject an invalid JWT');
console.log('PASS live owner gateway rejects an invalid JWT; no account credentials or data mutations used.');
