"use client"

import { useEffect, useState } from "react"
import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"

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
  const { data: session, status } = useSession()
  const router = useRouter()
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [user, setUser] = useState<User | null>(null)
  const [newKeyName, setNewKeyName] = useState("")
  const [loading, setLoading] = useState(false)
  const [showNewKeyForm, setShowNewKeyForm] = useState(false)

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin")
    }
  }, [status, router])

  useEffect(() => {
    if (status === "authenticated") {
      fetchApiKeys()
      fetchUser()
    }
  }, [status])

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
      setUser(data.user)
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

  if (status === "loading") {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>
  }

  if (!session) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold">API Platform</h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-700">{session.user.email}</span>
              <button
                onClick={() => signOut({ callbackUrl: "/auth/signin" })}
                className="text-sm text-gray-700 hover:text-gray-900"
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
            <h2 className="text-2xl font-bold mb-4">Account Overview</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-blue-50 p-4 rounded">
                <p className="text-sm text-gray-600">Credits Remaining</p>
                <p className="text-3xl font-bold text-blue-600">{user?.credits || 0}</p>
              </div>
              <div className="bg-green-50 p-4 rounded">
                <p className="text-sm text-gray-600">Active API Keys</p>
                <p className="text-3xl font-bold text-green-600">{apiKeys.length}</p>
              </div>
              <div className="bg-purple-50 p-4 rounded">
                <p className="text-sm text-gray-600">Account Email</p>
                <p className="text-sm font-medium text-purple-600 truncate">{user?.email}</p>
              </div>
            </div>
          </div>

          <div className="bg-white shadow rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold">API Keys</h2>
              <button
                onClick={() => setShowNewKeyForm(!showNewKeyForm)}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
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
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {loading ? "Creating..." : "Create"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewKeyForm(false)}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {apiKeys.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No API keys yet. Create one to get started!</p>
            ) : (
              <div className="space-y-4">
                {apiKeys.map((key) => (
                  <div key={key.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg">{key.name}</h3>
                        <div className="mt-2 flex items-center space-x-2">
                          <code className="bg-gray-100 px-3 py-1 rounded text-sm font-mono">
                            {key.key}
                          </code>
                          <button
                            onClick={() => copyToClipboard(key.key)}
                            className="text-blue-600 hover:text-blue-700 text-sm"
                          >
                            Copy
                          </button>
                        </div>
                        <p className="text-sm text-gray-500 mt-2">
                          Created: {new Date(key.createdAt).toLocaleDateString()}
                          {key.lastUsed && ` | Last used: ${new Date(key.lastUsed).toLocaleDateString()}`}
                        </p>
                      </div>
                      <button
                        onClick={() => deleteApiKey(key.id)}
                        className="ml-4 text-red-600 hover:text-red-700"
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
            <h2 className="text-2xl font-bold mb-4">API Documentation</h2>
            <div className="prose max-w-none">
              <h3 className="text-lg font-semibold">Hello World Endpoint</h3>
              <p className="text-sm text-gray-600">Make a GET request to test your API key:</p>
              <pre className="bg-gray-100 p-4 rounded text-sm overflow-x-auto">
{`curl -X GET https://your-domain.com/api/v1/hello \\
  -H "x-api-key: YOUR_API_KEY"`}
              </pre>
              <p className="text-sm text-gray-600 mt-2">Response:</p>
              <pre className="bg-gray-100 p-4 rounded text-sm">
{`{
  "message": "Hello World",
  "creditsRemaining": 99
}`}
              </pre>
              <p className="text-xs text-gray-500 mt-2">Each API call consumes 1 credit.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
