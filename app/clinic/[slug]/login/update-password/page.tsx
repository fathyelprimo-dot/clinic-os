'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'

export default function UpdatePassword({ params }: { params: { slug: string } }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    // Check if user is logged in
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.push(`/clinic/${params.slug}/login`)
      }
    })
  }, [supabase, router, params.slug])

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين.')
      return
    }
    if (password.length < 12) {
      setError('يجب أن تتكون كلمة المرور من 12 حرفاً على الأقل.')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: password
      })

      if (updateError) {
        throw new Error(updateError.message)
      }

      // Check activation status again before redirecting to admin
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
          <CardTitle className="text-2xl font-bold">تحديث كلمة المرور</CardTitle>
          <CardDescription>يرجى اختيار كلمة مرور قوية جديدة لحسابك</CardDescription>
        </CardHeader>
        <form onSubmit={handleUpdate}>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>خطأ</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="password">كلمة المرور الجديدة</Label>
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
            <div className="space-y-2">
              <Label htmlFor="confirm">تأكيد كلمة المرور</Label>
              <Input
                id="confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={isLoading}
                dir="ltr"
                className="text-right"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'جاري التحميل...' : 'حفظ التحديث'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
