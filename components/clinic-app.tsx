'use client';
import {useSyncExternalStore} from 'react';
// Both entry points use the same UI and Supabase/RLS adapter.
const subscribeToSearch=()=>()=>{};
const getSearch=()=>window.location.search;
const getServerSearch=()=>'';
export default function ClinicApp(){const search=useSyncExternalStore(subscribeToSearch,getSearch,getServerSearch);return <iframe src={'/clinic/index.html'+search} title="Clinic OS" style={{border:0,width:'100%',height:'100dvh',display:'block'}}/>;}
