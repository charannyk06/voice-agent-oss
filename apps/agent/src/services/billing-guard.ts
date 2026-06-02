import { prisma } from './prisma';
import { config } from '../config';
import { getHostedBillingSnapshotFromPostgres } from './hosted-billing-database';
import { signUsageIngestRequest } from './usage-signature';

export type DeploymentMode = 'self_hosted' | 'hosted';

export interface BillingGateInput {
  deploymentMode: DeploymentMode;
  subscriptionStatus?: string | null;
  monthlyQuotaSeconds?: number | null;
  usedSecondsThisPeriod?: number | null;
  reservedSecondsThisPeriod?: number | null;
}

export type BillingGateResult =
  | { allowed: true }
  | { allowed: false; reason: 'subscription_inactive' | 'quota_exhausted' | 'billing_unavailable'; message: string };

export function allowsHostedTrialingUsage(env?: { HOSTED_ALLOW_TRIALING_USAGE?: string }): boolean {
  return (env ?? process.env).HOSTED_ALLOW_TRIALING_USAGE === 'true';
}

export function isHostedSubscriptionActive(
  status?: string | null,
  env?: { HOSTED_ALLOW_TRIALING_USAGE?: string },
): boolean {
  return status === 'active' || (status === 'trialing' && allowsHostedTrialingUsage(env));
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

export function getHostedQuotaSeconds(monthlyQuotaSeconds?: number | null, env?: {
  HOSTED_MONTHLY_INCLUDED_MINUTES?: string;
  STRIPE_INCLUDED_MINUTES?: string;
}) {
  if (monthlyQuotaSeconds && monthlyQuotaSeconds > 0) {
    return Math.floor(monthlyQuotaSeconds);
  }
  return getHostedIncludedMinutes(env) * 60;
}

export function evaluateBillingGate(input: BillingGateInput): BillingGateResult {
  if (input.deploymentMode === 'self_hosted') {
    return { allowed: true };
  }

  if (!isHostedSubscriptionActive(input.subscriptionStatus)) {
    return {
      allowed: false,
      reason: 'subscription_inactive',
      message: 'Hosted usage requires an active billing subscription.',
    };
  }

  const quota = getHostedQuotaSeconds(input.monthlyQuotaSeconds);
  const used = Math.max(0, input.usedSecondsThisPeriod ?? 0);
  if (used >= quota) {
    return {
      allowed: false,
      reason: 'quota_exhausted',
      message: 'Hosted usage quota is exhausted for this billing period.',
    };
  }

  const reserved = Math.max(0, input.reservedSecondsThisPeriod ?? 0);
  if (reserved > 0 && used + reserved > quota) {
    return {
      allowed: false,
      reason: 'quota_exhausted',
      message: 'Hosted usage quota is reserved by active or pending calls for this billing period.',
    };
  }

  return { allowed: true };
}

export function buildCurrentPeriodUsageWhere(orgId: string, period?: {
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
}) {
  return {
    orgId,
    kind: 'voice_seconds',
    createdAt: {
      ...(period?.currentPeriodStart ? { gte: period.currentPeriodStart } : {}),
      ...(period?.currentPeriodEnd ? { lt: period.currentPeriodEnd } : {}),
    },
  };
}

export async function getHostedBillingSnapshot(orgId: string) {
  const postgresSnapshot = await getHostedBillingSnapshotFromPostgres(orgId);
  if (postgresSnapshot) {
    return postgresSnapshot;
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      subscriptions: {
        where: { status: { in: ['active', 'trialing'] } },
        orderBy: { currentPeriodEnd: 'desc' },
        take: 1,
      },
    },
  });

  const currentSubscription = org?.subscriptions[0];
  const usedSeconds = org
    ? await prisma.usageEvent.aggregate({
        where: buildCurrentPeriodUsageWhere(org.id, currentSubscription ?? undefined),
        _sum: { quantity: true },
      })
    : { _sum: { quantity: 0 } };

  return {
    subscriptionStatus: currentSubscription?.status ?? org?.subscriptionStatus ?? 'inactive',
    monthlyQuotaSeconds: org?.minuteQuotaMonthly ? org.minuteQuotaMonthly * 60 : 0,
    usedSecondsThisPeriod: usedSeconds._sum.quantity ?? 0,
  };
}

