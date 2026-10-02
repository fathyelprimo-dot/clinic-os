'use client';
import {useEffect,useState} from 'react';
// Both entry points use the same UI and Supabase/RLS adapter.
export default function ClinicApp(){const [src,setSrc]=useState<string|null>(null);useEffect(()=>setSrc('/clinic/index.html'+window.location.search),[]);return src?<iframe src={src} title="Clinic OS" style={{border:0,width:'100%',height:'100dvh',display:'block'}}/>:null;}
