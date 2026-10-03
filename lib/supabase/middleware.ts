import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Protected routes logic
  if (request.nextUrl.pathname.includes('/admin') && !user) {
    const url = request.nextUrl.clone()
    url.pathname = url.pathname.replace('/admin', '/login')
    return NextResponse.redirect(url)
  }

  // Auto redirect from login to admin if logged in
  if (request.nextUrl.pathname.includes('/login') && user) {
    const url = request.nextUrl.clone()
    url.pathname = url.pathname.replace('/login', '/admin')
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
