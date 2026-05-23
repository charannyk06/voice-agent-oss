export interface ClerkConfigStatus {
  publishableKeyConfigured: boolean;
  secretKeyConfigured: boolean;
  configured: boolean;
}

type ClerkEnv = Record<string, string | undefined> & {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
  VERCEL_ENV?: string;
};

const forbiddenClerkFrontendHosts = new Set([
  "clerk.con" + "ductross.com",
  "accounts.con" + "ductross.com",
]);

function decodeClerkPublishableKeyHost(value?: string): string | null {
  if (!value) return null;

  const encodedFrontendApi = value.trim().replace(/^pk_(?:test|live)_/, "");
  if (encodedFrontendApi === value.trim()) return null;

  try {
    const normalized = encodedFrontendApi.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const decoded = globalThis.atob(padded).replace(/\$$/, "").toLowerCase();

    if (!/^[a-z0-9.-]+$/.test(decoded) || decoded.includes("..")) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

export function isAllowedClerkPublishableKey(value?: string): boolean {
  const frontendHost = decodeClerkPublishableKeyHost(value);
  if (!frontendHost) return true;

  if (forbiddenClerkFrontendHosts.has(frontendHost)) {
    return false;
  }

  return !/(?:con|ductor|ductross)/i.test(frontendHost.replace("con", ""));
}

export function isUsableClerkConfigValue(value?: string): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return ![
    "replace_me",
    "replace-with-clerk-publishable-key",
    "replace_with_clerk_publishable_key",
    "replace_with_clerk_secret_key",
    "pk_test_replace_me",
  ].includes(normalized) && !normalized.includes("replace_with") && !normalized.includes("replace-with");
}

function isVercelProduction(env: ClerkEnv): boolean {
  return env.VERCEL_ENV === "production";
}

function hasProductionClerkKeys(env: ClerkEnv): boolean {
  return env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim().startsWith("pk_live_") === true
    && env.CLERK_SECRET_KEY?.trim().startsWith("sk_live_") === true;
}

export function getClerkConfigStatus(env?: ClerkEnv): ClerkConfigStatus {
  const source = env ?? process.env;
  const publishableKeyConfigured = isUsableClerkConfigValue(source.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    && isAllowedClerkPublishableKey(source.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const secretKeyConfigured = isUsableClerkConfigValue(source.CLERK_SECRET_KEY);
  const configured = publishableKeyConfigured
    && secretKeyConfigured
    && (!isVercelProduction(source) || hasProductionClerkKeys(source));

  return {
    publishableKeyConfigured,
    secretKeyConfigured,
    configured,
  };
}
