(function(){
 'use strict';
 const config=globalThis.CLINIC_CONFIG,api=new ClinicAPI(config),params=new URLSearchParams(location.search),hash=new URLSearchParams(location.hash.slice(1));
 const slug=params.get('clinic')||'',form=document.querySelector('#reset-form'),request=document.querySelector('#request-form'),message=document.querySelector('#reset-message');
 const login=new URL('/clinic/index.html',location.origin);login.searchParams.set('portal','doctor');if(slug)login.searchParams.set('clinic',slug);
 document.querySelector('#login-link').href=login.href;
 const invalid='رابط الاستعادة غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا وافتح أحدث رسالة مرة واحدة.';
 const uniform='إذا كان البريد مسجّلًا ومتاحًا للاستعادة، ستصلك رسالة برابط آمن. راجع البريد غير المرغوب فيه أو حاول لاحقًا.';
 async function boot(){
  const token=params.get('token_hash')||hash.get('token_hash'),type=params.get('type')||hash.get('type'),access=hash.get('access_token'),refresh=hash.get('refresh_token');
  // Remove credentials even when the link is invalid, before making any request.
  history.replaceState({},'',location.pathname+(slug?'?clinic='+encodeURIComponent(slug):''));
  try{
   if(params.get('error')||hash.get('error')||params.get('code')||type!=='recovery')throw Error(invalid);
   if(token){api.setSession(await api.request('/auth/v1/verify',{method:'POST',body:{token_hash:token,type:'recovery'},auth:false}));}
   else if(access&&refresh){api.setSession({access_token:access,refresh_token:refresh,expires_in:hash.get('expires_in')});}
   else throw Error(invalid);
   await api.request('/auth/v1/user');
   message.textContent='اختر كلمة مرور قوية جديدة لحسابك.';form.hidden=false;request.hidden=true;
  }catch{api.session=null;message.textContent=invalid;request.hidden=false;}
 }
 let busy=false;
 form.addEventListener('submit',async function(event){event.preventDefault();if(busy)return;const f=form.elements;if(f.password.value!==f.confirm.value){message.textContent='كلمتا المرور غير متطابقتين.';return;}busy=true;const button=form.querySelector('button');button.disabled=true;
  try{await api.changePassword(f.password.value);form.reset();await api.logout().catch(()=>{});message.textContent='تم تغيير كلمة المرور. جارٍ الانتقال إلى تسجيل الدخول.';login.searchParams.set('password_changed','1');location.replace(login.href);}
  catch{message.textContent='تعذر تغيير كلمة المرور. تحقق من الاتصال وقوة كلمة المرور؛ إذا انتهت الجلسة اطلب رابطًا جديدًا.';request.hidden=false;}
  finally{f.password.value='';f.confirm.value='';busy=false;button.disabled=false;}
 });
 request.addEventListener('submit',async function(event){event.preventDefault();if(busy)return;busy=true;const button=request.querySelector('button');button.disabled=true;try{await api.resetDoctorPassword(request.elements.email.value);message.textContent=uniform;}finally{busy=false;button.disabled=false;}});
 void boot();
})();