export async function assertCanStartLiveCall(orgId: string, options?: {
  reservedSecondsThisPeriod?: number;
}): Promise<BillingGateResult> {
  if (config.deployment.mode === 'self_hosted') {
    return { allowed: true };
  }

  try {
    const snapshot = await getHostedBillingSnapshot(orgId);
    return evaluateBillingGate({
      deploymentMode: config.deployment.mode,
      reservedSecondsThisPeriod: options?.reservedSecondsThisPeriod,
      ...snapshot,
    });
  } catch (error) {
    console.error('[Billing] Hosted billing lookup failed; blocking live call start:', error);
    return {
      allowed: false,
      reason: 'billing_unavailable',
      message: 'Hosted billing state is temporarily unavailable. Live calls are disabled until billing can be verified.',
    };
  }
}

export function getHostedUsageIngestEndpoint(rawUrl = config.billing.usageIngestUrl): string | null {
  if (!rawUrl) return null;
  const normalized = rawUrl.trim().replace(/\/+$/, '');
  return normalized.endsWith('/api/billing/usage') ? normalized : `${normalized}/api/billing/usage`;
}

export async function reportCompletedCallUsageToBillingIngest(params: {
  orgId: string;
  callId: string;
  durationSeconds: number;
  provider?: string;
  occurredAt?: Date;
}): Promise<boolean> {
  const endpoint = getHostedUsageIngestEndpoint();
  if (!endpoint || !config.billing.usageIngestSecret) {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const body = JSON.stringify({
    orgId: params.orgId,
    callId: params.callId,
    durationSeconds: params.durationSeconds,
    provider: params.provider,
    occurredAt: (params.occurredAt ?? new Date()).toISOString(),
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signUsageIngestRequest({
    secret: config.billing.usageIngestSecret,
    rawBody: body,
    timestamp,
    orgId: params.orgId,
    callId: params.callId,
    durationSeconds: params.durationSeconds,
  });
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Usage-Timestamp': timestamp,
        'X-Usage-Signature': signature,
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[Billing] Usage ingest returned HTTP ${response.status}`);
      return false;
    }

    return true;
  } catch {
    console.warn('[Billing] Usage ingest failed; falling back to local usage ledger');
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function flushPendingHostedUsageEvents(limit = 50): Promise<number> {
  if (config.deployment.mode === 'self_hosted' || !getHostedUsageIngestEndpoint() || !config.billing.usageIngestSecret) {
    return 0;
  }

  const pending = await prisma.usageEvent.findMany({
    where: {
      kind: 'voice_seconds',
      stripeReportedAt: null,
      callId: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  }).catch(() => []);

  let flushed = 0;
  for (const event of pending) {
    if (!event.callId || event.quantity <= 0) {
      continue;
    }
    const reported = await reportCompletedCallUsageToBillingIngest({
      orgId: event.orgId,
      callId: event.callId,
      durationSeconds: event.quantity,
      provider: event.provider ?? undefined,
      occurredAt: event.createdAt,
    });
    if (!reported) {
      continue;
    }
    await prisma.usageEvent.update({
      where: { id: event.id },
      data: { stripeReportedAt: new Date() },
    }).catch(() => undefined);
    flushed += 1;
  }

  if (flushed > 0) {
    console.log(`[Billing] Flushed ${flushed} pending hosted usage event${flushed === 1 ? '' : 's'}`);
  }
  return flushed;
}

export async function recordCompletedCallUsage(params: {
  orgId?: string;
  callId: string;
  durationSeconds: number;
  provider?: string;
}): Promise<void> {
  if (config.deployment.mode === 'self_hosted' || params.durationSeconds <= 0) {
    return;
  }

  const orgId = params.orgId;
  if (!orgId) {
    console.error('[Billing] Refusing to record hosted usage without an org id');
    return;
  }

  const reportedToHosted = await reportCompletedCallUsageToBillingIngest({
    orgId,
    callId: params.callId,
    durationSeconds: params.durationSeconds,
    provider: params.provider,
  });

  const existing = await prisma.usageEvent.findFirst({
    where: {
      orgId,
      callId: params.callId,
      kind: 'voice_seconds',
    },
    select: { id: true, stripeReportedAt: true },
  }).catch(() => null);

  if (existing) {
    if (reportedToHosted && !existing.stripeReportedAt) {
      await prisma.usageEvent.update({
        where: { id: existing.id },
        data: { stripeReportedAt: new Date() },
      }).catch(() => undefined);
    }
    return;
  }

  await prisma.usageEvent.create({
    data: {
      orgId,
      callId: params.callId,
      kind: 'voice_seconds',
      quantity: Math.ceil(params.durationSeconds),
      unit: 'second',
      provider: params.provider,
      stripeReportedAt: reportedToHosted ? new Date() : null,
      createdAt: new Date(),
    },
  }).catch((error) => {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') {
      return;
    }
    console.error('[Billing] Failed to record usage event:', error);
  });
}
