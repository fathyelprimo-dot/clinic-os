// Deploy with JWT verification disabled ONLY because this endpoint enforces a separate
// server-to-server bearer secret. Never put any of these variables in dist/config.js.
declare const Deno:{env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):void};
const env=(name:string)=>{const value=Deno.env.get(name);if(!value)throw new Error('Missing server configuration');return value;};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
Deno.serve(async request=>{
 if(request.method!=='POST')return reply(405,{error:'Method not allowed'});
 const secret=Deno.env.get('DISPATCH_SECRET');
 if(!secret||request.headers.get('Authorization')!=='Bearer '+secret)return reply(401,{error:'Unauthorized'});
 try{
  const endpoint=new URL(env('NOTIFICATION_WEBHOOK_URL'));env('NOTIFICATION_WEBHOOK_TOKEN');if(endpoint.protocol!=='https:')return reply(503,{error:'Provider not configured'});
  const rpc=async(name:string,body:unknown={})=>{const response=await fetch(env('SUPABASE_URL')+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:env('SUPABASE_SERVICE_ROLE_KEY'),Authorization:'Bearer '+env('SUPABASE_SERVICE_ROLE_KEY'),'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Database call failed');return response.status===204?null:response.json();};
  await rpc('generate_reminders');
  const jobs=await rpc('claim_notifications') as {id:string;lease:string;phone:string;message:string}[];
  let sent=0;
  // Maximum 20 jobs, bounded parallelism, deterministic idempotency key for provider deduplication.
  for(let start=0;start<jobs.length;start+=5)await Promise.all(jobs.slice(start,start+5).map(async job=>{let ok=false;try{const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+env('NOTIFICATION_WEBHOOK_TOKEN'),'Content-Type':'application/json','Idempotency-Key':job.id},body:JSON.stringify({to:'+20'+job.phone.slice(1),message:job.message,reference:job.id}),signal:AbortSignal.timeout(10000),redirect:'error'});ok=response.ok;}catch{}await rpc('finish_notification',{p_id:job.id,p_lease:job.lease,p_success:ok});if(ok)sent++;}));
  return reply(200,{processed:jobs.length,sent});
 }catch{return reply(503,{error:'Notification dispatch unavailable'});}
});
