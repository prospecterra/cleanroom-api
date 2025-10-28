"use client"

import { AutumnProvider } from "autumn-js/react"
import { createClient } from "@/lib/supabase/client"
import { useEffect, useState } from "react"

export function Providers({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const [session, setSession] = useState<{access_token: string} | null>(null)
  const [loading, setLoading] = useState(true)

  // Use local Next.js API route in development, Edge Function in production
  // Note: Autumn SDK automatically prepends /api/autumn to all requests
  const autumnBackendUrl = process.env.NODE_ENV === 'development'
    ? 'http://localhost:3000'
    : process.env.NEXT_PUBLIC_SUPABASE_URL || ''

  useEffect(() => {
    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [supabase])

  // Wait for auth check to complete before rendering anything
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  // Only wrap with AutumnProvider if user is authenticated
  if (session) {
    return (
      <AutumnProvider
        backendUrl={autumnBackendUrl}
        includeCredentials={false}
        getBearerToken={async () => {
          const { data } = await supabase.auth.getSession()
          return data.session?.access_token ?? null
        }}
      >
        {children}
      </AutumnProvider>
    )
  }

  // No session, render without Autumn
  return <>{children}</>
}
