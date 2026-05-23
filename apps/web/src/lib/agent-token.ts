import { createHmac, timingSafeEqual } from "node:crypto";

export type AgentTokenAction = "calls:read" | "calls:write" | "billing:read";

export interface AgentTokenPayload {
  userId: string;
  orgId: string;
  subscriptionStatus: string;
  allowedActions: AgentTokenAction[];
  exp?: number;
  iat?: number;
}

interface TokenOptions {
  secret: string;
  ttlSeconds?: number;
  now?: Date;
}

interface VerifyOptions {
  secret: string;
  requiredAction?: AgentTokenAction;
  now?: Date;
}

export type AgentTokenVerifyResult =
  | { ok: true; payload: AgentTokenPayload }
  | { ok: false; reason: string };

function signPayload(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createAgentToken(
  payload: Omit<AgentTokenPayload, "exp" | "iat">,
  options: TokenOptions,
) {
  if (!options.secret) {
    throw new Error("Agent token secret is required");
  }

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const encodedPayload = Buffer.from(JSON.stringify({
    ...payload,
    iat: nowSeconds,
    exp: nowSeconds + (options.ttlSeconds ?? 60),
  })).toString("base64url");
  return `${encodedPayload}.${signPayload(encodedPayload, options.secret)}`;
}

export function verifyAgentToken(token: string | undefined, options: VerifyOptions): AgentTokenVerifyResult {
  if (!token) return { ok: false, reason: "missing_token" };
  if (!options.secret) return { ok: false, reason: "missing_secret" };

  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra !== undefined) {
    return { ok: false, reason: "malformed_token" };
  }

  const expected = signPayload(encodedPayload, options.secret);
  if (!safeEqual(signature, expected)) {
    return { ok: false, reason: "invalid_signature" };
  }

  let payload: AgentTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as AgentTokenPayload;
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) {
    return { ok: false, reason: "expired_token" };
  }

  if (options.requiredAction && !payload.allowedActions.includes(options.requiredAction)) {
    return { ok: false, reason: "missing_action" };
  }

  return { ok: true, payload };
}
