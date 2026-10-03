'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'

export default function DoctorLogin({ params }: { params: { slug: string } }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (authError) {
        if (authError.message === 'Invalid login credentials') {
          throw new Error('البريد الإلكتروني أو كلمة المرور غير صحيحة.')
        }
        throw new Error(authError.message)
      }

      // Check activation status via RPC
      const { data: activationStatus, error: activationError } = await supabase.rpc(
        'doctor_activation_status',
        { p_slug: params.slug }
      )

      if (activationError) {
        throw new Error('حدث خطأ أثناء التحقق من حالة الحساب.')
      }

      const status = (activationStatus as any)?.status

      if (status === 'pending' || status === 'rejected') {
        await supabase.auth.signOut()
        throw new Error(
          status === 'pending' 
            ? 'طلب التفعيل قيد المراجعة. يرجى انتظار موافقة مالك المنصة.'
            : 'تعذّر تفعيل حساب الطبيب. تواصل مع الدعم الفني.'
        )
      }

      // Check if password change is required
      const { data: passwordStatus, error: passwordError } = await supabase.rpc('doctor_password_status')
      
      if (passwordStatus) {
        router.push(`/clinic/${params.slug}/login/update-password`)
        return
      }

      // Success
      router.push(`/clinic/${params.slug}/admin`)
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'تعذر إتمام الطلب.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">دخول فريق العيادة</CardTitle>
          <CardDescription>أدخل البريد الإلكتروني وكلمة المرور للوصول إلى لوحة التحكم</CardDescription>
        </CardHeader>
        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>خطأ</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">البريد الإلكتروني</Label>
              <Input
                id="email"
                type="email"
                placeholder="doctor@clinic.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
                dir="ltr"
                className="text-right"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">كلمة المرور</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
                dir="ltr"
                className="text-right"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'جاري التحميل...' : 'تسجيل الدخول'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
