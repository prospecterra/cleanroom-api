import { autumnHandler } from "autumn-js/next"
import { createClient } from "@/lib/supabase/server"

const handler = autumnHandler({
  secretKey: process.env.AUTUMN_SECRET_KEY!,
  identify: async (request) => {
    try {
      // Get Bearer token from Authorization header
      const authHeader = request.headers.get('authorization')
      const token = authHeader?.replace('Bearer ', '')

      if (!token) {
        return null
      }

      // Validate token with Supabase
      const supabase = await createClient()
      const { data: { user }, error } = await supabase.auth.getUser(token)

      if (error || !user) {
        return null
      }

      // Return customer data for Autumn
      return {
        customerId: user.id,
        customerData: {
          email: user.email || '',
          name: user.user_metadata?.name || user.email?.split('@')[0] || '',
        },
      }
    } catch (error) {
      console.error('Error identifying user:', error)
      return null
    }
  },
})

export const GET = handler.GET
export const POST = handler.POST
