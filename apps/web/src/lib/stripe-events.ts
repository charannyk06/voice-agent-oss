import type Stripe from "stripe";
import { prisma } from "./prisma";

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function unixToDate(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000)
    : null;
}

function includedMinutes(): number {
  const parsed = Number(
    process.env.HOSTED_MONTHLY_INCLUDED_MINUTES ||
      process.env.STRIPE_INCLUDED_MINUTES ||
      "60",
  );
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 60;
}

async function findOrgIdFromCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const org = await prisma.organization.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });
  return org?.id ?? null;
}

async function syncSubscription(subscription: Stripe.Subscription): Promise<void> {
  const rawSubscription = subscription as Stripe.Subscription & {
    current_period_start?: number;
    current_period_end?: number;
  };
  const subscriptionId = subscription.id;
  const customerId = asString(subscription.customer);
  const metadata = subscription.metadata ?? {};
  const orgId = metadata.orgId || (await findOrgIdFromCustomer(customerId));

  if (!orgId) {
    console.warn("[Stripe] Subscription event missing org mapping", subscriptionId);
    return;
  }

  const currentPeriodStart = unixToDate(rawSubscription.current_period_start);
  const currentPeriodEnd = unixToDate(rawSubscription.current_period_end);
  const priceId = subscription.items?.data?.[0]?.price?.id ?? null;

  await prisma.organization.upsert({
    where: { id: orgId },
    update: {
      stripeCustomerId: customerId ?? undefined,
      subscriptionStatus: subscription.status,
      currentPeriodEnd: currentPeriodEnd ?? undefined,
      minuteQuotaMonthly: includedMinutes(),
    },
    create: {
      id: orgId,
      name: metadata.orgName || "Hosted Organization",
      stripeCustomerId: customerId ?? undefined,
      subscriptionStatus: subscription.status,
      currentPeriodEnd: currentPeriodEnd ?? undefined,
      minuteQuotaMonthly: includedMinutes(),
    },
  });

  await prisma.billingSubscription.upsert({
    where: { stripeSubscriptionId: subscriptionId },
    update: {
      orgId,
      status: subscription.status,
      priceId,
      currentPeriodStart: currentPeriodStart ?? undefined,
      currentPeriodEnd: currentPeriodEnd ?? undefined,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    },
    create: {
      orgId,
      stripeSubscriptionId: subscriptionId,
      status: subscription.status,
      priceId,
      currentPeriodStart: currentPeriodStart ?? undefined,
      currentPeriodEnd: currentPeriodEnd ?? undefined,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    },
  });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, stripe: Stripe): Promise<void> {
  const orgId = session.client_reference_id || session.metadata?.orgId;
  const customerId = asString(session.customer);
  if (!orgId) {
    console.warn("[Stripe] Checkout session missing org mapping", session.id);
    return;
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      stripeCustomerId: customerId ?? undefined,
    },
  }).catch(async () => {
    await prisma.organization.create({
      data: {
        id: orgId,
        name: session.metadata?.orgName || "Hosted Organization",
        stripeCustomerId: customerId ?? undefined,
        subscriptionStatus: "incomplete",
      },
    });
  });

  const subscriptionId = asString(session.subscription);
  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await syncSubscription(subscription);
  }
}

export async function processStripeEvent(event: Stripe.Event, stripe: Stripe): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, stripe);
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object as Stripe.Subscription);
      return;
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = asString(invoice.customer);
      const orgId = await findOrgIdFromCustomer(customerId);
      if (orgId) {
        await prisma.organization.update({
          where: { id: orgId },
          data: { subscriptionStatus: "past_due" },
        });
      }
      return;
    }
    default:
      return;
  }
}
