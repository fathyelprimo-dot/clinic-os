(function(root){
 'use strict';
 const normalizePhone=s=>String(s).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\s/g,'').replace(/^\+20/,'0');
 const cairoDate=(date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
 const serviceDefaults=[{id:'normal',name:'كشف عادي',price:350,duration_minutes:20,priority:0,category:'normal',active:true},{id:'urgent',name:'كشف مستعجل',price:500,duration_minutes:20,priority:10,category:'urgent',active:true},{id:'emergency',name:'طوارئ',price:650,duration_minutes:30,priority:20,category:'emergency',active:true},{id:'followup',name:'متابعة',price:200,duration_minutes:15,priority:0,category:'followup',active:true}];
 function validateService(s){if(!s.name?.trim()||s.name.length>80)throw Error('اكتب اسم الخدمة بحد أقصى ٨٠ حرفًا.');if(!Number.isFinite(+s.price)||+s.price<0||+s.price>100000)throw Error('السعر غير صالح.');if(!Number.isInteger(+s.duration_minutes)||+s.duration_minutes<5||+s.duration_minutes>180)throw Error('مدة الخدمة من ٥ إلى ١٨٠ دقيقة.');if(!Number.isInteger(+s.priority)||+s.priority<0||+s.priority>100)throw Error('الأولوية من صفر إلى ١٠٠.');if(!['normal','urgent','emergency','followup'].includes(s.category))throw Error('نوع الخدمة غير صالح.');return s;}
 function learnedDuration(b,history){const samples=history.filter(x=>x.service_id===b.service_id&&x.status==='done'&&x.started_at&&x.finished_at).slice(-20).map(x=>(Date.parse(x.finished_at)-Date.parse(x.started_at))/60000).filter(n=>n>=1&&n<=240);const base=+b.duration_minutes;return samples.length>=3?Math.max(base*.5,Math.min(base*3,samples.reduce((a,b)=>a+b,0)/samples.length)):base;}
 function estimates(bookings,{now=Date.now(),paused=false,buffer=5,arrivalGrace=15}={}){
   if(paused)return Object.fromEntries(bookings.map(b=>[b.id,{minutes:null,reason:'paused'}]));
   const result={},graceMs=Math.max(0,Number(arrivalGrace)||0)*60000;
   const inside=bookings.filter(b=>b.status==='inside'),waiting=bookings.filter(b=>b.status==='waiting'&&b.triage!=='pending');
   let cursor=now;
   for(const b of inside){const remaining=Math.max(3,learnedDuration(b,bookings)-(now-Date.parse(b.started_at||new Date(now).toISOString()))/60000);result[b.id]={minutes:0,low:0,high:0};cursor+=remaining*60000;}
   const pending=[];
   for(const b of waiting){const scheduled=Date.parse(b.scheduled_at);if(!b.arrived&&scheduled<now-graceMs){result[b.id]={minutes:null,reason:'arrival'};continue;}pending.push({...b});}
   const readyAt=b=>b.arrived?now:Date.parse(b.scheduled_at);
   while(pending.length){pending.sort((a,b)=>Math.max(readyAt(a),cursor)-Math.max(readyAt(b),cursor)||b.priority-a.priority||Date.parse(a.scheduled_at)-Date.parse(b.scheduled_at)||String(a.id).localeCompare(String(b.id)));const b=pending.shift();cursor=Math.max(cursor,readyAt(b));const m=Math.max(0,Math.ceil((cursor-now)/60000));result[b.id]={minutes:m,low:Math.max(0,m-buffer),high:m+buffer,leaveIn:b.arrived?null:Math.max(0,m-(b.travel_minutes||0)-buffer),expectedAt:new Date(cursor).toISOString()};cursor+=learnedDuration(b,bookings)*60000;}
   for(const b of bookings.filter(b=>b.triage==='pending'))result[b.id]={minutes:null,reason:'triage'};
   return result;
  }
function formatDuration(minutes){if(minutes==null||!Number.isFinite(Number(minutes)))return '—';const total=Math.max(0,Math.ceil(Number(minutes)));if(total===0)return 'الآن';const days=Math.floor(total/1440),hours=Math.floor(total%1440/60),mins=total%60,fmt=n=>new Intl.NumberFormat('ar-EG').format(n),parts=[];if(days)parts.push(days===1?'يوم':days===2?'يومين':fmt(days)+' أيام');if(hours)parts.push(hours===1?'ساعة':hours===2?'ساعتين':fmt(hours)+' ساعات');if(mins)parts.push(mins===1?'دقيقة':mins===2?'دقيقتين':fmt(mins)+' دقيقة');return parts.join(' و ');}
 function isMapsLink(value){try{const u=new URL(String(value||'')),h=u.hostname.toLowerCase();return u.protocol==='https:'&&(h==='maps.app.goo.gl'||h==='maps.google.com'||h==='google.com'&&u.pathname.startsWith('/maps')||h==='www.google.com'&&u.pathname.startsWith('/maps'));}catch{return false;}}
 function mapsUrl(clinic){if(isMapsLink(clinic.address))return new URL(clinic.address).href;if(Number.isFinite(clinic.latitude)&&Number.isFinite(clinic.longitude))return 'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(clinic.latitude+','+clinic.longitude);return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(clinic.address||clinic.name);}
 function cairoInstant(date,time){const target=Date.parse(date+'T'+time+':00Z');let instant=target;for(let i=0;i<3;i++){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).map(p=>[p.type,p.value]));const local=Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);instant+=target-local;}return new Date(instant).toISOString();}
 function availableSlots(clinic,service,date,bookings=[],now=Date.now()){
  if(!service?.active)return [];
  const [oh,om]=clinic.opens.split(':').map(Number),[ch,cm]=clinic.closes.split(':').map(Number),duration=Number(service.duration_minutes),result=[];
  if(!Number.isFinite(duration)||duration<5)return result;
  for(let minute=oh*60+om;minute+duration<=ch*60+cm;minute+=5){
   const label=String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0'),stamp=Date.parse(cairoInstant(date,label));
   if(stamp<=now)continue;
   const occupied=bookings.some(b=>b.status!=='cancelled'&&stamp<Date.parse(b.scheduled_at)+b.duration_minutes*60000&&stamp+duration*60000>Date.parse(b.scheduled_at));
   if(!occupied)result.push(label);
  }
  return result;
 }
 function formatTime(value){
    const raw=String(value??''),match=raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/),date=match?new Date(Date.UTC(2000,0,1,Number(match[1]),Number(match[2]))):new Date(value);
    return new Intl.DateTimeFormat('ar-EG',{timeZone:match?'UTC':'Africa/Cairo',hour:'numeric',minute:'2-digit',hourCycle:'h12'}).format(date);
  }
  root.ClinicDomain={normalizePhone,cairoDate,cairoInstant,serviceDefaults,validateService,estimates,formatDuration,formatTime,isMapsLink,mapsUrl,availableSlots};
})(globalThis);
