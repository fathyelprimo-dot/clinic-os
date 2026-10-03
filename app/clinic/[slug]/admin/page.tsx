import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AdminDashboard } from '@/components/clinic/AdminDashboard'

export default async function AdminPage({ params }: { params: { slug: string } }) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/clinic/${params.slug}/login`)
  }

  const { data: clinic } = await supabase
    .from('clinics')
    .select('*')
    .eq('slug', params.slug)
    .single()

  return (
    <AdminDashboard clinic={clinic} />
  )
}
