import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import {testServer} from './test-static-server.mjs';
const require=createRequire(import.meta.url);
let chromium;
try{({chromium}=require('playwright'));}catch(error){const runtime=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;if(!runtime)throw new Error('Install optional Playwright or set CODEX_PRIMARY_RUNTIME_NODE_MODULES before running browser checks.',{cause:error});({chromium}=require(path.join(runtime,'playwright')));}
const output=process.argv[2]||process.env.TEMP;
fs.mkdirSync(output,{recursive:true});
const server=await testServer('dist');
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:1050}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(server.url+'/index.html?demo=1');
 await page.waitForFunction(()=>document.querySelector('#service-select')?.options.length===4);
 await page.evaluate(()=>document.fonts.ready);assert.ok(await page.evaluate(()=>document.fonts.check('16px ClinicArabic')),'Bundled Arabic font loaded');
 for(const width of [1440,1280,768,390,320]){
   await page.setViewportSize({width,height:1000});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Patient page fits '+width);
 }
 await page.setViewportSize({width:1440,height:1050});
 await page.locator('#days button').nth(1).click();
 await page.locator('#continue-booking').click();
 await page.locator('#booking-form input[name=name]').fill('مريض اختبار');
 await page.locator('#booking-form input[name=phone]').fill('01012345678');
 await page.locator('#booking-form button[type=submit]').click();
 await page.locator('#booking-success').waitFor({state:'visible'});
 assert.equal(await page.locator('#booking-success .booking-id').count(),0);
 assert.match(await page.locator('#booking-success').innerText(),/لا تحتاج إلى رقم حجز/);
 await page.locator('[data-action=track-last]').click();
 await page.locator('#track-result .eta-box').waitFor({state:'visible'});
 await page.locator('#track-dialog [data-close]').click();
 await page.locator('#view-toggle').click();
 await page.locator('#admin').waitFor({state:'visible'});
 await page.locator('.admin-sidebar [data-action=payments]').click();
 assert.equal(await page.locator('#tab-payments').getAttribute('aria-selected'),'true');
 await page.locator('.admin-sidebar [data-action=services]').click();
 await page.locator('[data-edit-service]').first().click();
 await page.locator('#service-form input[name=price]').fill('420');
 await page.locator('#service-form button').click();
 await page.locator('#service-dialog').waitFor({state:'hidden'});
 assert.match(await page.locator('#extra-panel').textContent(),/٤٢٠/);
 await page.locator('.admin-sidebar [data-action=records]').click();
 await page.locator('#patient-search').fill('تجريبي ١');
 await page.locator('[data-record="P0"]').click();
 await page.locator('#record-form textarea[name=diagnosis]').fill('تشخيص تجريبي للاختبار');
 await page.locator('[data-action=add-medication]').click();
 for(const [name,value] of [['med-name','دواء تجريبي'],['med-dose','جرعة تجريبية'],['med-frequency','مرة'],['med-duration','يوم']])await page.locator('[name='+name+']').fill(value);
 await page.locator('#record-form button.primary').click();
 await page.waitForFunction(()=>document.querySelector('#record-history').textContent.includes('تشخيص تجريبي للاختبار'));
 await page.locator('#record-dialog [data-close]').click();
 await page.locator('#demo-role').selectOption('reception');
 assert.equal(await page.locator('.admin-sidebar [data-action=records]').isVisible(),false);
 for(const width of [1440,768,390,320]){
   await page.setViewportSize({width,height:1000});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Admin page fits '+width);
 }
 await page.setViewportSize({width:1440,height:1050});
 await page.screenshot({path:path.join(output,'clinic-os-admin.png'),fullPage:true});
 await page.locator('#view-toggle').click();
 await page.screenshot({path:path.join(output,'clinic-os-patient.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS font, responsive layouts, booking, tracking, payments navigation, service editing, medical record and reception visibility.');
}finally{await browser.close();await server.close();}
