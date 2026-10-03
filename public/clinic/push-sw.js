/* global self */
'use strict';
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{};}catch{data={body:'هناك تحديث لموعدك. افتح العيادة.'};}
 const url=new URL(data.url||'/clinic/index.html',self.location.origin);
 const safeUrl=url.origin===self.location.origin&&url.pathname.endsWith('/index.html')?url.href:self.location.origin+'/clinic/index.html';
 event.waitUntil(self.registration.showNotification('Clinic OS',{body:String(data.body||'هناك تحديث لموعدك.').slice(0,300),tag:String(data.tag||'clinic-update'),data:{url:safeUrl}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil(self.clients.openWindow(event.notification.data.url));
});
