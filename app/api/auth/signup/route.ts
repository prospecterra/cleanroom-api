import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/better-auth"

// BetterAuth handles signup through its own API at /api/auth/better-auth/sign-up/email
// This route is kept for backward compatibility but delegates to BetterAuth
export async function POST(req: NextRequest) {
  try {
    const { email, password, name } = await req.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      )
    }

    // Use BetterAuth's signup API
    const result = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name
      }
    })

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create user" },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        message: "User created successfully",
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name
        }
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Signup error:", error)
    const message = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
