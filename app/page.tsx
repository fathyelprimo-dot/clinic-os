'use client';
import {useEffect} from 'react';
export default function Home() {
  useEffect(()=>{const q=new URLSearchParams(location.search),h=new URLSearchParams(location.hash.slice(1));if(h.get('type')==='recovery'||q.get('type')==='recovery'||q.get('reset')==='1'||h.has('error')||q.has('error')||q.has('token_hash')||q.has('code'))location.replace('/clinic/reset-password.html'+location.search+location.hash);},[]);
  return (
    <iframe
      src="/owner.html"
      title="لوحة مالك Clinic OS"
      style={{ border: 0, width: "100%", height: "100dvh", display: "block" }}
    />
  );
}
