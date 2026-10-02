import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const dir=new URL('../dist/',import.meta.url);
const ctx=vm.createContext({Intl,Date,console,URL});vm.runInContext(fs.readFileSync(new URL('domain.js',dir),'utf8'),ctx);const D=ctx.ClinicDomain;
let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS '+name);};
const now=Date.parse('2026-09-30T15:00:00Z');const b=(id,mins,priority=0,duration=20)=>({id,service_id:'s',status:'waiting',triage:'approved',scheduled_at:new Date(now+mins*60000).toISOString(),priority,duration_minutes:duration,travel_minutes:15});
const hours={opens:'18:00',closes:'19:00'},service=D.serviceDefaults[0],day='2026-09-30';
test('Availability excludes elapsed slots and visits crossing closing time',()=>{const slots=D.availableSlots(hours,service,day,[],now);assert.equal(slots[0],'18:05');assert.equal(slots.at(-1),'18:40');});
test('Availability blocks overlapping visits but allows touching boundaries',()=>{const slots=D.availableSlots(hours,service,day,[{scheduled_at:D.cairoInstant(day,'18:20'),duration_minutes:20,status:'waiting'}],now-60000);assert.deepEqual([...slots],['18:00','18:40']);});
test('Cancelled visits release availability; inactive services expose none',()=>{const booked={scheduled_at:D.cairoInstant(day,'18:20'),duration_minutes:20,status:'cancelled'};assert.ok(D.availableSlots(hours,service,day,[booked],now).includes('18:20'));assert.deepEqual([...D.availableSlots(hours,{...service,active:false},day,[],now)],[]);});
test('Every local HTML script and stylesheet exists',()=>{const html=fs.readFileSync(new URL('index.html',dir),'utf8');for(const m of html.matchAll(/(?:src|href)="([^"\s]+\.(?:js|css))"/g))assert.ok(fs.existsSync(new URL(m[1],dir)),m[1]);});

const stage2=fs.readFileSync(new URL('stage2.js',dir),'utf8');
const apiSource=fs.readFileSync(new URL('supabase-client.js',dir),'utf8');
const publicConfig=fs.readFileSync(new URL('config.js',dir),'utf8');
const schema=fs.readFileSync(new URL('../supabase/migrations/202609300001_clinic_os.sql',import.meta.url),'utf8');
const realtime=fs.readFileSync(new URL('../supabase/migrations/202610010001_persistence_realtime.sql',import.meta.url),'utf8');
const historySql=fs.readFileSync(new URL('../supabase/migrations/202610010003_appointment_history.sql',import.meta.url),'utf8');
test('Clinic data and Auth sessions never use persistent browser storage',()=>{for(const source of [stage2,apiSource])assert.doesNotMatch(source,/\b(?:localStorage|sessionStorage|indexedDB)\b/);});
test('Demo data is opt-in and the normal app fails closed without Supabase',()=>{assert.match(stage2,/demo=query\.get\('demo'\)==='1'/);assert.match(stage2,/live=Boolean\(config\.supabaseUrl&&config\.publishableKey\)/);assert.match(stage2,/initializeUI\(\);if\(demo\)seed\(\);/);assert.match(stage2,/if\(!live&&!demo\)throw Error/);});
test('Live browser config contains only a publishable Supabase key',()=>{assert.ok(publicConfig.includes("supabaseUrl: 'https://"));assert.ok(publicConfig.includes("publishableKey: 'sb_publishable_"));assert.doesNotMatch(publicConfig,/publishableKey:\s*'(?:service_role|sb_secret_)/);});
test('All clinic mutations have authenticated Supabase RPC paths',()=>{for(const fn of ['book_appointment','staff_action','save_service','save_clinic','save_encounter'])assert.ok(stage2.includes("api.rpc('"+fn+"'"),fn);});
test('Every clinical and financial table has RLS and tenant role policies',()=>{for(const [table,policy] of [['clinics','public_clinic'],['services','public_service'],['patients','contacts_scope'],['appointments','bookings_scope'],['medical_records','records_doctor'],['encounters','encounters_doctor'],['payments','receipts_staff'],['notifications','notices_scope']]){assert.ok(schema.includes('alter table public.'+table+' enable row level security'),table);assert.ok(schema.includes('create policy '+policy+' on public.'+table),policy);}});
test('Patient, payment, encounter and medical-record changes are published and subscribed',()=>{for(const table of ['patients','payments','medical_records','encounters']){assert.ok(realtime.includes("'"+table+"'"),table+' migration');assert.ok(apiSource.includes("table:'"+table+"'"),table+' client');}});
test('Patient directory loads all tenant rows in bounded pages',()=>assert.ok(stage2.includes("limit='+pageSize+'&offset='+offset")));
test('Older appointments and payment state load from authenticated keyset pages',()=>{assert.ok(historySql.includes('create function public.clinic_booking_history'));assert.ok(historySql.includes('grant execute on function public.clinic_booking_history'));assert.ok(stage2.includes("api.rpc('clinic_booking_history'"));assert.ok(stage2.includes('p_after_id:afterId'));});
test('Known foreign-key query paths have covering indexes',()=>{const indexes=fs.readFileSync(new URL('../supabase/migrations/202610010002_foreign_key_indexes.sql',import.meta.url),'utf8');for(const name of ['appointments_clinic_patient_idx','appointments_clinic_service_idx','appointments_requested_by_idx','clinic_domains_clinic_idx','encounters_clinic_appointment_patient_idx','encounters_doctor_idx','memberships_user_idx','notifications_clinic_appointment_patient_idx','patients_user_idx','payments_clinic_appointment_idx','payments_received_by_idx'])assert.ok(indexes.includes(name),name);});
test('Arabic phone normalization',()=>assert.equal(D.normalizePhone('٠١٠١٢٣٤٥٦٧٨'),'01012345678'));
test('Cairo calendar date crosses UTC midnight',()=>assert.equal(D.cairoDate(new Date('2026-09-30T22:30:00Z')),'2026-10-01'));
test('Demo appointments use Cairo time independent of browser locale',()=>assert.equal(D.cairoInstant('2026-09-30','18:00'),'2026-09-30T15:00:00.000Z'));
test('Doctor service validation rejects negative fee and invalid duration',()=>{assert.throws(()=>D.validateService({...D.serviceDefaults[0],price:-1}));assert.throws(()=>D.validateService({...D.serviceDefaults[0],duration_minutes:0}));});
test('Urgent eligible appointments advance before normal',()=>{const e=D.estimates([b('normal',0),b('urgent',0,10)],{now});assert.equal(e.urgent.minutes,0);assert.equal(e.normal.minutes,20);});
test('Future urgent appointment does not idle an available normal slot',()=>{const e=D.estimates([b('normal',0),b('future',60,100)],{now});assert.equal(e.normal.minutes,0);assert.equal(e.future.minutes,60);});
test('Current visit cannot be preempted by urgent booking',()=>{const e=D.estimates([{...b('inside',0),status:'inside',started_at:new Date(now-5*60000).toISOString()},b('urgent',0,99)],{now});assert.equal(e.urgent.minutes,15);});
test('Emergency awaits medical approval',()=>{const e=D.estimates([{...b('emergency',0,100),triage:'pending'},b('normal',0)],{now});assert.equal(e.emergency.minutes,null);assert.equal(e.normal.minutes,0);});
test('Paused queue suppresses ETA and departure reminders',()=>assert.equal(D.estimates([b('a',0)],{now,paused:true}).a.minutes,null));
test('Cancelled booking consumes no time',()=>assert.equal(D.estimates([{...b('c',0),status:'cancelled'},b('a',0)],{now}).a.minutes,0));
test('Learned durations use completed visits after three observations',()=>{const history=[1,2,3].map(i=>({...b('h'+i,0),status:'done',started_at:new Date(now-50*60000).toISOString(),finished_at:new Date(now-20*60000).toISOString()}));const e=D.estimates([...history,b('first',0),b('second',0)],{now});assert.equal(e.second.minutes,30);});
test('Travel plus buffer determines leave time',()=>{const e=D.estimates([b('a',40)],{now,buffer:5});assert.equal(e.a.leaveIn,20);assert.equal(e.a.low,35);assert.equal(e.a.high,45);});
test('Maps destination is encoded and coordinates used when configured',()=>{assert.ok(D.mapsUrl({latitude:30,longitude:31}).includes('destination=30%2C31'));assert.ok(D.mapsUrl({address:'A&B'}).endsWith('A%26B'));});

// Exercise the actual transport against a deterministic HTTP/WebSocket adapter.
const requests=[];let callback,openedSocket;
class Socket{constructor(url){this.url=url;this.readyState=1;this.sent=[];openedSocket=this;}send(raw){this.sent.push(JSON.parse(raw));}close(){this.readyState=3;}}
const apiCtx=vm.createContext({ClinicDomain:D,fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>url.includes('/token')?{access_token:'user-jwt',refresh_token:'refresh',expires_at:Date.now()/1000+3600}:{ok:true}};},WebSocket:Socket,setInterval:()=>1,clearInterval(){},setTimeout:()=>2,clearTimeout(){},URL,console});
vm.runInContext(fs.readFileSync(new URL('supabase-client.js',dir),'utf8'),apiCtx);const api=new apiCtx.ClinicAPI({supabaseUrl:'https://example.supabase.co',publishableKey:'public-key'});
await api.login('doctor@example.test','password');await api.rpc('clinic_snapshot',{p_clinic:'tenant-a'});
test('API sends authenticated user JWT, never service-role bypass',()=>{const r=requests.at(-1);assert.equal(r.options.headers.Authorization,'Bearer user-jwt');assert.equal(JSON.parse(r.options.body).p_clinic,'tenant-a');});
api.subscribe('tenant-a',()=>callback=true,()=>{});openedSocket.onopen();
test('Realtime subscription scopes every channel filter',()=>{const join=openedSocket.sent[0];assert.equal(join.payload.access_token,'user-jwt');assert.ok(join.payload.config.postgres_changes.every(x=>x.filter.endsWith('tenant-a')));});
openedSocket.onmessage({data:JSON.stringify({event:'postgres_changes'})});test('Realtime event refreshes visible state',()=>assert.equal(callback,true));api.disconnect();
test('Disconnect stops the socket',()=>assert.equal(openedSocket.readyState,3));
api.setSession({access_token:'test',refresh_token:'refresh',expires_in:120});
test('Token expiry derives from expires_in when expires_at is absent',()=>assert.ok(api.session.expires_at*1000>Date.now()+100000));
let releaseRefresh;
apiCtx.fetch=async url=>url.includes('grant_type=refresh_token')?await new Promise(resolve=>releaseRefresh=resolve):{ok:true,json:async()=>null};
const inflight=api.refresh();await api.logout();releaseRefresh({ok:true,json:async()=>({access_token:'late-token',refresh_token:'refresh',expires_in:120})});await inflight;
test('Delayed token refresh cannot resurrect a logged-out session',()=>assert.equal(api.session,null));

const ownerPage=fs.readFileSync(new URL('owner.html',dir),'utf8');
const ownerClient=fs.readFileSync(new URL('owner.js',dir),'utf8');
const ownerCss=fs.readFileSync(new URL('owner.css',dir),'utf8');
const tenantRls=fs.readFileSync(new URL('../supabase/tests/tenant_roles.sql',import.meta.url),'utf8');
test('Owner dashboard shows Cairo-local subscription expiry and effective activation',()=>{assert.ok(ownerClient.includes('function cairoToday()'));assert.ok(ownerClient.includes('function subscriptionExpired(t)'));assert.ok(ownerClient.includes('function subscriptionExpiring(t)'));assert.ok(ownerClient.includes('اشتراكات منتهية'));assert.ok(ownerClient.includes('انتهى الاشتراك'));assert.ok(ownerCss.includes('grid-template-columns:repeat(4,minmax(0,1fr))'));});
test('Tenant RLS integration covers suspension and inclusive Cairo expiry',()=>{assert.ok(tenantRls.includes('set is_active=false'));assert.ok(tenantRls.includes("ends_on=(now() at time zone 'Africa/Cairo')::date-1"));assert.ok(tenantRls.includes('expired clinic exposes patients'));assert.ok(tenantRls.includes('FAIL expired public clinic resolution'));});
test('Smart ETA formats minutes, hours, days, and zero safely',()=>{assert.equal(D.formatDuration(0),'الآن');assert.match(D.formatDuration(61),/ساعة/);assert.match(D.formatDuration(1505),/يوم/);assert.match(D.formatDuration(1505),/ساعة/);assert.match(D.formatDuration(1505),/دقيقة/);assert.equal(D.formatDuration(null),'—');});
test('Google Maps links are accepted only from supported HTTPS Maps domains',()=>{assert.equal(D.isMapsLink('https://maps.app.goo.gl/example'),true);assert.equal(D.isMapsLink('https://www.google.com/maps/place/Clinic'),true);assert.equal(D.isMapsLink('https://example.com/maps'),false);assert.ok(D.mapsUrl({address:'https://maps.app.goo.gl/example'}).startsWith('https://maps.app.goo.gl/'));});
test('Patient tracking uses verified phone identity without appointment codes',()=>{const clinicHtml=fs.readFileSync(new URL('index.html',dir),'utf8');const track=clinicHtml.match(/<dialog id="track-dialog"[\s\S]*?<\/dialog>/)?.[0]||'';assert.ok(track);assert.doesNotMatch(track,/name="(?:id|phone)"/);assert.doesNotMatch(stage2,/نسخ رقم الحجز|booking-id/);assert.ok(stage2.includes("await api.verifyOTP"));assert.ok(stage2.includes("await loadBookingHistory(true)"));});
test('Doctor photo upload is scoped to clinic-media with image type and size limits',()=>{assert.ok(apiSource.includes('/storage/v1/object/clinic-media/'));assert.ok(apiSource.includes('5*1024*1024'));assert.ok(apiSource.includes("'image/jpeg','image/png','image/webp'"));});
test('Doctor invitation callback restores a memory-only session and opens the doctor workspace',()=>{assert.ok(apiSource.includes('consumeAuthRedirect'));assert.ok(stage2.includes('api.consumeAuthRedirect()'));assert.ok(stage2.includes("if(staff())showView('admin')"));assert.doesNotMatch(apiSource,/localStorage|sessionStorage|indexedDB/);});
test('Owner dashboard assets are referenced and present in the distribution',()=>{for(const m of ownerPage.matchAll(/(?:src|href)="([^"\s]+\.(?:js|css))"/g))assert.ok(fs.existsSync(new URL(m[1].replace(/^\//,''),dir)),m[1]);assert.ok(ownerCss.includes('.steps-grid'));});
test('Owner controls use the signed-in admin Edge Function, never a service-role key',()=>{assert.ok(ownerClient.includes('/functions/v1/clinic-platform-admin'));assert.ok(ownerClient.includes("Authorization:'Bearer '+session.access_token"));assert.doesNotMatch(ownerClient,/service_role|sb_secret_|localStorage|sessionStorage|indexedDB/);for(const action of ['create-tenant','update-clinic','set-clinic-active','update-subscription','list-change-requests','update-change-request'])assert.ok(ownerClient.includes(action),action);});
test('Owner manually enters a clinic slug and receives patient and doctor links',()=>{assert.match(ownerPage,/name="slug"/);assert.match(ownerPage,/pattern="\[a-z0-9-\]\{3,80\}"/);assert.ok(ownerClient.includes("'/clinic/index.html?clinic='"));assert.ok(ownerClient.includes("&portal=doctor"));});
test('Doctor customization exposes tagline, about, templates, Google Maps, photo upload and WhatsApp support',()=>{for(const word of ['tagline','about','template','Google Maps','photo_file'])assert.ok(stage2.includes(word),word);assert.ok(stage2.includes('wa.me/201551007018'));});


const ownerFunction=fs.readFileSync(new URL('../supabase/functions/clinic-platform-admin/index.ts',import.meta.url),'utf8');
const syncScript=fs.readFileSync(new URL('../scripts/sync-ui.mjs',import.meta.url),'utf8');
test('Doctor invitation redirects to the clinic route and consumes its signed session',()=>{assert.ok(ownerFunction.includes('new URL("/clinic/index.html", siteOrigin)'));assert.ok(ownerFunction.includes('searchParams.set("portal", "doctor")'));assert.ok(stage2.includes('api.consumeAuthRedirect()'));});
test('Framework sync publishes the same owner portal and public config',()=>{for(const name of ['owner.html','owner.css','owner.js'])assert.ok(syncScript.includes("'"+name+"'"),name);assert.ok(syncScript.includes("'config.js'"));});

console.log(`${count} domain/transport checks passed. Database RLS integration and browser visual checks require their real runtimes.`);
