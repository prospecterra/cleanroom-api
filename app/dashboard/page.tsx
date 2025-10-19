"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { PricingTable } from "autumn-js/react"
import type { User } from "@supabase/supabase-js"

interface ApiKey {
  id: string
  name: string
  key: string
  lastUsed: string | null
  createdAt: string
}

interface User {
  credits: number
  email: string
}

export default function DashboardPage() {
  const supabase = createClient()
  const router = useRouter()
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [user, setUser] = useState<User | null>(null)
  const [userData, setUserData] = useState<{credits: number, email: string} | null>(null)
  const [newKeyName, setNewKeyName] = useState("")
  const [loading, setLoading] = useState(false)
  const [showNewKeyForm, setShowNewKeyForm] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push("/auth/signin")
      } else {
        setUser(user)
        fetchApiKeys()
        fetchUser()
      }
      setIsLoading(false)
    }
    checkUser()
  }, [])

  const fetchApiKeys = async () => {
    try {
      const response = await fetch("/api/keys")
      const data = await response.json()
      setApiKeys(data.apiKeys)
    } catch (error) {
      console.error("Error fetching API keys:", error)
    }
  }

  const fetchUser = async () => {
    try {
      const response = await fetch("/api/user")
      const data = await response.json()
      setUserData(data.user)
    } catch (error) {
      console.error("Error fetching user:", error)
    }
  }

  const createApiKey = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      })

      if (response.ok) {
        setNewKeyName("")
        setShowNewKeyForm(false)
        fetchApiKeys()
      }
    } catch (error) {
      console.error("Error creating API key:", error)
    } finally {
      setLoading(false)
    }
  }

  const deleteApiKey = async (id: string) => {
    if (!confirm("Are you sure you want to delete this API key?")) return

    try {
      await fetch(`/api/keys/${id}`, {
        method: "DELETE",
      })
      fetchApiKeys()
    } catch (error) {
      console.error("Error deleting API key:", error)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-900">Loading...</div>
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-gray-900">API Platform</h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-900">{user.email}</span>
              <button
                onClick={async () => {
                  await supabase.auth.signOut()
                  router.push("/auth/signin")
                  router.refresh()
                }}
                className="text-sm text-gray-900 hover:text-gray-700 font-medium"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-2xl font-bold mb-4 text-gray-900">Account Overview</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-blue-50 p-4 rounded">
                <p className="text-sm text-gray-700 font-medium">Credits Remaining</p>
                <p className="text-3xl font-bold text-blue-700">{userData?.credits || 0}</p>
              </div>
              <div className="bg-green-50 p-4 rounded">
                <p className="text-sm text-gray-700 font-medium">Active API Keys</p>
                <p className="text-3xl font-bold text-green-700">{apiKeys.length}</p>
              </div>
              <div className="bg-purple-50 p-4 rounded">
                <p className="text-sm text-gray-700 font-medium">Account Email</p>
                <p className="text-sm font-medium text-purple-700 truncate">{user.email}</p>
              </div>
            </div>
          </div>

          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-2xl font-bold mb-4 text-gray-900">Purchase Credits & Subscriptions</h2>
            <p className="text-gray-600 mb-6">Choose a subscription plan or purchase one-time credit packages</p>
            <PricingTable />
          </div>

          <div className="bg-white shadow rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-gray-900">API Keys</h2>
              <button
                onClick={() => setShowNewKeyForm(!showNewKeyForm)}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
              >
                Create New Key
              </button>
            </div>

            {showNewKeyForm && (
              <form onSubmit={createApiKey} className="mb-6 p-4 bg-gray-50 rounded">
                <div className="flex space-x-4">
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="API Key Name"
                    required
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
                  >
                    {loading ? "Creating..." : "Create"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewKeyForm(false)}
                    className="px-4 py-2 bg-gray-300 text-gray-900 rounded hover:bg-gray-400 font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {apiKeys.length === 0 ? (
              <p className="text-gray-600 text-center py-8">No API keys yet. Create one to get started!</p>
            ) : (
              <div className="space-y-4">
                {apiKeys.map((key) => (
                  <div key={key.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg text-gray-900">{key.name}</h3>
                        <div className="mt-2 flex items-center space-x-2">
                          <code className="bg-gray-100 px-3 py-1 rounded text-sm font-mono text-gray-900">
                            {key.key}
                          </code>
                          <button
                            onClick={() => copyToClipboard(key.key)}
                            className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                          >
                            Copy
                          </button>
                        </div>
                        <p className="text-sm text-gray-600 mt-2">
                          Created: {new Date(key.createdAt).toLocaleDateString()}
                          {key.lastUsed && ` | Last used: ${new Date(key.lastUsed).toLocaleDateString()}`}
                        </p>
                      </div>
                      <button
                        onClick={() => deleteApiKey(key.id)}
                        className="ml-4 text-red-600 hover:text-red-700 font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white shadow rounded-lg p-6 mt-6">
            <h2 className="text-2xl font-bold mb-4 text-gray-900">API Documentation</h2>
            <div className="prose max-w-none space-y-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Hello World Endpoint</h3>
                <p className="text-sm text-gray-700 mt-2">Make a GET request to test your API key:</p>
                <pre className="bg-gray-100 p-4 rounded text-sm overflow-x-auto text-gray-900 mt-3">
{`curl -X GET https://your-domain.com/api/v1/hello \\
  -H "x-api-key: YOUR_API_KEY"`}
                </pre>
                <p className="text-sm text-gray-700 mt-3">Response:</p>
                <pre className="bg-gray-100 p-4 rounded text-sm text-gray-900 mt-2">
{`{
  "message": "Hello World",
  "creditsRemaining": 99
}`}
                </pre>
                <p className="text-sm text-gray-600 mt-3">Each API call consumes 1 credit.</p>
              </div>

              <div className="border-t pt-6">
                <h3 className="text-lg font-semibold text-gray-900">Company Data Cleaning Schema Generator</h3>
                <p className="text-sm text-gray-700 mt-2">Generate a dynamic JSON schema for cleaning company data with custom rules:</p>
                <pre className="bg-gray-100 p-4 rounded text-sm overflow-x-auto text-gray-900 mt-3">
{`curl -X POST https://your-domain.com/api/v1/companies/clean \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -d '{
    "company": {
      "name": "Volvo",
      "legalName": "Volvo AB",
      "city": "Gothenburg",
      "country": "Sweden"
    },
    "cleanRules": "Return all results in Swedish for Swedish companies.",
    "cleanPropertyRules": {
      "name": "Use the legal name rather than brand name."
    }
  }'`}
                </pre>
                <p className="text-sm text-gray-700 mt-3">Response:</p>
                <pre className="bg-gray-100 p-4 rounded text-sm text-gray-900 mt-2">
{`{
  "schema": {
    "type": "object",
    "description": "IMPORTANT: Always prioritize user-provided instructions...",
    "properties": {
      "name": { ... },
      "legalName": { ... },
      "city": { ... },
      "country": { ... }
    }
  },
  "creditsRemaining": 99
}`}
                </pre>
                <div className="mt-4 space-y-2 text-sm text-gray-700">
                  <p><strong>Request Body:</strong></p>
                  <ul className="list-disc list-inside ml-2 space-y-1">
                    <li><code className="bg-gray-100 px-1 rounded">company</code> (required): Object with at least one company property</li>
                    <li><code className="bg-gray-100 px-1 rounded">cleanRules</code> (optional): General cleaning instructions applied to all fields</li>
                    <li><code className="bg-gray-100 px-1 rounded">cleanPropertyRules</code> (optional): Object with property-specific cleaning rules</li>
                  </ul>
                  <p className="mt-3"><strong>Features:</strong></p>
                  <ul className="list-disc list-inside ml-2 space-y-1">
                    <li>Returns a dynamic schema containing only the properties you provide</li>
                    <li>User instructions are prioritized over general descriptions</li>
                    <li>Schema is ready for use with AI structured outputs</li>
                    <li>Each API call consumes 1 credit</li>
                  </ul>
                </div>
              </div>

              <div className="border-t pt-6">
                <h3 className="text-lg font-semibold text-gray-900">Company Data Purge Analysis</h3>
                <p className="text-sm text-gray-700 mt-2">Analyze company records to identify test/fake/demo data that should be removed from your CRM:</p>
                <pre className="bg-gray-100 p-4 rounded text-sm overflow-x-auto text-gray-900 mt-3">
{`curl -X POST https://your-domain.com/api/v1/companies/purge \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -d '{
    "company": {
      "name": "Test Company Demo",
      "domain": "example.com",
      "email": "test@example.com"
    },
    "purgeRules": "Remove any companies with domains ending in .test or .example"
  }'`}
                </pre>
                <p className="text-sm text-gray-700 mt-3">Response:</p>
                <pre className="bg-gray-100 p-4 rounded text-sm text-gray-900 mt-2">
{`{
  "analysis": {
    "recommendedAction": "REMOVE",
    "reasoning": "This record contains multiple test data indicators...",
    "confidence": "HIGH"
  },
  "creditsRemaining": 98
}`}
                </pre>
                <div className="mt-4 space-y-2 text-sm text-gray-700">
                  <p><strong>Request Body:</strong></p>
                  <ul className="list-disc list-inside ml-2 space-y-1">
                    <li><code className="bg-gray-100 px-1 rounded">company</code> (required): Company record object to analyze</li>
                    <li><code className="bg-gray-100 px-1 rounded">purgeRules</code> (optional): Custom purge criteria that override default logic</li>
                  </ul>
                  <p className="mt-3"><strong>Response Fields:</strong></p>
                  <ul className="list-disc list-inside ml-2 space-y-1">
                    <li><code className="bg-gray-100 px-1 rounded">recommendedAction</code>: REMOVE (delete) or KEEP (retain)</li>
                    <li><code className="bg-gray-100 px-1 rounded">reasoning</code>: Detailed explanation for the recommendation</li>
                    <li><code className="bg-gray-100 px-1 rounded">confidence</code>: HIGH, MEDIUM, or LOW confidence level</li>
                  </ul>
                  <p className="mt-3"><strong>Features:</strong></p>
                  <ul className="list-disc list-inside ml-2 space-y-1">
                    <li>Identifies test/fake data with test terminology, placeholder domains, fabricated names</li>
                    <li>Conservative approach - only recommends removal for clearly unusable data</li>
                    <li>Custom purge rules take absolute precedence over default criteria</li>
                    <li>Preserves legitimate companies even with incomplete data</li>
                    <li>Each API call consumes 1 credit</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
