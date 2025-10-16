import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import Stripe from "stripe"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-12-18.acacia",
})

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get("stripe-signature")

  if (!sig) {
    return NextResponse.json(
      { error: "No signature" },
      { status: 400 }
    )
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    console.error("Webhook signature verification failed:", err)
    return NextResponse.json(
      { error: "Webhook signature verification failed" },
      { status: 400 }
    )
  }

  // Handle the checkout.session.completed event
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session

    const userId = session.metadata?.userId
    const credits = parseInt(session.metadata?.credits || "0")

    if (userId && credits > 0) {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: {
            credits: {
              increment: credits,
            },
          },
        }),
        prisma.transaction.create({
          data: {
            userId,
            type: "CREDIT_PURCHASE",
            amount: session.amount_total || 0,
            credits,
            description: `Purchased ${credits} credits`,
          },
        }),
      ])
    }
  }

  return NextResponse.json({ received: true })
}
