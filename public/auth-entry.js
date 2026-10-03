// Recover callbacks arriving at a Site URL fallback or an old clinic URL.
(function(){const q=new URLSearchParams(location.search),h=new URLSearchParams(location.hash.slice(1));
 // Owner recovery links are also used by the existing owner sign-in flow.
 if(q.get('owner')==='1'&&/^\/owner(?:\.html)?$/.test(location.pathname))return;
 if(h.get('type')==='recovery'||q.get('type')==='recovery'||q.get('reset')==='1'||h.has('error')||q.has('token_hash')||q.has('code')){
  const target=new URL('/clinic/reset-password.html',location.origin);target.search=location.search;target.hash=location.hash;
  // Transfer only to our own origin; never put credentials into an iframe URL or a log.
  location.replace(target.href);
 }
})();
