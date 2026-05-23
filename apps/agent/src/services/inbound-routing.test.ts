import { describe, expect, it } from 'vitest';
import {
  buildInboundOrgRouteMap,
  normalizeInboundRouteKey,
  parseInboundOrgRoutes,
  resolveInboundOrgId,
} from './inbound-routing';

describe('inbound routing', () => {
  it('parses provider route entries into a normalized org map', () => {
    const routes = buildInboundOrgRouteMap(parseInboundOrgRoutes(
      'twilio:+15551234567=org_abc, plivo:+9199=org_def, asterisk:sip.example.com=org_xyz',
    ));

    expect(routes.get(normalizeInboundRouteKey('twilio', '+15551234567'))).toBe('org_abc');
    expect(routes.get(normalizeInboundRouteKey('plivo', '+9199'))).toBe('org_def');
    expect(routes.get(normalizeInboundRouteKey('asterisk', 'SIP.EXAMPLE.COM'))).toBe('org_xyz');
  });

  it('fails closed for unknown hosted inbound routes', () => {
    const routes = buildInboundOrgRouteMap(parseInboundOrgRoutes('twilio:+15551234567=org_abc'));

    expect(resolveInboundOrgId({
      deploymentMode: 'hosted',
      defaultOrgId: 'default',
      provider: 'twilio',
      event: { To: '+15550000000' },
      routes,
    })).toBeUndefined();
  });

  it('keeps default org fallback for self-hosted inbound routes', () => {
    expect(resolveInboundOrgId({
      deploymentMode: 'self_hosted',
      defaultOrgId: 'default',
      provider: 'plivo',
      event: { To: '+9199' },
      routes: new Map(),
    })).toBe('default');
  });
});
