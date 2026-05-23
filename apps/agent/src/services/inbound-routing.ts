import type { TelephonyProviderName } from './telephony/types';

export type DeploymentMode = 'self_hosted' | 'hosted';

export interface InboundOrgRoute {
  provider: TelephonyProviderName;
  routeKey: string;
  orgId: string;
}

export type InboundOrgRouteMap = Map<string, string>;

export function normalizeInboundRouteKey(provider: TelephonyProviderName, routeKey: string): string {
  return `${provider}:${routeKey.trim().toLowerCase()}`;
}

export function parseInboundOrgRoutes(raw: string | undefined): InboundOrgRoute[] {
  return (raw || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [left, ...orgParts] = entry.split('=');
      const [provider, ...routeParts] = left.split(':');
      const orgId = orgParts.join('=').trim();
      const routeKey = routeParts.join(':').trim();
      if (
        (provider !== 'twilio' && provider !== 'plivo' && provider !== 'asterisk') ||
        !routeKey ||
        !orgId
      ) {
        throw new Error(`Invalid INBOUND_ORG_ROUTES entry: ${entry}`);
      }
      return { provider, routeKey, orgId };
    });
}

export function buildInboundOrgRouteMap(routes: InboundOrgRoute[]): InboundOrgRouteMap {
  const map: InboundOrgRouteMap = new Map();
  for (const route of routes) {
    map.set(normalizeInboundRouteKey(route.provider, route.routeKey), route.orgId);
  }
  return map;
}

export function extractInboundRouteKey(
  provider: TelephonyProviderName,
  event: Record<string, string>,
  fallback?: string,
): string | undefined {
  if (provider === 'twilio') {
    return event.To || event.Called || event.CalledNumber || fallback;
  }
  if (provider === 'plivo') {
    return event.To || event.ToNumber || event.CalledNumber || fallback;
  }

  return (
    event.inbound_route ||
    event.InboundRoute ||
    event.sip_domain ||
    event.SipDomain ||
    event.domain ||
    event.Domain ||
    event.host ||
    event.Host ||
    fallback
  );
}

export function resolveInboundOrgId(params: {
  deploymentMode: DeploymentMode;
  defaultOrgId: string;
  provider: TelephonyProviderName;
  event: Record<string, string>;
  routes: InboundOrgRouteMap;
  fallbackRouteKey?: string;
}): string | undefined {
  const routeKey = extractInboundRouteKey(params.provider, params.event, params.fallbackRouteKey);
  if (routeKey) {
    const routedOrgId = params.routes.get(normalizeInboundRouteKey(params.provider, routeKey));
    if (routedOrgId) {
      return routedOrgId;
    }
  }

  return params.deploymentMode === 'self_hosted' ? params.defaultOrgId : undefined;
}
