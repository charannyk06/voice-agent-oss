import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type Stripe from "stripe";
import { ApiError } from "./api";
import { buildCurrentPeriodUsageWhere, getDeploymentMode, getHostedQuotaSeconds, isSubscriptionUsable } from "./billing";
import { prisma } from "./prisma";
import { getSharedSecretValidationIssue } from "./secret-safety";
import { getStripeClient } from "./stripe";

export interface UsageMeterEnv {
  BILLING_USAGE_INGEST_SECRET?: string;
  DEPLOYMENT_MODE?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_PRICE_BASE_MONTHLY?: string;
  STRIPE_METER_EVENT_NAME?: string;
  STRIPE_METER_CUSTOMER_KEY?: string;
  STRIPE_METER_VALUE_KEY?: string;
}

export interface VoiceUsageInput {
  orgId: string;
  callId: string;
  durationSeconds: number;
  provider?: string;
  occurredAt?: Date;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function buildUsageSignaturePayload(params: {
  rawBody: string;
  timestamp: string;
  orgId: string;
  callId: string;
  durationSeconds: number;
}): string {
  return [
    params.timestamp,
    params.orgId,
    params.callId,
    String(params.durationSeconds),
    params.rawBody,
  ].join(".");
}

export function signUsageIngestRequest(params: {
  secret: string;
  rawBody: string;
  timestamp: string;
  orgId: string;
  callId: string;
  durationSeconds: number;
}): string {
  return `sha256=${createHmac("sha256", params.secret)
    .update(buildUsageSignaturePayload(params))
    .digest("base64")}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

export function getUsageIngestSecret(env?: UsageMeterEnv): string {
  return (env ?? process.env).BILLING_USAGE_INGEST_SECRET || "";
}

export function verifyUsageIngestAuthorization(
  headers: Headers,
  env?: UsageMeterEnv,
  body?: {
    rawBody: string;
    orgId: string;
    callId: string;
    durationSeconds: number;
    now?: Date;
    maxSkewSeconds?: number;
  },
): void {
  const secret = getUsageIngestSecret(env);
  if (!secret) {
    throw new ApiError(500, "Usage ingest secret is not configured");
  }
  const deploymentMode = getDeploymentMode(env);
  if (deploymentMode === "hosted") {
    const secretIssue = getSharedSecretValidationIssue("Usage ingest secret", secret);
    if (secretIssue) {
      throw new ApiError(500, secretIssue);
    }
  }

  if (body) {
    const timestamp = headers.get("x-usage-timestamp") || "";
    const suppliedSignature = headers.get("x-usage-signature") || "";
    const parsedTimestamp = Number(timestamp);
    const nowSeconds = Math.floor((body.now ?? new Date()).getTime() / 1000);
    const maxSkewSeconds = body.maxSkewSeconds ?? 300;

    if (!Number.isFinite(parsedTimestamp) || Math.abs(nowSeconds - parsedTimestamp) > maxSkewSeconds) {
      throw new ApiError(401, "Usage ingest timestamp is stale");
    }

    const expectedSignature = signUsageIngestRequest({
      secret,
      rawBody: body.rawBody,
      timestamp,
      orgId: body.orgId,
      callId: body.callId,
      durationSeconds: body.durationSeconds,
    });
    if (!constantTimeEqual(suppliedSignature, expectedSignature)) {
      throw new ApiError(401, "Unauthorized usage ingest request");
    }
    return;
  }

  throw new ApiError(401, "Unauthorized usage ingest request");
}

export function getStripeMeterConfig(env?: UsageMeterEnv): {
  eventName: string;
  customerKey: string;
  valueKey: string;
} | null {
  const source = env ?? process.env;
  const eventName = source.STRIPE_METER_EVENT_NAME;
  if (!eventName) return null;

  return {
    eventName,
    customerKey: source.STRIPE_METER_CUSTOMER_KEY || "stripe_customer_id",
    valueKey: source.STRIPE_METER_VALUE_KEY || "value",
  };
}

export function normalizeUsageQuantity(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new ApiError(400, "durationSeconds must be a positive number");
  }
  return Math.ceil(durationSeconds);
}

export type HostedUsageIngestGateResult =
  | { allowed: true }
  | { allowed: false; reason: "subscription_inactive" | "quota_exhausted"; message: string };

export function evaluateHostedUsageIngestGate(input: {
  subscriptionStatus?: string | null;
  usedSecondsThisPeriod?: number | null;
  incomingSeconds: number;
  quotaSeconds: number;
}): HostedUsageIngestGateResult {
  if (!isSubscriptionUsable(input.subscriptionStatus)) {
    return {
      allowed: false,
      reason: "subscription_inactive",
      message: "Hosted usage can only be recorded for an active paid billing subscription.",
    };
  }

  const used = Math.max(0, input.usedSecondsThisPeriod ?? 0);
  if (input.quotaSeconds > 0 && used + input.incomingSeconds > input.quotaSeconds) {
    return {
      allowed: false,
      reason: "quota_exhausted",
      message: "Hosted usage quota is exhausted for this billing period.",
    };
  }

  return { allowed: true };
}

export function createStripeMeterIdentifier(orgId: string, callId: string): string {
  const digest = createHash("sha256").update(`${orgId}:${callId}`).digest("hex").slice(0, 40);
  return `voice_call_${digest}`;
}

export async function reportUsageToStripeMeter(params: {
  stripe: Stripe;
  orgId: string;
  customerId: string;
  quantity: number;
  callId: string;
  occurredAt?: Date;
  env?: UsageMeterEnv;
}): Promise<string | null> {
  const config = getStripeMeterConfig(params.env);
  if (!config) return null;

  const identifier = createStripeMeterIdentifier(params.orgId, params.callId);
  const timestamp = Math.floor((params.occurredAt ?? new Date()).getTime() / 1000);
  await params.stripe.billing.meterEvents.create({
    event_name: config.eventName,
    identifier,
    timestamp,
    payload: {
      [config.customerKey]: params.customerId,
      [config.valueKey]: String(params.quantity),
    },
  });

  return identifier;
}

export async function recordHostedVoiceUsage(input: VoiceUsageInput): Promise<{
  recorded: boolean;
  duplicate: boolean;
  stripeReported: boolean;
}> {
  const quantity = normalizeUsageQuantity(input.durationSeconds);
  const org = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: {
      id: true,
      stripeCustomerId: true,
      subscriptionStatus: true,
      minuteQuotaMonthly: true,
      subscriptions: {
        where: { status: { in: ["active", "trialing"] } },
        orderBy: { currentPeriodEnd: "desc" },
        take: 1,
      },
    },
  });

  if (!org) {
    throw new ApiError(404, "Organization not found");
  }

  let duplicate = false;
  let usageEvent = await prisma.usageEvent.findFirst({
    where: {
      orgId: input.orgId,
      callId: input.callId,
      kind: "voice_seconds",
    },
  });

  if (usageEvent) {
    duplicate = true;
  } else {
    const currentSubscription = org.subscriptions[0];
    const usedSeconds = await prisma.usageEvent.aggregate({
      where: buildCurrentPeriodUsageWhere(org.id, currentSubscription ?? undefined),
      _sum: { quantity: true },
    });
    const quotaSeconds = getHostedQuotaSeconds(org.minuteQuotaMonthly);
    const gate = evaluateHostedUsageIngestGate({
      subscriptionStatus: currentSubscription?.status ?? org.subscriptionStatus,
      usedSecondsThisPeriod: usedSeconds._sum.quantity ?? 0,
      incomingSeconds: quantity,
      quotaSeconds,
    });

    if (gate.allowed === false) {
      throw new ApiError(402, gate.message);
    }

    usageEvent = await prisma.usageEvent.create({
      data: {
        orgId: input.orgId,
        callId: input.callId,
        kind: "voice_seconds",
        quantity,
        unit: "second",
        provider: input.provider,
        createdAt: input.occurredAt ?? undefined,
      },
    }).catch(async (error: unknown) => {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      duplicate = true;
      return prisma.usageEvent.findFirst({
        where: {
          orgId: input.orgId,
          callId: input.callId,
          kind: "voice_seconds",
        },
      });
    });
  }

  if (!usageEvent) {
    throw new ApiError(409, "Usage event already exists but could not be loaded");
  }

  if (usageEvent.stripeReportedAt) {
    return {
      recorded: true,
      duplicate: true,
      stripeReported: true,
    };
  }

  if (!org.stripeCustomerId) {
    return { recorded: true, duplicate, stripeReported: false };
  }

  const stripeIdentifier = await reportUsageToStripeMeter({
    stripe: getStripeClient(),
    orgId: org.id,
    customerId: org.stripeCustomerId,
    quantity: usageEvent.quantity,
    callId: usageEvent.callId ?? input.callId,
    occurredAt: usageEvent.createdAt,
  });

  if (stripeIdentifier) {
    usageEvent = await prisma.usageEvent.update({
      where: { id: usageEvent.id },
      data: {
        stripeEventId: stripeIdentifier,
        stripeReportedAt: new Date(),
      },
    });
  }

  return { recorded: true, duplicate, stripeReported: Boolean(usageEvent.stripeReportedAt) };
}
