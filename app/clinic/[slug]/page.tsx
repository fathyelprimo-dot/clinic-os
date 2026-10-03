import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { BookingForm } from '@/components/clinic/BookingForm'

export default async function ClinicPage({ params }: { params: { slug: string } }) {
  const supabase = await createClient()

  // Fetch clinic info
  const { data: clinic, error } = await supabase
    .from('clinics')
    .select('*')
    .eq('slug', params.slug)
    .single()

  if (error || !clinic) {
    notFound()
  }

  // Fetch active services
  const { data: services } = await supabase
    .from('services')
    .select('*')
    .eq('clinic_id', clinic.id)
    .eq('active', true)
    .order('priority', { ascending: false })

  return (
    <div>
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex justify-between items-center shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-primary">{clinic.name}</h1>
          <p className="text-sm text-gray-500">{clinic.specialty}</p>
        </div>
        <div className="flex gap-4">
          <Link href={`/clinic/${clinic.slug}/login`}>
            <Button variant="outline" className="font-semibold text-primary">إدارة العيادة</Button>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto p-4 md:p-8 mt-4 space-y-8">
        {/* Welcome Section */}
        <section className="text-center space-y-4 mb-10">
          <p className="text-lg text-gray-600 max-w-2xl mx-auto leading-relaxed">
            {clinic.tagline || 'مرحباً بك في العيادة. احجز موعدك الآن بكل سهولة وتتبع دورك مباشرة.'}
          </p>
        </section>

        {/* Booking Section */}
        <section>
          {services && services.length > 0 ? (
            <BookingForm clinic={clinic} services={services} />
          ) : (
            <div className="text-center py-12 bg-white rounded-lg border">
              <p className="text-gray-500">لا توجد خدمات متاحة للحجز حالياً.</p>
            </div>
          )}
        </section>

      </main>
    </div>
  )
}
