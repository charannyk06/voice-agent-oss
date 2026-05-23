import { ApiError } from "./api";
import { prisma } from "./prisma";

export type DeploymentMode = "self_hosted" | "hosted";

export function getDeploymentMode(env?: { DEPLOYMENT_MODE?: string }): DeploymentMode {
  return (env ?? process.env).DEPLOYMENT_MODE === "hosted" ? "hosted" : "self_hosted";
}

export function isSubscriptionUsable(status?: string | null) {
  return status === "active" || status === "trialing";
}

export function redactStripeId(value?: string | null) {
  if (!value) return null;
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

export function usagePercent(used: number, quota: number) {
  if (!quota || quota <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / quota) * 100)));
}

export function buildCurrentPeriodUsageWhere(orgId: string, period?: {
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
}) {
  return {
    orgId,
    kind: "voice_seconds",
    createdAt: {
      ...(period?.currentPeriodStart ? { gte: period.currentPeriodStart } : {}),
      ...(period?.currentPeriodEnd ? { lt: period.currentPeriodEnd } : {}),
    },
  };
}

export async function ensureBillingOrganization(userId: string, orgId: string, clerkOrgId?: string) {
  const org = await prisma.organization.upsert({
    where: { id: orgId },
    update: {
      clerkOrgId,
    },
    create: {
      id: orgId,
      name: clerkOrgId ? "Clerk Organization" : "Personal Workspace",
      clerkOrgId,
      subscriptionStatus: getDeploymentMode() === "self_hosted" ? "self_hosted" : "inactive",
      minuteQuotaMonthly: 0,
    },
  });

  await prisma.userMembership.upsert({
    where: { clerkUserId_orgId: { clerkUserId: userId, orgId: org.id } },
    update: {},
    create: { clerkUserId: userId, orgId: org.id, role: "owner" },
  });

  return org;
}

export async function getBillingStatus(userId: string, orgId: string, clerkOrgId?: string) {
  const org = await ensureBillingOrganization(userId, orgId, clerkOrgId);
  const currentSubscription = await prisma.billingSubscription.findFirst({
    where: { orgId: org.id, status: { in: ["active", "trialing"] } },
    orderBy: { currentPeriodEnd: "desc" },
  });
  const usedSeconds = await prisma.usageEvent.aggregate({
    where: buildCurrentPeriodUsageWhere(org.id, currentSubscription ?? undefined),
    _sum: { quantity: true },
  });

  const quotaSeconds = org.minuteQuotaMonthly > 0 ? org.minuteQuotaMonthly * 60 : 0;
  const used = usedSeconds._sum.quantity ?? 0;

  return {
    deploymentMode: getDeploymentMode(),
    orgId: org.id,
    orgName: org.name,
    stripeCustomerId: redactStripeId(org.stripeCustomerId),
    subscriptionStatus: org.subscriptionStatus,
    currentPeriodEnd: org.currentPeriodEnd?.toISOString() ?? null,
    active: getDeploymentMode() === "self_hosted" || isSubscriptionUsable(org.subscriptionStatus),
    quotaSeconds,
    usedSeconds: used,
    usagePercent: usagePercent(used, quotaSeconds),
  };
}

export function requireStripeConfig() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const basePriceId = process.env.STRIPE_PRICE_ID || process.env.STRIPE_PRICE_BASE_MONTHLY;
  if (!secretKey || !basePriceId) {
    throw new ApiError(500, "Stripe billing is not configured");
  }
  return { secretKey, basePriceId };
}
