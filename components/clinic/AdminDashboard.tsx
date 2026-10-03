'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { LogOut, UserCheck, Play, CheckCircle, XCircle } from 'lucide-react'

export function AdminDashboard({ clinic }: { clinic: any }) {
  const [bookings, setBookings] = useState<unknown[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetchBookings() {
      try {
        const today = new Date().toISOString().split('T')[0]
        const { data, error } = await supabase
          .from('appointments')
          .select(`
            *,
            patients:patient_id (name, phone),
            services:service_id (name)
          `)
          .eq('clinic_id', clinic.id)
          .gte('scheduled_at', `${today}T00:00:00Z`)
          .lte('scheduled_at', `${today}T23:59:59Z`)
          .order('scheduled_at', { ascending: true })
  
        if (error) throw error
        setBookings(data || [])
      } catch {
        toast.error('تعذر تحميل بيانات الحجوزات')
      } finally {
        setIsLoading(false)
      }
    }

    fetchBookings()

    // Subscribe to realtime changes on appointments
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
          filter: `clinic_id=eq.${clinic.id}`
        },
        () => {
          fetchBookings()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [clinic.id, supabase])

  const updateStatus = async (id: string, status: string) => {
    try {
      const payload: Record<string, string | boolean> = { status }
      if (status === 'inside') payload.started_at = new Date().toISOString()
      if (status === 'done' || status === 'cancelled') payload.finished_at = new Date().toISOString()
      if (status === 'waiting') payload.arrived = true

      const { error } = await supabase
        .from('appointments')
        .update(payload)
        .eq('id', id)

      if (error) throw error
      toast.success('تم تحديث حالة الحجز')
    } catch {
      toast.error('حدث خطأ أثناء التحديث')
    }
  }

  return (
    <div className="p-4 md:p-8 space-y-6">
      <header className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border">
        <div>
          <h1 className="text-2xl font-bold text-primary">لوحة تحكم الطبيب</h1>
          <p className="text-sm text-gray-500">{clinic.name} - حجوزات اليوم</p>
        </div>
        <form action="/auth/signout" method="post">
          <Button variant="outline" type="submit" className="text-red-600 border-red-200 hover:bg-red-50">
            <LogOut className="w-4 h-4 ml-2" />
            تسجيل الخروج
          </Button>
        </form>
      </header>

      <main>
        <Card>
          <CardHeader>
            <CardTitle>قائمة المواعيد</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-center py-8 text-gray-500">جاري التحميل...</p>
            ) : bookings.length === 0 ? (
              <p className="text-center py-8 text-gray-500">لا توجد حجوزات لهذا اليوم.</p>
            ) : (
              <div className="space-y-4">
                {(bookings as any[]).map((booking) => (
                  <div key={booking.id} className="flex flex-col md:flex-row items-center justify-between p-4 border rounded-lg bg-gray-50/50 hover:bg-white transition-colors">
                    <div className="flex-1 mb-4 md:mb-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-lg">{booking.patients?.name || 'مريض غير مسجل'}</span>
                        <Badge variant={
                          booking.status === 'inside' ? 'default' :
                          booking.status === 'done' ? 'secondary' :
                          booking.status === 'cancelled' ? 'destructive' :
                          booking.arrived ? 'outline' : 'outline'
                        }>
                          {booking.status === 'inside' ? 'بالداخل' :
                           booking.status === 'done' ? 'تم الانتهاء' :
                           booking.status === 'cancelled' ? 'ملغي' :
                           booking.arrived ? 'في الانتظار' : 'لم يصل'}
                        </Badge>
                      </div>
                      <div className="text-sm text-gray-600 flex gap-4">
                        <span>الخدمة: {booking.services?.name}</span>
                        <span>الوقت: {new Date(booking.scheduled_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                    
                    <div className="flex gap-2 flex-wrap justify-end">
                      {booking.status !== 'done' && booking.status !== 'cancelled' && (
                        <>
                          {!booking.arrived && booking.status !== 'inside' && (
                            <Button size="sm" variant="outline" onClick={() => updateStatus(booking.id, 'waiting')}>
                              <UserCheck className="w-4 h-4 ml-1" /> تسجيل وصول
                            </Button>
                          )}
                          {booking.status !== 'inside' && (
                            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => updateStatus(booking.id, 'inside')}>
                              <Play className="w-4 h-4 ml-1" /> دخول
                            </Button>
                          )}
                          {booking.status === 'inside' && (
                            <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => updateStatus(booking.id, 'done')}>
                              <CheckCircle className="w-4 h-4 ml-1" /> إنهاء
                            </Button>
                          )}
                          <Button size="sm" variant="destructive" onClick={() => updateStatus(booking.id, 'cancelled')}>
                            <XCircle className="w-4 h-4 ml-1" /> إلغاء
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
