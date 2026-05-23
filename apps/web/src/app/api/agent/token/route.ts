import { ApiError, handleRouteError, json } from "@/lib/api";
import { requireDashboardUser } from "@/lib/auth";
import { getBillingStatus, getDeploymentMode } from "@/lib/billing";
import { createAgentToken } from "@/lib/agent-token";
import { getSharedSecretValidationIssue } from "@/lib/secret-safety";

export async function GET() {
  try {
    const { userId, orgId, clerkOrgId } = await requireDashboardUser();
    const billing = await getBillingStatus(userId, orgId, clerkOrgId);

    const deploymentMode = getDeploymentMode();
    if (deploymentMode === "hosted") {
      if (!billing.active) {
        throw new ApiError(402, "Hosted usage requires an active subscription before live calls are enabled");
      }
      if (billing.quotaSeconds > 0 && billing.usedSeconds >= billing.quotaSeconds) {
        throw new ApiError(402, "Hosted usage quota is exhausted for this billing period");
      }
    }

    const secret = process.env.AGENT_DASHBOARD_TOKEN_SECRET;
    if (!secret) {
      throw new ApiError(500, "Agent dashboard token secret is not configured");
    }
    if (deploymentMode === "hosted") {
      const secretIssue = getSharedSecretValidationIssue("Agent dashboard token secret", secret);
      if (secretIssue) {
        throw new ApiError(500, secretIssue);
      }
    }

    const token = createAgentToken({
      userId,
      orgId: billing.orgId || orgId,
      subscriptionStatus: billing.subscriptionStatus,
      allowedActions: ["calls:read", "calls:write", "billing:read"],
    }, {
      secret,
      ttlSeconds: 90,
    });

    const response = json({ token, expiresIn: 90 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
