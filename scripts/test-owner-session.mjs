import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {testServer} from './test-static-server.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(path.resolve('.tmp/verification/node_modules/playwright'));
const hosted=Boolean(process.env.OWNER_UI_ROOT);
const ui=hosted?{login:'#login-screen',email:'#login-form [name=email]',password:'#login-form [name=password]',submit:'#login-form button[type=submit]',message:'#login-message',retry:'#owner-auth-retry',request:'#change-request-list',logout:'#logout-button',attr:'data-owner-retry',metrics:'.summary-cards'}:{login:'#login-panel',email:'#owner-email',password:'#owner-password',submit:'#password-login',message:'#auth-message',retry:'#auth-retry',request:'#request-list',logout:'#logout',attr:'data-retry-section',metrics:'#summary-cards'};
const server=await testServer(process.env.OWNER_UI_ROOT||'public');
const browser=await chromium.launch({headless:true,channel:'msedge'});
let checks=0;
async function scenario(name,run){
 if(process.env.OWNER_SCENARIO&&!name.includes(process.env.OWNER_SCENARIO))return;
 const context=await browser.newContext();
 const state={failure:null,failedAction:'list-tenants',claimStatus:200,refreshStatus:200,refreshCount:0,expires:3600,calls:[],pending:[]};
 const errors=[];
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===server.url)return route.continue();
  if(!url.hostname.endsWith('.supabase.co'))return route.abort();
  const body=req.postDataJSON();state.calls.push({path:url.pathname,body,authorization:req.headers().authorization});
  let status=200,data={};
  if(url.pathname==='/auth/v1/token'){
   const refresh=url.searchParams.get('grant_type')==='refresh_token';
   if(refresh){state.refreshCount++;status=state.refreshStatus;await new Promise(r=>setTimeout(r,40));}
   data=status===200?{access_token:refresh?'renewed-token':'test-token',refresh_token:'test-refresh',expires_in:refresh?3600:state.expires}:{error:'invalid_grant'};
  }else if(url.pathname.includes('/functions/')){
   if(body.action==='claim-owner'){status=state.claimStatus;data=status===200?{owner:true,email:'owner@example.test'}:{error:'تعذر التحقق من الحساب.',code:status===403?'OWNER_FORBIDDEN':'OWNER_CHECK_UNAVAILABLE'};}
   else{
    if(body.action===state.failedAction&&state.failure){
     if(state.failure==='network')return route.abort('failed');
     if(state.failure==='delayed'){await new Promise(r=>state.pending.push(r));}
     else status=state.failure;
    }
    data=status!==200?{error:'تعذر تحميل القسم.',code:'TEST_ERROR'}:body.action==='create-tenant'?{tenant:{id:'10000000-0000-4000-8000-000000000002',slug:'isolated-new'},activation_status:'pending'}:body.action==='list-tenants'?{tenants:[{id:'10000000-0000-4000-8000-000000000001',name:'عيادة اختبار معزولة',slug:'isolated-test',is_active:true,service_count:1}]}:body.action==='list-owner-operations'?{operations:[],receipts:[]}:{requests:[]};
   }
  }
  await route.fulfill({status,contentType:'application/json; charset=utf-8',body:JSON.stringify(data)});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const login=async()=>{await page.goto(server.url+'/owner.html');await page.locator(ui.email).fill('owner@example.test');await page.locator(ui.password).fill('isolated-test-password');await page.locator(ui.submit).click();};
 try{await run({page,state,login});assert.deepEqual(errors,[]);console.log('PASS '+name);checks++;}catch(error){console.error({scenario:name,visibleMessage:await page.locator(ui.message).textContent(),browserErrors:errors});throw error;}finally{state.pending.forEach(r=>r());await context.close();}
}
try{
 for(const action of ['list-tenants','list-change-requests','list-doctor-activation-requests','list-owner-operations']){
  for(const failure of [400,500,'network'])await scenario(action+' '+failure+' preserves session and retries only its section',async({page,state,login})=>{
   state.failedAction=action;state.failure=failure;await login();
   const names={'list-tenants':'tenants','list-change-requests':'requests','list-doctor-activation-requests':'doctors','list-owner-operations':'maintenance'};
   const retry=page.locator('['+ui.attr+'="'+names[action]+'"]');await retry.waitFor();
   assert.equal(await page.locator('#dashboard').isVisible(),true);assert.equal(await page.locator(ui.login).isVisible(),false);
   if(action==='list-tenants'){assert.doesNotMatch(await page.locator('#tenant-list').innerText(),/لا توجد عيادات/);if(hosted)assert.equal(await page.locator('#tenant-count').innerText(),'—');else assert.doesNotMatch(await page.locator(ui.metrics).innerText(),/إجمالي العيادات/);}else await page.locator('.tenant-card').waitFor();
   const claims=state.calls.filter(c=>c.body?.action==='claim-owner').length;state.failure=null;await retry.click();await retry.waitFor({state:'detached'});
   assert.equal(state.calls.filter(c=>c.body?.action==='claim-owner').length,claims);assert.equal(state.refreshCount,0);await page.locator('.tenant-card').waitFor();
  });
 }
 await scenario('Non-owner is denied before dashboard requests',async({page,state,login})=>{state.claimStatus=403;await login();await page.waitForFunction(()=>document.querySelector('#login-message')?.textContent||document.querySelector('#auth-message')?.classList.contains('error'));assert.equal(await page.locator('#dashboard').isVisible(),false);assert.equal(state.calls.filter(c=>c.body?.action?.startsWith('list-')).length,0);});
 await scenario('Temporary owner check failure can retry without another password login',async({page,state,login})=>{state.claimStatus=503;await login();await page.locator(ui.retry).waitFor({state:'visible'});assert.equal(await page.locator('#dashboard').isVisible(),false);state.claimStatus=200;await page.locator(ui.retry).click();await page.locator('.tenant-card').waitFor();assert.equal(state.calls.filter(c=>c.path==='/auth/v1/token').length,1);});
 await scenario('Expired session renews once before loading',async({page,state,login})=>{state.expires=1;await login();await page.locator('.tenant-card').waitFor();assert.equal(state.refreshCount,1);assert.equal(state.calls.find(c=>c.body?.action==='claim-owner').authorization,'Bearer renewed-token');});
 await scenario('Parallel 401 responses share a refresh and revoked credentials deny access',async({page,state,login})=>{state.failure=401;await login();await page.waitForFunction(()=>document.querySelector('#login-message')?.textContent||document.querySelector('#auth-message')?.classList.contains('error'));await page.waitForFunction(()=>document.querySelector('#dashboard').hidden);assert.equal(await page.locator(ui.login).isVisible(),true);assert.equal(state.refreshCount,1);});
 await scenario('Invalid refresh token requires login',async({page,state,login})=>{state.expires=1;state.refreshStatus=400;await login();await page.waitForFunction(()=>document.querySelector('#login-message')?.textContent||document.querySelector('#auth-message')?.classList.contains('error'));assert.equal(await page.locator('#dashboard').isVisible(),false);});
 await scenario('Network refresh failure keeps session available for retry',async({page,state,login})=>{state.expires=1;state.refreshStatus=503;await login();await page.locator(ui.retry).waitFor({state:'visible'});state.refreshStatus=200;await page.locator(ui.retry).click();await page.locator('.tenant-card').waitFor();assert.equal(state.calls.filter(c=>c.path==='/auth/v1/token'&&c.body?.email).length,1);});
 await scenario('Logout prevents delayed section responses from restoring dashboard',async({page,state,login})=>{state.failure='delayed';await login();await page.locator('#dashboard').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#request-list')?.textContent.includes('لا توجد')||document.querySelector('#change-request-list')?.textContent.includes('مفيش'));await page.locator(ui.logout).click();await page.locator(ui.login).waitFor({state:'visible'});state.pending.forEach(r=>r());await page.waitForTimeout(100);assert.equal(await page.locator('#dashboard').isVisible(),false);assert.equal(await page.locator('.tenant-card').count(),0);});
 if(hosted)await scenario('Existing Site creates a doctor with a journal ID and clears the initial password',async({page,state,login})=>{
  await login();await page.locator('.tenant-card').waitFor();await page.locator('#add-clinic').click();const form=page.locator('#tenant-form');
  for(const [name,value] of [['clinic_name','عيادة اختبار جديدة'],['slug','isolated-new'],['doctor_name','طبيب الاختبار'],['doctor_email','doctor@example.test'],['initial_password','isolated-test-password']])await form.locator('[name='+name+']').fill(value);
  await form.locator('[name=service_name]').fill('كشف اختبار');await form.locator('[name=service_price]').fill('125.50');
  assert.deepEqual(await form.locator('input:invalid').evaluateAll(nodes=>nodes.map(n=>n.name)),[]);
  await form.locator('#save-tenant').click();await page.locator('#tenant-dialog').waitFor({state:'hidden'});
  const create=state.calls.find(c=>c.body?.action==='create-tenant');assert.ok(create);assert.match(create.body.operation_id,/^[0-9a-f-]{36}$/);assert.equal(create.body.initial_password,'isolated-test-password');assert.equal(await form.locator('[name=initial_password]').inputValue(),'');
 });
 console.log(`${checks} owner session browser scenarios passed; all service requests intercepted, no live data used.`);
}finally{await browser.close();await server.close();}
