"use client"

import { isSupabaseConfigured } from "@/lib/supabase/config"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

export default function SetupPage() {
  const router = useRouter()
  const supabaseConfigured = isSupabaseConfigured()

  useEffect(() => {
    if (supabaseConfigured) {
      router.push("/dashboard")
    }
  }, [supabaseConfigured, router])

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white shadow rounded-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">
            Setup Guide: Configure Supabase
          </h1>

          <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-blue-900">
                <strong>Note:</strong> This application requires Supabase for authentication
                and database functionality.
              </p>
            </div>

            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-900">Step 1: Create a Supabase Project</h2>
              <ol className="list-decimal list-inside space-y-2 text-gray-700 ml-4">
                <li>
                  Go to{" "}
                  <a
                    href="https://supabase.com/dashboard"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    supabase.com/dashboard
                  </a>
                </li>
                <li>Sign in or create a new account</li>
                <li>Click &ldquo;New Project&rdquo;</li>
                <li>Fill in your project details and click &ldquo;Create new project&rdquo;</li>
                <li>Wait for your project to be set up (this may take a minute)</li>
              </ol>
            </div>

            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-900">Step 2: Get Your Credentials</h2>
              <ol className="list-decimal list-inside space-y-2 text-gray-700 ml-4">
                <li>In your Supabase project dashboard, go to Settings → API</li>
                <li>
                  Copy the <strong>Project URL</strong> (it should look like{" "}
                  <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                    https://xxxxx.supabase.co
                  </code>
                  )
                </li>
                <li>
                  Copy the <strong>anon/public key</strong> (under &ldquo;Project API keys&rdquo;)
                </li>
              </ol>
            </div>

            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-900">Step 3: Update Environment Variables</h2>
              <ol className="list-decimal list-inside space-y-2 text-gray-700 ml-4">
                <li>
                  Open the <code className="bg-gray-100 px-2 py-1 rounded text-sm">.env.local</code>{" "}
                  file in your project root
                </li>
                <li>Replace the placeholder values with your actual Supabase credentials:</li>
              </ol>
              <div className="bg-gray-900 text-gray-100 p-4 rounded-lg mt-2 font-mono text-sm overflow-x-auto">
                <pre>
{`NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here`}
                </pre>
              </div>
            </div>

            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-900">Step 4: Restart Dev Server</h2>
              <p className="text-gray-700 ml-4">
                After updating your environment variables, restart the development server:
              </p>
              <div className="bg-gray-900 text-gray-100 p-4 rounded-lg mt-2 font-mono text-sm">
                <pre>npm run dev</pre>
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-green-900 font-semibold mb-2">✅ You&apos;re all set!</p>
              <p className="text-green-800">
                Once configured, you&apos;ll be able to sign up, sign in, and use all features of the
                application.
              </p>
            </div>

            <div className="pt-4 flex gap-4">
              <Link
                href="/auth/signin"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
              >
                Go to Sign In
              </Link>
              <Link
                href="/auth/signup"
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Go to Sign Up
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
