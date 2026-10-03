'use strict';
(function(){
 const config=globalThis.CLINIC_CONFIG||{};
 const base=String(config.supabaseUrl||'').replace(/\/$/,'');
 const key=config.publishableKey||'';
 const $=function(selector,root){return (root||document).querySelector(selector);};
 const $$=function(selector,root){return Array.from((root||document).querySelectorAll(selector));};
 let creating=false,creationId=null,deleting=null,deletionId=null;
 let session=null,tenants=[],requests=[],doctorRequests=[],editingClinic=null,toastTimer=null;
 const defaults=[
  {name:'كشف عادي',category:'normal',price:350,duration_minutes:20,priority:0,active:true},
  {name:'كشف مستعجل',category:'urgent',price:500,duration_minutes:20,priority:10,active:true},
  {name:'طوارئ',category:'emergency',price:650,duration_minutes:30,priority:20,active:true},
  {name:'متابعة',category:'followup',price:200,duration_minutes:15,priority:0,active:true}
 ];
 function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function say(message,error){const node=$('#auth-message');node.textContent=message||'';node.classList.toggle('error',Boolean(error));}
 function toast(message){const node=$('#toast');node.textContent=message;node.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(function(){node.hidden=true;},4200);}
 function setSession(data){if(!data||!data.access_token||!data.refresh_token)throw Error('تعذر استلام جلسة آمنة. افتح رابط الدخول الأخير مرة أخرى.');session={access_token:data.access_token,refresh_token:data.refresh_token,expires_at:data.expires_at||Math.floor(Date.now()/1000)+Number(data.expires_in||3600),user:data.user||null};}
 async function authRequest(path,body){const response=await fetch(base+path,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json().catch(function(){return null;});if(!response.ok)throw Error(data&&data.msg==='Invalid login credentials'?'البريد الإلكتروني أو كلمة المرور غير صحيحة.':'تعذر إكمال تسجيل الدخول. تحقق من البريد والإعدادات وحاول مرة أخرى.');return data;}
 async function refreshSession(){if(!session||!session.refresh_token)throw Error('انتهت الجلسة. سجّل الدخول مرة أخرى.');const data=await authRequest('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token});setSession(data);}
 async function ownerAction(action,payload){
  if(!session)throw Error('سجّل الدخول برابط المالك أولًا.');
  if(session.expires_at*1000<Date.now()+60000)await refreshSession();
  const response=await fetch(base+'/functions/v1/clinic-platform-admin',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify(Object.assign({action:action},payload||{}))});
  const data=await response.json().catch(function(){return null;});
  if(!response.ok){
   let message=data&&data.error||'تعذر تنفيذ الإجراء. تحقق من صلاحية حساب المالك.';
   if(/^\?+[\s?.؟!]*$/.test(String(message))||String(message).includes('????')){
    message='حدث خطأ من خادم إدارة المنصة (HTTP '+response.status+'). نسخة الدالة المنشورة قديمة أو رسالة الخطأ تالفة. حاول إعادة تحميل الصفحة، وإذا استمر الخطأ راجع تحديث clinic-platform-admin.';
   }
   const error=Error(message);
   Object.assign(error,{status:response.status,action:action,cleanup_pending:data?.cleanup_pending,retry_new:data?.retry_new});
   throw error;
  }
  return data||{};
 }
 async function sendOwnerLink(email){
  if(!base||!key)throw Error('إعداد Supabase غير موجود في نسخة الموقع.');
  const redirect=location.origin+'/owner.html';
  return authRequest('/auth/v1/recover?redirect_to='+encodeURIComponent(redirect),{email:email});
 }
 async function signInWithPassword(email,password){
  if(!base||!key)throw Error('إعداد Supabase غير موجود في نسخة الموقع.');
  const data=await authRequest('/auth/v1/token?grant_type=password',{email:email,password:password});
  setSession(data);
  await claimAndLoad();
 }
 async function updateOwnerPassword(password){
  if(!session)throw Error('افتح رابط استعادة كلمة المرور أو سجّل الدخول أولًا.');
  if(session.expires_at*1000<Date.now()+60000)await refreshSession();
  const response=await fetch(base+'/auth/v1/user',{method:'PUT',headers:{apikey:key,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({password:password})});
  const data=await response.json().catch(function(){return null;});
  if(!response.ok)throw Error(data&&data.msg==='weak_password'?'اختار كلمة مرور أقوى.':'تعذر تغيير كلمة المرور. سجّل الدخول من جديد وحاول مرة أخرى.');
 }
 function captureLinkSession(){
  const params=new URLSearchParams(location.hash.replace(/^#/,''));
  const access=params.get('access_token'),refresh=params.get('refresh_token');
  const errorDescription=params.get('error_description');
  if(errorDescription){
   history.replaceState({},document.title,location.pathname);
   throw Error('رابط استعادة كلمة المرور غير صالح أو انتهت صلاحيته. اطلب رابط Forget Password جديدًا.');
  }
  if(!access||!refresh)return false;
  setSession({access_token:access,refresh_token:refresh,expires_in:params.get('expires_in'),token_type:params.get('token_type')});
  history.replaceState({},document.title,location.pathname);
  return true;
 }
 function showDashboard(email){
  $('#login-panel').hidden=true;$('#dashboard').hidden=false;$('#logout').hidden=false;
  $('#owner-email-label').textContent=email||session&&session.user&&session.user.email||'حساب المالك';
 }
 function showLogin(){session=null;$('#login-panel').hidden=false;$('#dashboard').hidden=true;$('#logout').hidden=true;}
 async function claimAndLoad(){
  say('جارٍ التحقق من وصول المالك…');
  let result;
  try{
   result=await ownerAction('claim-owner');
   if(result.owner!==true)throw Error('هذا البريد غير مفعّل كمالك للمنصة. استخدم طلب التفعيل أو الحساب المسجّل.');
  }catch(error){
   showLogin();
   say(error.message||'تعذر التحقق من حساب المالك.',true);
   return;
  }
  showDashboard(result.email||session&&session.user&&session.user.email);
  try{
   await loadDashboard();
   say('');
  }catch(error){
   console.error('Owner dashboard load failed:',error);
   say('تم تسجيل الدخول بنجاح، لكن تعذر تحميل جزء من لوحة المالك: '+(error.message||'خطأ غير معروف.'),true);
  }
 }
 async function loadDashboard(){
  const result=await Promise.all([ownerAction('list-tenants'),ownerAction('list-change-requests'),ownerAction('list-doctor-activation-requests')]);
  tenants=Array.isArray(result[0].tenants)?result[0].tenants:[];
  requests=Array.isArray(result[1].requests)?result[1].requests:[];
  doctorRequests=Array.isArray(result[2].requests)?result[2].requests:[];
  renderTenants();renderRequests();renderDoctorActivationRequests();renderMetrics();
  try{
   const maintenance=await ownerAction('list-owner-operations');
   $('#owner-maintenance').innerHTML=(maintenance.operations||[]).map(function(op){return '<p>'+esc(op.clinic_slug)+' · عملية غير مكتملة <button class="button outline" data-clean-provision="'+esc(op.id)+'">إعادة فحص وتنظيف الحساب</button></p>';}).join('')+(maintenance.receipts||[]).map(function(r){return '<p>'+esc(r.confirmation_name)+' · تنظيف الصور غير مكتمل <button class="button outline" data-clean-media="'+esc(r.id)+'">إعادة تنظيف الصور</button></p>';}).join('');
  }catch(error){
   console.warn('Owner maintenance section unavailable:',error);
   const node=$('#owner-maintenance');
   if(node)node.innerHTML='<p class="muted">قسم الصيانة غير متاح حاليًا. '+esc(error.message||'تعذر تحميل بيانات الصيانة.')+'</p>';
  }
 }
 function cairoToday(){
  const parts=new Intl.DateTimeFormat('en',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const values=Object.fromEntries(parts.filter(function(part){return part.type!=='literal';}).map(function(part){return [part.type,part.value];}));
  return values.year+'-'+values.month+'-'+values.day;
 }
 function cairoDateOffset(days){const date=new Date(cairoToday()+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
 function subscriptionExpired(t){const end=subscriptionEnd(t);return Boolean(end&&end<cairoToday());}
 function subscriptionExpiring(t){const end=subscriptionEnd(t);return Boolean(end&&!subscriptionExpired(t)&&end<=cairoDateOffset(30));}
 function renderMetrics(){
  const active=tenants.filter(function(t){return t.is_active&&!subscriptionExpired(t);}).length;
  const expiring=tenants.filter(subscriptionExpiring).length;
  const expired=tenants.filter(function(t){const end=subscriptionEnd(t);return Boolean(end&&subscriptionExpired(t));}).length;
  $('#summary-cards').innerHTML='<article class="summary-card"><span>إجمالي العيادات</span><strong>'+tenants.length+'</strong><small>كل حسابات الأطباء على المنصة</small></article><article class="summary-card"><span>عيادات متاحة الآن</span><strong>'+active+'</strong><small>مفعّلة واشتراكها ساري</small></article><article class="summary-card"><span>اشتراكات تنتهي خلال ٣٠ يومًا</span><strong>'+expiring+'</strong><small>تظهر مواعيدها داخل بطاقة كل عيادة</small></article><article class="summary-card"><span>اشتراكات منتهية</span><strong>'+expired+'</strong><small>الوصول يتوقف تلقائيًا بعد تاريخ القاهرة المسجل</small></article>';
 }
 function clinicHref(slug,doctor){return location.origin+'/clinic/index.html?clinic='+encodeURIComponent(slug)+(doctor?'&portal=doctor':'');}
 function subscriptionEnd(t){return t.subscription_ends_on||t.subscription_end||t.ends_on||t.subscription&&t.subscription.ends_on||'';}
 function renderTenants(){
  if(!tenants.length){$('#tenant-list').innerHTML='<div class="empty-card">لا توجد عيادات حتى الآن. أضف أول عيادة من الزر بالأعلى.</div>';return;}
  $('#tenant-list').innerHTML=tenants.map(function(t){
   const end=subscriptionEnd(t),expired=Boolean(end&&subscriptionExpired(t)),expiring=Boolean(end&&subscriptionExpiring(t));
   const activation=doctorRequests.find(function(r){return r.clinic_id===t.id;}),activationPending=activation&&activation.status==='pending';const state=activationPending?'<span class="status-pill warn">بانتظار قرار المالك</span>':!t.is_active?'<span class="status-pill off">موقوفة يدويًا</span>':expired?'<span class="status-pill off">انتهى الاشتراك</span>':expiring?'<span class="status-pill warn">ينتهي قريبًا</span>':'<span class="status-pill">مفعّلة</span>';
   return '<article class="tenant-card"><div class="tenant-top"><div><h3>'+esc(t.name)+'</h3><div class="tenant-slug">'+esc(t.slug)+'</div></div>'+state+'</div>'+
    '<div class="tenant-meta"><span>'+esc(t.specialty||'بدون تخصص')+'</span><span>الدكتور: '+esc(t.doctor_email||'—')+'</span><span>'+Number(t.service_count||0)+' خدمة</span></div>'+
    '<div class="tenant-links"><a target="_blank" rel="noopener" href="'+esc(clinicHref(t.slug,false))+'">رابط المريض</a><a target="_blank" rel="noopener" href="'+esc(clinicHref(t.slug,true))+'">دخول الدكتور</a></div>'+
    '<div class="tenant-actions"><label class="subscription-row">نهاية الاشتراك<input type="date" value="'+esc(end)+'" data-subscription-date="'+esc(t.id)+'"></label>'+
    '<button type="button" class="button outline" data-action="save-subscription" data-id="'+esc(t.id)+'">حفظ الاشتراك</button>'+
    '<button type="button" class="button edit" data-action="edit-clinic" data-id="'+esc(t.id)+'">تعديل</button>'+
    '<button type="button" class="button pause" data-action="toggle-active" data-id="'+esc(t.id)+'">'+(t.is_active?'إيقاف يدوي':'إعادة التفعيل')+'</button><button type="button" class="button danger" data-action="delete-clinic" data-id="'+esc(t.id)+'">حذف العيادة</button></div></article>';
  }).join('');
 }
 function renderRequests(){
  if(!requests.length){$('#request-list').innerHTML='<div class="empty-card">لا توجد طلبات تعديل.</div>';return;}
  $('#request-list').innerHTML=requests.map(function(r){
   return '<article class="request-card" data-request-card="'+esc(r.id)+'"><div class="request-meta">'+esc(r.clinic_name)+' · '+esc(r.doctor_email||'')+' · '+esc(r.created_at?new Date(r.created_at).toLocaleDateString('ar-EG'):'')+'</div>'+
    '<h3>'+esc(r.title)+'</h3><p>'+esc(r.details)+'</p><div class="request-controls"><label>الحالة<select data-request-status><option value="open" '+(r.status==='open'?'selected':'')+'>جديد</option><option value="in_progress" '+(r.status==='in_progress'?'selected':'')+'>قيد المتابعة</option><option value="resolved" '+(r.status==='resolved'?'selected':'')+'>تم الحل</option></select></label>'+
    '<label>ملاحظة المالك<textarea class="request-note" data-request-note maxlength="4000">'+esc(r.owner_note||'')+'</textarea></label><button class="button outline" type="button" data-action="save-request" data-id="'+esc(r.id)+'">حفظ حالة الطلب</button></div></article>';
  }).join('');
 }
 function renderDoctorActivationRequests(){
  if(!doctorRequests.length){$('#doctor-activation-list').innerHTML='<div class="empty-card">لا توجد طلبات تفعيل أطباء بانتظار المراجعة.</div>';return;}
  $('#doctor-activation-list').innerHTML=doctorRequests.map(function(r){
   const label=r.status==='pending'?'بانتظار قرارك':r.status==='approved'?'تم القبول والتفعيل':'تم الرفض';
   const badge=r.status==='approved'?'':' off';
   const actions=r.status==='pending'?'<div class="activation-actions"><button class="button primary" type="button" data-action="decide-doctor-activation" data-decision="approve" data-id="'+esc(r.id)+'">قبول وتفعيل</button><button class="button outline" type="button" data-action="decide-doctor-activation" data-decision="reject" data-id="'+esc(r.id)+'">رفض طلب التفعيل</button></div>':'';
   return '<article class="request-card"><div class="request-meta">'+esc(r.clinic_name)+' · '+esc(r.doctor_email||'')+' · '+esc(r.requested_at?new Date(r.requested_at).toLocaleDateString('ar-EG'):'')+'</div><h3>'+esc(r.doctor_name)+'</h3><p>'+esc(r.clinic_slug)+'</p><span class="status-pill'+badge+'">'+label+'</span>'+actions+'</article>';
  }).join('');
 }
 function addServiceRow(service){
  const item=service||{name:'',category:'normal',price:0,duration_minutes:20,priority:0,active:true};
  const row=document.createElement('div');row.className='service-editor-row';row.dataset.serviceRow='true';row.dataset.serviceId=item.id||'';
  row.innerHTML='<label><span>اسم الخدمة<span class="required-mark" aria-hidden="true">*</span></span><input data-field="name" maxlength="80" required value="'+esc(item.name)+'"></label><label>النوع<select data-field="category"><option value="normal">عادي</option><option value="urgent">مستعجل</option><option value="emergency">طوارئ</option><option value="followup">متابعة</option></select></label><label><span>السعر<span class="required-mark" aria-hidden="true">*</span></span><input data-field="price" type="number" min="0" max="100000" step="0.01" required value="'+esc(item.price)+'"></label><label><span>المدة بالدقائق<span class="required-mark" aria-hidden="true">*</span></span><input data-field="duration_minutes" type="number" min="5" max="180" required value="'+esc(item.duration_minutes)+'"></label><label><span>الأولوية<span class="required-mark" aria-hidden="true">*</span></span><input data-field="priority" type="number" min="0" max="100" required value="'+esc(item.priority)+'"></label><label>الحالة<select data-field="active"><option value="true">متاحة</option><option value="false">موقوفة</option></select></label><button class="remove" type="button" data-remove-service aria-label="حذف الخدمة">×</button>';
  $('#service-rows').appendChild(row);row.querySelector('[data-field=category]').value=item.category||'normal';row.querySelector('[data-field=active]').value=String(item.active!==false);
 }
 function readServices(){
  return $$('[data-service-row]',$('#service-rows')).map(function(row){
   return {id:row.dataset.serviceId||undefined,name:row.querySelector('[data-field=name]').value.trim(),category:row.querySelector('[data-field=category]').value,price:Number(row.querySelector('[data-field=price]').value),duration_minutes:Number(row.querySelector('[data-field=duration_minutes]').value),priority:Number(row.querySelector('[data-field=priority]').value),active:row.querySelector('[data-field=active]').value==='true'};
  }).filter(function(item){return item.name;});
 }
 function resetClinicForm(){
  creationId=null;editingClinic=null;$('#clinic-form').reset();$('#clinic-form').hidden=true;$('#clinic-error').hidden=true;$('#service-rows').innerHTML='';
  $$('.create-only').forEach(function(el){el.hidden=false;const input=$('input',el);if(input){input.disabled=false;input.required=true;}});
  $('#clinic-form-title').textContent='عيادة جديدة';$('#form-step-number').textContent='٠١';
 }
 function showClinicForm(tenant){
  creationId=null;editingClinic=tenant||null;$('#clinic-form').reset();$('#clinic-error').hidden=true;$('#clinic-form').hidden=false;
  const f=$('#clinic-form').elements;
  const value=tenant||{name:'',slug:'',specialty:'',address:'',tagline:'',about:'',template:'classic',photo_url:'',accent:'#087f7b',opens:'18:00',closes:'21:00',instapay:'',wallet:'',buffer_minutes:5,latitude:'',longitude:''};
  ['name','slug','specialty','address','tagline','about','template','photo_url','accent','opens','closes','instapay','wallet','buffer_minutes','latitude','longitude'].forEach(function(k){if(f[k])f[k].value=value[k]==null?'':value[k];});
  $$('.create-only').forEach(function(el){el.hidden=Boolean(tenant);const input=$('input',el);if(input){input.disabled=Boolean(tenant);input.required=!tenant;}});
  $('#clinic-form-title').textContent=tenant?'تعديل '+tenant.name:'إضافة عيادة جديدة';$('#form-step-number').textContent=tenant?'٠٢':'٠١';
  $('#service-rows').innerHTML='';(tenant&&Array.isArray(tenant.services)?tenant.services:defaults).forEach(addServiceRow);
  updateSlugPreview();$('#clinic-form').scrollIntoView({behavior:'smooth',block:'start'});
 }
 function updateSlugPreview(){
  const slug=$('#clinic-form').elements.slug.value.trim();
  const url=clinicHref(slug||'your-clinic',false),link=$('#slug-preview');
  link.href=url;link.textContent=url;
 }
 function normalizeEmail(value){return String(value||'').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,'').trim().toLowerCase();}\n function formClinic(){
  const f=$('#clinic-form').elements;
  return {slug:f.slug.value.trim(),name:f.name.value.trim(),specialty:f.specialty.value.trim(),address:f.address.value.trim(),tagline:f.tagline.value.trim(),about:f.about.value.trim(),template:f.template.value,photo_url:f.photo_url.value.trim(),accent:f.accent.value,opens:f.opens.value,closes:f.closes.value,instapay:f.instapay.value.trim(),wallet:f.wallet.value.trim(),buffer_minutes:Number(f.buffer_minutes.value),latitude:f.latitude.value.trim(),longitude:f.longitude.value.trim()};
 }
 async function uploadClinicPhoto(clinicId,file){
  if(!session)throw Error('سجّل دخول المالك أولًا.');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('اختار صورة JPG أو PNG أو WebP حتى ٥ ميجابايت.');
  if(session.expires_at*1000<Date.now()+60000)await refreshSession();
  const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type],path=clinicId+'/'+crypto.randomUUID()+'.'+ext;
  const response=await fetch(base+'/storage/v1/object/clinic-media/'+path,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+session.access_token,'Content-Type':file.type,'x-upsert':'false'},body:file});
  if(!response.ok)throw Error('تعذر رفع الصورة. تحقق من صيغة الملف وصلاحيات المالك.');
  return base+'/storage/v1/object/public/clinic-media/'+path;
 }
 async function saveClinic(event){
  event.preventDefault();if(creating)return;creating=true;const submit=event.target.querySelector('button[type=submit]');if(submit)submit.disabled=true;const error=$('#clinic-error');error.hidden=true;
  try{
   const clinic=formClinic(),services=readServices(),f=$('#clinic-form').elements;
   if(!/^[a-z0-9-]{3,80}$/.test(clinic.slug))throw Error('اكتب رابطًا من ٣ إلى ٨٠ حرفًا صغيرًا أو رقمًا أو شرطة.');
   if(clinic.name.length<2)throw Error('اكتب اسم العيادة.');
   if(clinic.opens>=clinic.closes)throw Error('نهاية العمل يجب أن تكون بعد بدايته.');
   if(/^https?:\/\//i.test(clinic.address)&&!/^(?:https:\/\/(?:www\.)?google\.com\/maps(?:\/|[?#])|https:\/\/maps\.google\.com\/|https:\/\/maps\.app\.goo\.gl\/)/i.test(clinic.address))throw Error('الصق رابط Google Maps أو اكتب العنوان كنص.');
   if(!services.length||services.length>20)throw Error('أضف خدمة واحدة على الأقل وبحد أقصى ٢٠ خدمة.');
   if(services.some(function(s){return !s.name||s.price<0||s.price>100000||s.duration_minutes<5||s.duration_minutes>180||s.priority<0||s.priority>100;}))throw Error('راجع أسماء الخدمات والأسعار والمدد والأولويات.');
   const payload=Object.assign({},clinic,{doctor_name:f.doctor_name.value.trim(),doctor_email:normalizeEmail(f.doctor_email.value)});
   if(editingClinic){
    await ownerAction('update-clinic',{clinic_id:editingClinic.id,clinic:payload,services:services});
    toast('تم حفظ إعدادات العيادة والخدمات.');
   }else{
    let created;try{created=await ownerAction('create-tenant',{operation_id:creationId||(creationId=crypto.randomUUID()),clinic:payload,services:services,initial_password:f.initial_password.value});}finally{f.initial_password.value='';}
    const id=created.tenant&&created.tenant.id;
    if(!id)throw Error('أُنشئ الحساب لكن تعذر تأكيد رقم العيادة. حدّث القائمة قبل المحاولة مرة أخرى.');
    // Creation saves profile and services in one database transaction.
    toast('أُنشئ حساب الدكتور بكلمة مرور أولية، والعيادة بانتظار موافقة التفعيل.');
   }
   resetClinicForm();await loadDashboard().catch(function(){toast('تم الحفظ، لكن تعذر تحديث القائمة. اضغط تحديث القائمة.');});
  }catch(errorValue){if(errorValue.retry_new)creationId=null;$('#cleanup-provision').hidden=!errorValue.cleanup_pending;error.textContent=errorValue.message||'تعذر حفظ العيادة.';error.hidden=false;error.scrollIntoView({block:'nearest'});}finally{creating=false;if(submit)submit.disabled=false;}
 }
 async function doTenantAction(button){
  const id=button.dataset.id,tenant=tenants.find(function(t){return t.id===id;});if(!tenant)return;
  if(button.dataset.action==='delete-clinic'){deleting=tenant;deletionId=crypto.randomUUID();$('#delete-name').textContent=tenant.name+' / '+tenant.slug;$('#delete-confirmation').value='';$('#delete-submit').disabled=true;$('#delete-error').textContent='';$('#delete-dialog').showModal();return;}
  if(button.dataset.action==='edit-clinic'){showClinicForm(tenant);return;}
  if(button.dataset.action==='toggle-active'){if(!tenant.is_active&&doctorRequests.some(function(r){return r.clinic_id===id&&r.status==='pending';}))throw Error('راجع طلب تفعيل الطبيب واختر القبول أو الرفض أولًا.');
   const isActive=!tenant.is_active;
   await ownerAction('set-clinic-active',{clinic_id:id,is_active:isActive});
   toast(isActive?'تمت إعادة تفعيل العيادة.':'تم إيقاف العيادة.');await loadDashboard();return;
  }
  if(button.dataset.action==='save-subscription'){
   const input=$('[data-subscription-date="'+CSS.escape(id)+'"]');
   await ownerAction('update-subscription',{clinic_id:id,ends_on:input.value||null});
   toast(input.value?'تم حفظ تاريخ نهاية الاشتراك.':'تم مسح تاريخ نهاية الاشتراك.');await loadDashboard();
  }
 }
 async function doRequestAction(button){
  const card=button.closest('[data-request-card]'),id=button.dataset.id;
  await ownerAction('update-change-request',{request_id:id,status:$('[data-request-status]',card).value,owner_note:$('[data-request-note]',card).value.trim()});
  toast('تم حفظ حالة الطلب.');await loadDashboard();
 }
 async function doDoctorActivationAction(button){
  const decision=button.dataset.decision;
  if(decision==='reject'&&!window.confirm('هل تريد رفض طلب التفعيل وإبقاء العيادة غير مفعلة؟'))return;
  await ownerAction('decide-doctor-activation',{request_id:button.dataset.id,decision:decision});
  toast(decision==='approve'?'تم قبول الطلب وتفعيل العيادة.':'تم رفض طلب التفعيل وبقيت العيادة غير مفعلة.');
  await loadDashboard();
 }
 async function run(action){
  try{await action();}catch(error){toast(error.message||'تعذر إتمام العملية.');}
 }
 $('#email-form').addEventListener('submit',function(event){
  event.preventDefault();const email=$('#owner-email').value.trim().toLowerCase();
  say('جارٍ طلب رابط دخول آمن…');
  run(async function(){await sendOwnerLink(email);say('لو الحساب موجود، هيوصلك رابط آمن لتعيين أو استعادة كلمة المرور. راجع البريد الوارد والرسائل غير المرغوب فيها.');});
 });
 $('#password-login').addEventListener('click',function(){
  const email=$('#owner-email').value.trim().toLowerCase(),password=$('#owner-password').value;
  if(!email||!password){say('اكتب البريد وكلمة المرور أولًا.',true);return;}
  say('جارٍ تسجيل الدخول…');
  run(async function(){try{await signInWithPassword(email,password);$('#owner-password').value='';}catch(error){say(error.message||'تعذر تسجيل الدخول.',true);}});
 });
 $('#password-form').addEventListener('submit',function(event){
  event.preventDefault();
  const password=$('#new-owner-password').value,confirmation=$('#confirm-owner-password').value,message=$('#password-message');
  if(password.length<14){message.textContent='كلمة المرور لازم تكون ١٤ حرفًا على الأقل.';message.classList.add('error');return;}
  if(password!==confirmation){message.textContent='كلمتا المرور غير متطابقتين.';message.classList.add('error');return;}
  message.textContent='جارٍ حفظ كلمة المرور…';message.classList.remove('error');
  run(async function(){try{await updateOwnerPassword(password);$('#password-form').reset();message.textContent='تم حفظ كلمة المرور. يمكنك استخدامها في تسجيل الدخول القادم.';message.classList.remove('error');}catch(error){message.textContent=error.message||'تعذر حفظ كلمة المرور.';message.classList.add('error');}});
 });
 $('#logout').addEventListener('click',function(){
  run(async function(){if(session)await fetch(base+'/auth/v1/logout',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+session.access_token}}).catch(function(){});showLogin();say('تم تسجيل الخروج.');});
 });
 $('#create-clinic').addEventListener('click',function(){showClinicForm(null);});
 $('#cancel-clinic').addEventListener('click',resetClinicForm);
 $('#cancel-clinic-bottom').addEventListener('click',resetClinicForm);
 $('#add-service').addEventListener('click',function(){addServiceRow();});
 $('#service-rows').addEventListener('click',function(event){const button=event.target.closest('[data-remove-service]');if(button){button.closest('.service-editor-row').remove();}});
 $('#clinic-form').elements.doctor_email.addEventListener('blur',function(event){event.target.value=normalizeEmail(event.target.value);});\n $('#clinic-form').elements.slug.addEventListener('input',updateSlugPreview);
 $('#clinic-form').elements.template.addEventListener('change',function(event){const colors={classic:'#087f7b',ocean:'#2563eb',violet:'#7c3aed'};$('#clinic-form').elements.accent.value=colors[event.target.value]||colors.classic;});
 $('#clinic-form').elements.photo_file?.addEventListener('change',function(event){
  const file=event.target.files&&event.target.files[0];if(!file)return;
  if(!editingClinic){toast('احفظ العيادة أولًا ثم ارفع صورتها من شاشة التعديل.');event.target.value='';return;}
  run(async function(){const url=await uploadClinicPhoto(editingClinic.id,file);$('#clinic-form').elements.photo_url.value=url;toast('تم رفع الصورة. اضغط حفظ لتحديث صفحة الدكتور.');});
 });
 $('#cleanup-provision').addEventListener('click',function(){run(async function(){const result=await ownerAction('cleanup-provision',{operation_id:creationId});creationId=null;$('#cleanup-provision').hidden=true;toast(result.cleaned?'تم تنظيف الحساب غير المكتمل. يمكنك إعادة الإنشاء.':'العيادة مكتملة؛ تم تأكيد الحالة.');await loadDashboard();});});
 $('#owner-maintenance').addEventListener('click',function(event){const button=event.target.closest('[data-clean-provision],[data-clean-media]');if(!button)return;run(async function(){await ownerAction(button.dataset.cleanProvision?'cleanup-provision':'cleanup-clinic-media',{operation_id:button.dataset.cleanProvision||button.dataset.cleanMedia});toast('تمت إعادة فحص العملية وتنظيف البيانات غير المكتملة.');await loadDashboard();});});
 $('#delete-cancel').addEventListener('click',function(){$('#delete-dialog').close();});
 $('#delete-confirmation').addEventListener('input',function(){const value=this.value.trim();$('#delete-submit').disabled=!deleting||![deleting.name,deleting.slug].includes(value);});
 $('#delete-form').addEventListener('submit',async function(event){event.preventDefault();const button=$('#delete-submit');if(button.disabled)return;button.disabled=true;$('#delete-error').textContent='';try{
  const result=await ownerAction('delete-clinic',{clinic_id:deleting.id,confirmation:$('#delete-confirmation').value.trim(),operation_id:deletionId});
  if(!result.deleted)throw Error('تعذر تأكيد الحذف.');
  tenants=tenants.filter(function(t){return t.id!==deleting.id;});renderTenants();$('#delete-dialog').close();
  toast(result.media_pending?'حُذفت بيانات العيادة. تنظيف ملفات الصور لم يكتمل؛ استخدم إعادة تنظيف الملفات.':'تم حذف العيادة وبياناتها المرتبطة.');
  if(result.media_pending){$('#cleanup-media').hidden=false;$('#cleanup-media').dataset.operationId=deletionId;}
  await loadDashboard().catch(function(){toast('تم الحذف، لكن تعذر تحديث القائمة.');});
 }catch(error){$('#delete-error').textContent=error.message;}finally{button.disabled=false;}});
 $('#cleanup-media').addEventListener('click',function(event){const button=event.currentTarget;run(async function(){const result=await ownerAction('cleanup-clinic-media',{operation_id:button.dataset.operationId});if(result.media_pending)throw Error('تعذر تنظيف ملفات الصور. حاول لاحقًا.');button.hidden=true;toast('تم تنظيف ملفات الصور.');});});
 $('#clinic-form').addEventListener('submit',saveClinic);
 $('#tenant-list').addEventListener('click',function(event){const button=event.target.closest('[data-action]');if(!button)return;run(function(){return doTenantAction(button);});});
 $('#request-list').addEventListener('click',function(event){const button=event.target.closest('[data-action=save-request]');if(button)run(function(){return doRequestAction(button);});});
 $('#doctor-activation-list').addEventListener('click',function(event){const button=event.target.closest('[data-action=decide-doctor-activation]');if(button)run(function(){return doDoctorActivationAction(button);});});
 async function start(){
  if(!base||!key){say('Supabase غير مربوط بهذه النسخة.');return;}
  try{
   if(captureLinkSession()){await claimAndLoad();return;}
   const params=new URLSearchParams(location.search);
   if(params.get('error')){say('تعذر التحقق من رابط البريد. اطلب رابطًا جديدًا.',true);return;}
   if(params.get('owner')==='1')say('افتح رابط التفعيل من البريد على هذا النطاق ثم ارجع لهذه الصفحة.');
  }catch(error){say(error.message||'تعذر قراءة رابط التفعيل.',true);}
 }
 void start();
})();
