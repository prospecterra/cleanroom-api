import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  try {
    const apiKey = req.headers.get("x-api-key")

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 401 }
      )
    }

    // Validate API key and get user
    const keyRecord = await prisma.apiKey.findUnique({
      where: { key: apiKey },
      include: {
        user: {
          select: {
            id: true,
            credits: true
          }
        }
      }
    })

    if (!keyRecord) {
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      )
    }

    // Check if user has enough credits
    if (keyRecord.user.credits < 1) {
      return NextResponse.json(
        { error: "Insufficient credits" },
        { status: 402 }
      )
    }

    // Deduct credit and create transaction
    await prisma.$transaction([
      prisma.user.update({
        where: { id: keyRecord.user.id },
        data: {
          credits: {
            decrement: 1
          }
        }
      }),
      prisma.transaction.create({
        data: {
          userId: keyRecord.user.id,
          type: "API_USAGE",
          amount: 0,
          credits: -1,
          description: "Hello World API call"
        }
      }),
      prisma.apiKey.update({
        where: { id: keyRecord.id },
        data: {
          lastUsed: new Date()
        }
      })
    ])

    return NextResponse.json({
      message: "Hello World",
      creditsRemaining: keyRecord.user.credits - 1
    })
  } catch (error) {
    console.error("API error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
