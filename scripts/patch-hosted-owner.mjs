// The existing Site has a separate source repository and older owner UI.
// Apply the same contracts without replacing its HTML layout or styles.
import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(process.argv[2]||'.');
const file=path.join(root,'public/owner.js');let s=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
if(s.includes('function clearOwnerAccess()'))throw Error('Owner repair already applied; preserve existing changes.');
if(!s.includes('async function keepSessionFresh()')||!s.includes("$('#tenant-list-body')"))throw Error('Unexpected Site owner source; inspect before patching.');
const first=s.indexOf('  async function keepSessionFresh()'),last=s.indexOf('  async function claimOwner()',first);
s=s.slice(0,first)+`  let refreshing=null,generation=0;
  function clearOwnerAccess(){generation++;state.session=null;state.tenants=[];state.changeRequests=[];setScreen(false);$('#tenant-list-body').innerHTML='';$('#change-request-list').innerHTML='';$('#owner-activation-list').innerHTML='';$('#owner-maintenance-list').innerHTML='';$('#owner-auth-retry').hidden=true;showMessage($('#login-message'),'انتهت الجلسة أو لا يملك الحساب صلاحية المالك. سجّل الدخول مرة أخرى.');}
  async function keepSessionFresh(force=false){
    if(!state.session)throw Object.assign(Error('انتهت الجلسة. سجّل الدخول مرة أخرى.'),{status:401});
    if(!force&&state.session.expires_at*1000>Date.now()+60000)return;
    if(refreshing)return refreshing;
    const session=state.session,version=generation;
    refreshing=(async()=>{try{
      const response=await fetch(authUrl('/auth/v1/token?grant_type=refresh_token'),{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});
      const result=await response.json().catch(()=>null);
      if(!response.ok){const error=Object.assign(Error('تعذر تجديد الجلسة. حاول مرة أخرى.'),{status:response.status});if([400,401,403].includes(response.status)&&version===generation){clearOwnerAccess();error.status=401;}throw error;}
      if(version!==generation)throw Error('تغيّرت الجلسة.');
      state.session={...result,expires_at:result.expires_at||Math.floor(Date.now()/1000)+Number(result.expires_in||3600),user:result.user||session.user};
    }finally{refreshing=null;}})();return refreshing;
  }
  async function callAdmin(action,data={},retried=false){
    const version=generation;await keepSessionFresh();
    if(version!==generation||!state.session)throw Error('تغيّرت الجلسة.');
    const response=await fetch(authUrl('/functions/v1/clinic-platform-admin'),{method:'POST',headers:{apikey:config.publishableKey,Authorization:'Bearer '+state.session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action,...data})});
    const result=await response.json().catch(()=>({}));
    if(version!==generation||!state.session)throw Error('تغيّرت الجلسة.');
    if(response.status===401&&!retried){await keepSessionFresh(true);return callAdmin(action,data,true);}
    if(!response.ok){let message=result.error||'تعذر إكمال الطلب. حاول مرة أخرى.';if(/\\?{3,}|\\uFFFD/.test(message))message='تعذر تحميل البيانات من الخادم. حاول مرة أخرى.';const error=Object.assign(Error(message),{status:response.status,code:result.code,retry_new:result.retry_new});if([401,403].includes(response.status))clearOwnerAccess();throw error;}
    return result;
  }

`+s.slice(last);
s=s.replace("if (!result.owner) throw Error('هذا البريد غير مفعّل كمالك للمنصة.');", "if (!result.owner){clearOwnerAccess();throw Object.assign(Error('هذا البريد غير مفعّل كمالك للمنصة.'),{status:403});}");
s=s.replace("      state.session = null;\n      showMessage($('#login-message')", "      if([401,403].includes(error.status))clearOwnerAccess();else if(state.session)$('#owner-auth-retry').hidden=false;\n      showMessage($('#login-message')");
s=s.replace('    state.session = null;\n    state.tenants = [];', '    generation++;\n    state.session = null;\n    state.tenants = [];');
s=s.replace("    list.innerHTML = '<div class=\"loading-card\"><span class=\"loader\"></span> بنحمّل بيانات المنصة من Supabase…</div>';", "    const version=generation;['#tenant-count','#published-count','#doctor-count'].forEach(id=>$(id).textContent='—');\n    list.innerHTML = '<div class=\"loading-card\"><span class=\"loader\"></span> بنحمّل بيانات المنصة من Supabase…</div>';");
s=s.replace("      state.tenants = Array.isArray(result.tenants) ? result.tenants : [];", "      if(version!==generation||!state.session)return;\n      if(!Array.isArray(result.tenants))throw Error('تعذر تأكيد بيانات العيادات.');\n      state.tenants = result.tenants;");
s=s.replace("      list.innerHTML = '<div class=\"empty-card\"><span>!</span><strong>محتاجين نراجع إعدادات المالك</strong><p>' + escapeHTML(error.message) + '</p></div>';", "      if(version!==generation||!state.session)return;\n      list.innerHTML = '<div class=\"empty-card\" role=\"alert\"><span>!</span><strong>تعذر تحميل العيادات</strong><p>تحقق من الاتصال ثم أعد المحاولة.</p><button type=\"button\" class=\"owner-button\" data-owner-retry=\"tenants\">إعادة المحاولة</button></div>';");
s=s.replace("    list.innerHTML = '<div class=\"loading-card\"><span class=\"loader\"></span> بنحمّل طلبات التعديل…</div>';", "    const version=generation;$('#open-request-count').textContent='—';\n    list.innerHTML = '<div class=\"loading-card\"><span class=\"loader\"></span> بنحمّل طلبات التعديل…</div>';");
s=s.replace('      state.changeRequests = Array.isArray(result.requests) ? result.requests : [];',"      if(version!==generation||!state.session)return;\n      if(!Array.isArray(result.requests))throw Error('تعذر تأكيد بيانات الطلبات.');\n      state.changeRequests = result.requests;");
s=s.replace("      list.innerHTML = '<div class=\"empty-card\"><span>!</span><strong>تعذر تحميل طلبات التعديل</strong><p>' + escapeHTML(error.message) + '</p></div>';", "      if(version!==generation||!state.session)return;\n      list.innerHTML = '<div class=\"empty-card\" role=\"alert\"><strong>تعذر تحميل طلبات التعديل</strong><p>تحقق من الاتصال ثم أعد المحاولة.</p><button type=\"button\" class=\"owner-button\" data-owner-retry=\"requests\">إعادة المحاولة</button></div>';");
// Align clinic creation with the deployed password + journal contract.
s=s.replace('      data = collectTenant();',"      data = collectTenant();\n      data.initial_password=$('#tenant-form').elements.initial_password.value;\n      data.operation_id=state.creationId||(state.creationId=crypto.randomUUID());");
s=s.replace("      toast('اتضافت العيادة، واتبعثت دعوة الدكتور على البريد.');", "      state.creationId=null;toast('أُنشئ حساب الدكتور والعيادة بانتظار قرار التفعيل.');");
s=s.replace("      showMessage($('#tenant-message'), error.message || 'تعذر إضافة العيادة.');", "      if(error.retry_new)state.creationId=null;showMessage($('#tenant-message'), error.message || 'تعذر إضافة العيادة.');");
s=s.replace("button.textContent = 'جارٍ إنشاء العيادة وإرسال الدعوة…';", "button.textContent = 'جارٍ إنشاء العيادة وحساب الدكتور…';");
s=s.replace("      button.innerHTML = 'إنشاء العيادة وإرسال الدعوة <span>←</span>';", "      $('#tenant-form').elements.initial_password.value='';\n      button.innerHTML = 'إنشاء العيادة وحساب الدكتور <span>←</span>';");
const extra=`
  const authRetry=document.createElement('button');authRetry.id='owner-auth-retry';authRetry.type='button';authRetry.className='owner-button';authRetry.hidden=true;authRetry.textContent='إعادة التحقق';$('#login-message').after(authRetry);
  authRetry.addEventListener('click',async()=>{authRetry.hidden=true;try{await openOwnerDashboard();}catch(error){showMessage($('#login-message'),error.message);if(state.session)authRetry.hidden=false;}});
  document.addEventListener('click',event=>{const retry=event.target.closest('[data-owner-retry]');if(retry)void(retry.dataset.ownerRetry==='tenants'?refreshTenants():retry.dataset.ownerRetry==='requests'?refreshChangeRequests():refreshOwnerAuxiliary(retry.dataset.ownerRetry));});
  const auxiliary=document.createElement('section');auxiliary.innerHTML='<h2>طلبات تفعيل الأطباء</h2><div id="owner-activation-list" class="request-list"></div><h2>عمليات الصيانة</h2><div id="owner-maintenance-list" class="request-list"></div>';$('#change-request-list').after(auxiliary);
  async function refreshOwnerAuxiliary(name){
    if(state.demo)return;const version=generation,node=$(name==='doctors'?'#owner-activation-list':'#owner-maintenance-list');node.textContent='جارٍ التحميل…';
    try{const result=await callAdmin(name==='doctors'?'list-doctor-activation-requests':'list-owner-operations');if(version!==generation||!state.session)return;
      if(name==='doctors'){if(!Array.isArray(result.requests))throw Error('بيانات غير مكتملة.');node.innerHTML=result.requests.map(r=>'<article class="change-request-card"><strong>'+escapeHTML(r.clinic_name)+'</strong><p>'+escapeHTML(r.doctor_name)+'</p><span>'+escapeHTML(r.status)+'</span>'+(r.status==='pending'?'<button class="owner-button" data-owner-decision="approve" data-id="'+escapeHTML(r.id)+'">قبول وتفعيل</button><button class="owner-button" data-owner-decision="reject" data-id="'+escapeHTML(r.id)+'">رفض</button>':'')+'</article>').join('')||'لا توجد طلبات تفعيل.';}
      else{if(!Array.isArray(result.operations)||!Array.isArray(result.receipts))throw Error('بيانات غير مكتملة.');node.innerHTML=result.operations.map(op=>'<p>'+escapeHTML(op.clinic_slug)+' <button class="owner-button" data-owner-clean="cleanup-provision" data-id="'+escapeHTML(op.id)+'">إعادة فحص العملية</button></p>').join('')+result.receipts.map(op=>'<p>'+escapeHTML(op.confirmation_name)+' <button class="owner-button" data-owner-clean="cleanup-clinic-media" data-id="'+escapeHTML(op.id)+'">إعادة تنظيف الصور</button></p>').join('');}
    }catch{if(version!==generation||!state.session)return;node.innerHTML='<p role="alert">تعذر تحميل القسم. <button type="button" class="owner-button" data-owner-retry="'+name+'">إعادة المحاولة</button></p>';}
  }
  document.addEventListener('click',async event=>{const button=event.target.closest('[data-owner-decision],[data-owner-clean]');if(!button)return;button.disabled=true;try{if(button.dataset.ownerDecision)await callAdmin('decide-doctor-activation',{request_id:button.dataset.id,decision:button.dataset.ownerDecision});else await callAdmin(button.dataset.ownerClean,{operation_id:button.dataset.id});await Promise.all([refreshTenants(),refreshOwnerAuxiliary('doctors'),refreshOwnerAuxiliary('maintenance')]);}catch(error){toast(error.message);}finally{button.disabled=false;}});
`;
s=s.replace("  const invite = new URLSearchParams(location.hash.slice(1));",extra+"\n  const invite = new URLSearchParams(location.hash.slice(1));");
s=s.replaceAll('Promise.all([refreshTenants(), refreshChangeRequests()])',"Promise.all([refreshTenants(), refreshChangeRequests(),refreshOwnerAuxiliary('doctors'),refreshOwnerAuxiliary('maintenance')])");
if(!s.includes("if([401,403].includes(error.status))clearOwnerAccess();else if(state.session)$('#owner-auth-retry').hidden=false;"))throw Error('Login handler was not repaired.');
fs.writeFileSync(file,s);
const htmlFile=path.join(root,'public/owner.html');let html=fs.readFileSync(htmlFile,'utf8');
html=html.replace('</head>','  <style>#owner-auth-retry[hidden]{display:none}</style>\n</head>');
html=html.replace('      <div class="service-list" id="service-list">', '      <label>كلمة المرور الأولية للدكتور<input name="initial_password" type="password" required minlength="12" maxlength="128" autocomplete="new-password" dir="ltr"><small>سلّمها للدكتور بطريقة آمنة. لن تُعرض مرة أخرى.</small></label>\n      <div class="service-list" id="service-list">');
html=html.replaceAll('إنشاء العيادة وإرسال الدعوة','إنشاء العيادة وحساب الدكتور');
fs.writeFileSync(htmlFile,html);
console.log('Existing Site owner logic repaired; original layout and styles preserved.');
