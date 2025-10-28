"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { isSupabaseConfigured } from "@/lib/supabase/config"

// Whitelist of emails allowed to sign up
const ALLOWED_EMAILS = [
  "elias@prospecterra.com"
]

export default function SignUpPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const supabaseConfigured = isSupabaseConfigured()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      // Check if email is whitelisted
      const normalizedEmail = email.toLowerCase().trim()
      if (!ALLOWED_EMAILS.includes(normalizedEmail)) {
        setError("Sign ups are currently restricted. Please contact us for access.")
        setLoading(false)
        return
      }

      const supabase = createClient()

      // Sign up with Supabase Auth
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
          },
        },
      })

      if (signUpError) {
        setError(signUpError.message)
      } else if (data.user) {
        // User is now logged in, redirect to dashboard
        router.push("/dashboard")
        router.refresh()
      }
    } catch (error) {
      setError("An error occurred")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
        <div>
          <h2 className="text-3xl font-bold text-center text-gray-900">Sign up</h2>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {!supabaseConfigured && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded text-sm">
              <p className="font-semibold mb-2">⚠️ Supabase Not Configured</p>
              <p className="mb-2">Authentication is disabled until you configure Supabase.</p>
              <Link
                href="/setup"
                className="inline-block mt-2 text-yellow-900 underline font-medium hover:text-yellow-700"
              >
                View Setup Guide →
              </Link>
            </div>
          )}
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded text-sm font-medium">
              {error}
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-900">
                Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-900">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-900">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !supabaseConfigured}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Creating account..." : !supabaseConfigured ? "Configure Supabase First" : "Sign up"}
          </button>

          <div className="text-center text-sm text-gray-900">
            Already have an account?{" "}
            <Link href="/auth/signin" className="text-blue-600 hover:text-blue-700 font-medium">
              Sign in
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
