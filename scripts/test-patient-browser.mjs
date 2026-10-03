import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {testServer} from './test-static-server.mjs';
const require=createRequire(import.meta.url);
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||path.resolve('.tmp/verification/node_modules'),'playwright')));}
const server=await testServer('public');const browser=await chromium.launch({headless:true,channel:'msedge'});
const context=await browser.newContext({viewport:{width:390,height:900}});
const requests=[],errors=[];let passwordRequired=true,bookingCount=0;
const clinic={id:'10000000-0000-4000-8000-000000000001',slug:'test',name:'عيادة اختبار',specialty:'اختبار',address:'القاهرة',opens:'18:00',closes:'21:00',accent:'#087f7b',template:'classic',paused:false,buffer_minutes:5,instapay:'',wallet:''};
const service={id:'20000000-0000-4000-8000-000000000001',name:'كشف اختبار',category:'normal',price:100,duration_minutes:20,priority:0,active:true};
let booking;
await context.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url());
 if(url.origin===server.url){await route.continue();return;}
 // All remote traffic is intercepted. Test fixtures never enter the product database.
 if(!url.hostname.endsWith('.supabase.co')){await route.abort();return;}
 const body=request.postDataJSON();requests.push({path:url.pathname,body});
 let data={};let status=200;
 if(url.pathname.endsWith('/resolve_clinic'))data={clinic,services:[service]};
 else if(url.pathname.endsWith('/available_slots'))data=Array.from({length:33},(_,i)=>`${18+Math.floor(i*5/60)}:${String(i*5%60).padStart(2,'0')}`);
 else if(url.pathname==='/functions/v1/patient-booking'){
  if(body.action==='book'){bookingCount++;booking={id:'booking-'+bookingCount,status:'waiting',triage:'approved',arrived:false,paid:false,notification_consent:body.booking.p_consent,service_name:service.name,duration_minutes:20,scheduled_at:body.booking.p_date+'T15:00:00Z',eta:{minutes:30,low:25,high:35,leaveIn:0}};data={booking};}
  else if(body.action==='track')data={booking};else if(body.action==='config')data={publicKey:''};
 }
 else if(url.pathname==='/auth/v1/token')data={access_token:'doctor-test-jwt',refresh_token:'test-refresh',expires_in:3600};
 else if(url.pathname.endsWith('/doctor_password_status'))data=passwordRequired;
 else if(url.pathname==='/auth/v1/user'){passwordRequired=false;data={id:'doctor'};}
 else if(url.pathname.endsWith('/doctor_activation_status'))data={status:'approved'};
 else if(url.pathname.endsWith('/clinic_snapshot'))data={role:'doctor',bookings:[],notifications:[]};
 else if(url.pathname==='/rest/v1/services')data=[service];
 else if(url.pathname==='/auth/v1/recover'){status=422;data={message:'User not found'};}
 await route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':server.url,'Access-Control-Allow-Headers':'apikey, authorization, content-type','Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS'},body:JSON.stringify(data)});
});
await context.routeWebSocket('**',socket=>socket.close());
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
fs.mkdirSync('.tmp/browser-checks',{recursive:true});
try{
 await page.goto(server.url+'/clinic/index.html?clinic=test');
 try{await page.waitForFunction(()=>document.querySelector('#service-select')?.options.length===1);}catch(error){console.log('UI diagnostics',errors,await page.locator('.demo-strip').innerText(),requests.map(r=>r.path));throw error;}
 await page.locator('#days button').nth(1).click();await page.locator('#continue-booking').click();
 await page.locator('#booking-form input[name=name]').fill('مريض اختبار');await page.locator('#booking-form input[name=phone]').fill('01012345678');await page.locator('#booking-form input[name=consent]').check();
 await page.locator('#booking-form button[type=submit]').click();await page.locator('#booking-success').waitFor({state:'visible'});
 assert.equal(requests.filter(r=>['/auth/v1/otp','/auth/v1/verify'].includes(r.path)).length,0);
 const first=requests.find(r=>r.path.endsWith('/patient-booking')&&r.body.action==='book');assert.ok(first);assert.equal(first.body.booking.p_phone,'01012345678');assert.match(first.body.token,/^[A-Za-z0-9_-]{43}$/);
 console.log('PASS Live booking completes without OTP, SMS or patient Auth');
 assert.equal(await page.locator('#otp-dialog').isVisible(),false);
 assert.ok(await page.locator('#booking-success a').getAttribute('href').then(url=>url.includes('#booking=')));
 await page.screenshot({path:'.tmp/browser-checks/live-booking-mobile.png',fullPage:true});
 // Denial is deterministic and must leave the confirmed booking intact.
 await page.evaluate(()=>Object.defineProperty(Notification,'permission',{get:()=> 'denied',configurable:true}));
 await page.locator('#booking-success [data-action=browser-notifications]').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('رفضت'));
 assert.equal(bookingCount,1);console.log('PASS Denied notification permission retains the booking and explains settings');
 await page.locator('[data-action=track-last]').click();await page.locator('#track-result .eta-box').waitFor({state:'visible'});
 assert.match(await page.locator('#track-result').innerText(),/تقدير|تقديري/);console.log('PASS New booking tracks by its capability and displays server ETA');
 await page.locator('#track-dialog [data-close]').click();await page.locator('#view-toggle').click();await page.locator('#login-dialog').waitFor({state:'visible'});
 await page.locator('[data-action=forgot-password]').click();await page.locator('#recovery-form input').fill('unknown@example.test');await page.locator('#recovery-form button').click();await page.waitForFunction(()=>document.querySelector('#recovery-result').textContent.includes('إذا كان البريد'));
 console.log('PASS Forgotten-password UI uses a uniform response for an unknown email');
 await page.locator('#recovery-dialog [data-close]').click();await page.locator('#view-toggle').click();await page.locator('#login-form input[name=email]').fill('doctor@example.test');await page.locator('#login-form input[name=password]').fill('initial-test-password');await page.locator('#login-form button.primary').click();await page.locator('#password-dialog').waitFor({state:'visible'});
 assert.equal(await page.locator('#admin').isVisible(),false);await page.keyboard.press('Escape');assert.equal(await page.locator('#password-dialog').isVisible(),true);
 assert.equal(await page.locator('#login-form input[name=password]').inputValue(),'');
 console.log('PASS First login clears the initial password and forces the password screen');
 await page.locator('#password-form input[name=password]').fill('new-test-password');await page.locator('#password-form input[name=confirm]').fill('new-test-password');await page.locator('#password-form button').click();await page.locator('#admin').waitFor({state:'visible'});
 assert.equal(await page.locator('#password-form input[name=password]').inputValue(),'');console.log('PASS Doctor workspace opens only after password change');
 await page.screenshot({path:'.tmp/browser-checks/doctor-mobile.png',fullPage:true});
 await page.goto(server.url+'/clinic/index.html?clinic=test&portal=doctor&reset=1#access_token=recovery-test&refresh_token=test-refresh&expires_in=3600&type=recovery');await page.locator('#password-dialog').waitFor({state:'visible'});
 assert.equal(new URL(page.url()).hash,'');console.log('PASS Recovery callback opens the in-app password screen and removes URL tokens');
 assert.deepEqual(errors,[]);
}finally{await browser.close();await server.close();}
