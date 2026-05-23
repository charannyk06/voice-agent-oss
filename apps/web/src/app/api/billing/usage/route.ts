import { ApiError, ensureString, handleRouteError, json, optionalNumber, optionalString } from "@/lib/api";
import {
  recordHostedVoiceUsage,
  verifyUsageIngestAuthorization,
} from "@/lib/usage-metering";

export const runtime = "nodejs";

interface UsageBody {
  orgId?: unknown;
  callId?: unknown;
  durationSeconds?: unknown;
  provider?: unknown;
  occurredAt?: unknown;
}

function optionalDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, "occurredAt must be a valid date");
  }
  return date;
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    let body: UsageBody;
    try {
      body = JSON.parse(rawBody) as UsageBody;
    } catch {
      throw new ApiError(400, "Invalid JSON body");
    }
    const orgId = ensureString(body.orgId, "orgId");
    const callId = ensureString(body.callId, "callId");
    const durationSeconds = optionalNumber(body.durationSeconds, "durationSeconds");

    if (durationSeconds === undefined) {
      throw new ApiError(400, "durationSeconds is required");
    }

    verifyUsageIngestAuthorization(request.headers, undefined, {
      rawBody,
      orgId,
      callId,
      durationSeconds,
    });

    const result = await recordHostedVoiceUsage({
      orgId,
      callId,
      durationSeconds,
      provider: optionalString(body.provider),
      occurredAt: optionalDate(body.occurredAt),
    });

    return json(result, result.duplicate ? 200 : 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
