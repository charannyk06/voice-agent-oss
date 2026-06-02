import { ApiError } from "./api";
import { prisma } from "./prisma";

export type DeploymentMode = "self_hosted" | "hosted";

interface DeploymentModeEnv {
  DEPLOYMENT_MODE?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_PRICE_BASE_MONTHLY?: string;
  BILLING_USAGE_INGEST_SECRET?: string;
  HOSTED_ALLOW_TRIALING_USAGE?: string;
}

function hasHostedBillingSignals(env: DeploymentModeEnv) {
  return Boolean(
    env.STRIPE_SECRET_KEY && (env.STRIPE_PRICE_ID || env.STRIPE_PRICE_BASE_MONTHLY)
  ) || Boolean(env.BILLING_USAGE_INGEST_SECRET);
}

export function getDeploymentMode(env?: DeploymentModeEnv): DeploymentMode {
  const source = (env ?? process.env) as DeploymentModeEnv;
  if (source.DEPLOYMENT_MODE === "hosted") return "hosted";

  if (hasHostedBillingSignals(source)) {
    return "hosted";
  }

  if (source.DEPLOYMENT_MODE === "self_hosted") return "self_hosted";

  return "self_hosted";
}

export function allowsHostedTrialingUsage(env?: Pick<DeploymentModeEnv, "HOSTED_ALLOW_TRIALING_USAGE">) {
  return ((env ?? process.env) as Pick<DeploymentModeEnv, "HOSTED_ALLOW_TRIALING_USAGE">).HOSTED_ALLOW_TRIALING_USAGE === "true";
}

export function isSubscriptionUsable(
  status?: string | null,
  env?: Pick<DeploymentModeEnv, "HOSTED_ALLOW_TRIALING_USAGE">,
) {
  return status === "active" || (status === "trialing" && allowsHostedTrialingUsage(env));
}

export function redactStripeId(value?: string | null) {
  if (!value) return null;
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

export const DEFAULT_HOSTED_MONTHLY_INCLUDED_MINUTES = 60;

export function getHostedIncludedMinutes(env?: {
  HOSTED_MONTHLY_INCLUDED_MINUTES?: string;
  STRIPE_INCLUDED_MINUTES?: string;
}) {
  const source = env ?? process.env;
  const parsed = Number(source.HOSTED_MONTHLY_INCLUDED_MINUTES || source.STRIPE_INCLUDED_MINUTES || DEFAULT_HOSTED_MONTHLY_INCLUDED_MINUTES);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_HOSTED_MONTHLY_INCLUDED_MINUTES;
}

export function getHostedQuotaSeconds(minuteQuotaMonthly?: number | null, env?: {
  HOSTED_MONTHLY_INCLUDED_MINUTES?: string;
  STRIPE_INCLUDED_MINUTES?: string;
}) {
  const minutes = minuteQuotaMonthly && minuteQuotaMonthly > 0
    ? Math.floor(minuteQuotaMonthly)
    : getHostedIncludedMinutes(env);
  return minutes * 60;
}

export function usagePercent(used: number, quota: number) {
  if (!quota || quota <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / quota) * 100)));
}

export function isQuotaExhausted(used: number, quota: number) {
  return quota > 0 && used >= quota;
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

  const deploymentMode = getDeploymentMode();
  const subscriptionStatus = currentSubscription?.status ?? org.subscriptionStatus;
  const subscribed = isSubscriptionUsable(subscriptionStatus);
  const quotaSeconds = deploymentMode === "hosted" && subscribed
    ? getHostedQuotaSeconds(org.minuteQuotaMonthly)
    : org.minuteQuotaMonthly > 0
      ? org.minuteQuotaMonthly * 60
      : 0;
  const used = usedSeconds._sum.quantity ?? 0;
  const quotaExhausted = deploymentMode === "hosted" && subscribed && isQuotaExhausted(used, quotaSeconds);

  return {
    deploymentMode,
    orgId: org.id,
    orgName: org.name,
    stripeCustomerId: redactStripeId(org.stripeCustomerId),
    subscriptionStatus,
    currentPeriodEnd: org.currentPeriodEnd?.toISOString() ?? null,
    active: deploymentMode === "self_hosted" || (subscribed && !quotaExhausted),
    quotaSeconds,
    usedSeconds: used,
    usagePercent: usagePercent(used, quotaSeconds),
    quotaExhausted,
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
