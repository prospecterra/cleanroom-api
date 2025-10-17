import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { autumn } from "autumn-js/better-auth"
import { prisma } from "./prisma"

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql"
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false
  },
  secret: process.env.BETTER_AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  plugins: [
    autumn({
      customerScope: "user" // User-level billing
    })
  ]
})

export type Auth = typeof auth
