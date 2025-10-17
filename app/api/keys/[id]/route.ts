import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { id } = await params

    const apiKey = await prisma.apiKey.findUnique({
      where: { id }
    })

    if (!apiKey || apiKey.userId !== session.user.id) {
      return NextResponse.json(
        { error: "API key not found" },
        { status: 404 }
      )
    }

    await prisma.apiKey.delete({
      where: { id }
    })

    return NextResponse.json({ message: "API key deleted successfully" })
  } catch (error) {
    console.error("Error deleting API key:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
