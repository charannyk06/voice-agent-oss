export function isMutationMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

export function normalizeOrigin(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return null;
  }
}

export function getAllowedRequestOrigins(requestOrigin: string, env?: {
  NEXT_PUBLIC_APP_URL?: string;
  PUBLIC_APP_URL?: string;
  CSRF_ALLOWED_ORIGINS?: string;
}): Set<string> {
  const source = env ?? process.env;
  const allowed = new Set<string>([requestOrigin]);

  for (const value of [source.NEXT_PUBLIC_APP_URL, source.PUBLIC_APP_URL]) {
    const origin = normalizeOrigin(value);
    if (origin) allowed.add(origin);
  }

  for (const raw of (source.CSRF_ALLOWED_ORIGINS || '').split(',')) {
    const origin = normalizeOrigin(raw.trim());
    if (origin) allowed.add(origin);
  }

  return allowed;
}

export function isAllowedMutationOrigin(params: {
  method: string;
  requestOrigin: string;
  originHeader?: string | null;
  refererHeader?: string | null;
  env?: {
    NEXT_PUBLIC_APP_URL?: string;
    PUBLIC_APP_URL?: string;
    CSRF_ALLOWED_ORIGINS?: string;
  };
}): boolean {
  if (!isMutationMethod(params.method)) {
    return true;
  }

  const allowed = getAllowedRequestOrigins(params.requestOrigin, params.env);
  const origin = normalizeOrigin(params.originHeader) ?? normalizeOrigin(params.refererHeader);
  return origin ? allowed.has(origin) : false;
}
