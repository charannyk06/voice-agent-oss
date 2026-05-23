import { auth, clerkClient } from "@clerk/nextjs/server";
import { ApiError } from "./api";

export interface DashboardUser {
  userId: string;
  orgId: string;
  clerkOrgId?: string;
}

/**
 * Require authentication in an API route handler.
 * Returns the Clerk userId, or responds with 401 if not authenticated.
 */
export async function requireAuth(): Promise<string | Response> {
  const { userId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return userId;
}

/**
 * Fail closed at the route-handler layer, not only in middleware.
 */
export async function requireDashboardUser(): Promise<DashboardUser> {
  const { userId, orgId } = await auth();
  if (!userId) {
    throw new ApiError(401, "Unauthorized");
  }

  return {
    userId,
    orgId: orgId ? `clerk_org_${orgId}` : `clerk_user_${userId}`,
    clerkOrgId: orgId || undefined,
  };
}

/**
 * Get the current user's display name from Clerk.
 */
export async function getCurrentUserName(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return user.fullName || user.username || user.emailAddresses[0]?.emailAddress || null;
  } catch {
    return null;
  }
}
