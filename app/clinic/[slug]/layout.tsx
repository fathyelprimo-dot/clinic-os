import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { Cairo } from 'next/font/google'

const cairo = Cairo({ subsets: ['arabic', 'latin'] })

export default async function ClinicLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { slug: string }
}) {
  const supabase = await createClient()

  // Verify clinic exists
  const { data: clinic, error } = await supabase
    .from('clinics')
    .select('id, name, slug, specialty, logo_url, is_active')
    .eq('slug', params.slug)
    .single()

  if (error || !clinic) {
    notFound()
  }

  return (
    <div className={`min-h-screen bg-gray-50 text-gray-900 ${cairo.className}`} dir="rtl">
      {/* Shared Clinic Header could go here */}
      <main>{children}</main>
    </div>
  )
}
