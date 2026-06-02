import { handleRouteError, json } from "@/lib/api";
import { requireDashboardUser } from "@/lib/auth";
import { createAgentToken } from "@/lib/agent-token";

const agentBaseUrl =
  process.env.NEXT_PUBLIC_AGENT_URL ||
  process.env.AGENT_URL ||
  "http://localhost:3012";

function getDashboardOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  try {
    const { userId, orgId } = await requireDashboardUser();
    let health: Record<string, unknown> | null = null;
    let reachable = false;
    const secret = process.env.AGENT_DASHBOARD_TOKEN_SECRET || "";
    const token = secret
      ? createAgentToken({
          userId,
          orgId,
          subscriptionStatus: "dashboard",
          allowedActions: ["calls:read"],
        }, {
          secret,
          ttlSeconds: 60,
        })
      : "";

    try {
      const response = await fetch(`${agentBaseUrl}/health/details`, {
        cache: "no-store",
        headers: token ? {
          Authorization: `Bearer ${token}`,
          Origin: getDashboardOrigin(request),
          "X-Dashboard-Origin": getDashboardOrigin(request),
        } : undefined,
      });
      if (response.ok) {
        health = (await response.json()) as Record<string, unknown>;
        reachable = true;
      }
    } catch {
      reachable = false;
    }

    return json({
      reachable,
      agentBaseUrl,
      health,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
