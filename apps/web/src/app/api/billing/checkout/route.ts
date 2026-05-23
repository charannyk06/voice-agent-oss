import { ApiError, handleRouteError, json } from "@/lib/api";
import { requireDashboardUser } from "@/lib/auth";
import { ensureBillingOrganization, getDeploymentMode, requireStripeConfig } from "@/lib/billing";
import { getStripeClient } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

function getAppBaseUrl(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (getDeploymentMode() === "hosted") {
    throw new ApiError(500, "Hosted billing requires NEXT_PUBLIC_APP_URL or PUBLIC_APP_URL");
  }
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function POST(request: Request) {
  try {
    if (getDeploymentMode() !== "hosted") {
      throw new ApiError(400, "Stripe checkout is only required for hosted deployments");
    }

    const { userId, orgId, clerkOrgId } = await requireDashboardUser();
    const org = await ensureBillingOrganization(userId, orgId, clerkOrgId);
    const { basePriceId } = requireStripeConfig();
    const stripe = getStripeClient();
    const baseUrl = getAppBaseUrl(request);

    let customerId = org.stripeCustomerId;
    const existingSubscription = await prisma.billingSubscription.findFirst({
      where: { orgId: org.id, status: { in: ["active", "trialing"] } },
      select: { id: true },
    });
    if (existingSubscription) {
      throw new ApiError(409, "This workspace already has an active subscription. Use the billing portal to manage it.");
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: {
          orgId: org.id,
          userId,
        },
      }, {
        idempotencyKey: `voice-agent-customer:${org.id}`,
      });
      customerId = customer.id;
      await prisma.organization.update({
        where: { id: org.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: org.id,
      success_url: `${baseUrl}/billing?checkout=success`,
      cancel_url: `${baseUrl}/billing?checkout=cancelled`,
      allow_promotion_codes: true,
      line_items: [
        {
          price: basePriceId,
          quantity: 1,
        },
      ],
      subscription_data: {
        metadata: {
          orgId: org.id,
          userId,
          orgName: org.name,
        },
      },
      metadata: {
        orgId: org.id,
        userId,
        orgName: org.name,
      },
    }, {
      idempotencyKey: `voice-agent-checkout:${org.id}:${basePriceId}`,
    });

    if (!session.url) {
      throw new ApiError(500, "Stripe did not return a checkout URL");
    }

    return json({ url: session.url });
  } catch (error) {
    return handleRouteError(error);
  }
}
