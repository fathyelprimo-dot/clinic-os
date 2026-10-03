import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  // Check if a user's logged in
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    await supabase.auth.signOut()
  }

  revalidatePath('/', 'layout')
  
  // Try to redirect back to where they came from
  const referer = req.headers.get('referer')
  if (referer) {
    // If they were on admin, send to login
    if (referer.includes('/admin')) {
      return NextResponse.redirect(new URL(referer.replace('/admin', '/login'), req.url))
    }
    return NextResponse.redirect(new URL(referer, req.url))
  }

  return NextResponse.redirect(new URL('/', req.url))
}
