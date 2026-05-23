import { handleRouteError, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { processStripeEvent } from "@/lib/stripe-events";
import {
  constructStripeWebhookEvent,
  getStripeSignatureHeader,
  getStripeWebhookSecret,
} from "@/lib/stripe-webhook";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const webhookSecret = getStripeWebhookSecret();
    const signature = getStripeSignatureHeader(request.headers);
    const stripe = getStripeClient();
    const rawBody = await request.text();
    const event = constructStripeWebhookEvent(stripe, rawBody, signature, webhookSecret);

    const existing = await prisma.stripeWebhookEvent.findUnique({ where: { id: event.id } });
    if (existing?.processed) {
      return json({ received: true, duplicate: true });
    }

    await prisma.stripeWebhookEvent.upsert({
      where: { id: event.id },
      update: { type: event.type },
      create: {
        id: event.id,
        type: event.type,
        processed: false,
      },
    });

    await processStripeEvent(event, stripe);

    await prisma.stripeWebhookEvent.update({
      where: { id: event.id },
      data: { processed: true },
    });

    return json({ received: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
