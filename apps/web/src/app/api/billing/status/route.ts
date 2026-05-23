import { handleRouteError, json } from "@/lib/api";
import { requireDashboardUser } from "@/lib/auth";
import { getBillingStatus } from "@/lib/billing";

export async function GET() {
  try {
    const { userId, orgId, clerkOrgId } = await requireDashboardUser();
    return json(await getBillingStatus(userId, orgId, clerkOrgId));
  } catch (error) {
    return handleRouteError(error);
  }
}
