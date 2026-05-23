import { ApiError, handleRouteError, json } from "@/lib/api";
import { requireDashboardUser } from "@/lib/auth";
import { ensureBillingOrganization, getDeploymentMode } from "@/lib/billing";
import { getStripeClient } from "@/lib/stripe";

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
    const { userId, orgId, clerkOrgId } = await requireDashboardUser();
    const org = await ensureBillingOrganization(userId, orgId, clerkOrgId);
    if (!org.stripeCustomerId) {
      throw new ApiError(400, "Create a subscription before opening the billing portal");
    }

    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${getAppBaseUrl(request)}/billing`,
    });

    return json({ url: session.url });
  } catch (error) {
    return handleRouteError(error);
  }
}
