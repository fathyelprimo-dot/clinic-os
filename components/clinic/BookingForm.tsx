'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'

export function BookingForm({ 
  clinic, 
  services 
}: { 
  clinic: any
  services: any[]
}) {
  const [selectedService, setSelectedService] = useState<string>(services[0]?.id || '')
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [selectedTime, setSelectedTime] = useState<string>('')
  const [availableSlots, setAvailableSlots] = useState<string[]>([])
  
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isBooking, setIsBooking] = useState(false)

  const supabase = createClient()

  // Load available slots when service or date changes
  useEffect(() => {
    if (!selectedService || !selectedDate) return
    let active = true

    async function loadSlots() {
      setIsLoading(true)
      try {
        const { data, error } = await supabase.rpc('available_slots', {
          p_clinic: clinic.id,
          p_service: selectedService,
          p_date: selectedDate
        })
        if (error) throw error
        if (active) {
          setAvailableSlots(data || [])
          setSelectedTime('') // Reset time
        }
      } catch (err: any) {
        if (active) toast.error('تعذر تحميل المواعيد المتاحة.')
      } finally {
        if (active) setIsLoading(false)
      }
    }

    loadSlots()
    return () => { active = false }
  }, [selectedService, selectedDate, clinic.id, supabase])

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedTime) {
      toast.error('الرجاء اختيار الموعد.')
      return
    }

    setIsBooking(true)
    try {
      const response = await supabase.functions.invoke('patient-booking', {
        body: {
          action: 'book',
          clinic_id: clinic.id,
          service_id: selectedService,
          date: selectedDate,
          time: selectedTime,
          name: name.trim(),
          phone: phone.trim()
        }
      })

      if (response.error) {
        throw new Error(response.error.message || 'حدث خطأ أثناء الحجز')
      }

      toast.success('تم تأكيد حجزك بنجاح!')
      // Reset form
      setName('')
      setPhone('')
      setSelectedTime('')
      // Refresh slots
      setSelectedDate(selectedDate)
    } catch (err: any) {
      toast.error(err.message || 'تعذر إتمام الحجز.')
    } finally {
      setIsBooking(false)
    }
  }

  return (
    <Card className="w-full max-w-2xl mx-auto border-t-4 border-t-primary shadow-lg">
      <CardHeader className="bg-gray-50/50 border-b">
        <CardTitle className="text-xl">حجز موعد جديد</CardTitle>
        <CardDescription>اختر الخدمة والموعد المناسب لزيارتك</CardDescription>
      </CardHeader>
      <form onSubmit={handleBook}>
        <CardContent className="space-y-6 pt-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>نوع الخدمة</Label>
              <Select value={selectedService} onValueChange={setSelectedService} required>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الخدمة" />
                </SelectTrigger>
                <SelectContent>
                  {services.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} - {s.price} ج.م
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>تاريخ الحجز</Label>
              <Input 
                type="date" 
                value={selectedDate} 
                onChange={(e) => setSelectedDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                required
              />
            </div>
          </div>

          <div className="space-y-3">
            <Label>المواعيد المتاحة</Label>
            {isLoading ? (
              <p className="text-sm text-gray-500 py-4 text-center">جاري تحميل المواعيد...</p>
            ) : availableSlots.length === 0 ? (
              <p className="text-sm text-red-500 py-4 text-center border rounded bg-red-50/50">
                لا توجد مواعيد متاحة في هذا اليوم. الرجاء اختيار يوم آخر.
              </p>
            ) : (
              <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
                {availableSlots.map(time => (
                  <button
                    type="button"
                    key={time}
                    onClick={() => setSelectedTime(time)}
                    className={`p-2 text-sm rounded border transition-colors ${
                      selectedTime === time 
                        ? 'bg-primary text-primary-foreground border-primary font-bold' 
                        : 'hover:bg-gray-100'
                    }`}
                  >
                    {time}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="border-t pt-6 grid md:grid-cols-2 gap-4">
             <div className="space-y-2">
              <Label>اسم المريض</Label>
              <Input 
                value={name} 
                onChange={(e) => setName(e.target.value)}
                placeholder="الاسم ثلاثي"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>رقم الموبايل</Label>
              <Input 
                value={phone} 
                onChange={(e) => setPhone(e.target.value)}
                placeholder="010..."
                dir="ltr"
                className="text-right"
                required
              />
            </div>
          </div>
        </CardContent>
        <CardFooter className="bg-gray-50/50 border-t pt-6">
          <Button type="submit" className="w-full text-lg h-12" disabled={isBooking || !selectedTime}>
            {isBooking ? 'جاري تأكيد الحجز...' : 'تأكيد الحجز'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
