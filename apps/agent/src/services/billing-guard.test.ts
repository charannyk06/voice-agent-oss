import { describe, expect, it } from 'vitest';
import {
  allowsHostedTrialingUsage,
  buildCurrentPeriodUsageWhere,
  evaluateBillingGate,
  getHostedQuotaSeconds,
  getHostedUsageIngestEndpoint,
  isHostedSubscriptionActive,
} from './billing-guard';

describe('billing-guard', () => {
  it('allows self-hosted usage without Stripe state', () => {
    expect(evaluateBillingGate({ deploymentMode: 'self_hosted' })).toEqual({ allowed: true });
  });

  it('blocks hosted live calls without an active subscription', () => {
    expect(evaluateBillingGate({ deploymentMode: 'hosted', subscriptionStatus: 'past_due' })).toMatchObject({
      allowed: false,
      reason: 'subscription_inactive',
    });
  });

  it('blocks hosted usage when the monthly quota is exhausted', () => {
    expect(evaluateBillingGate({
      deploymentMode: 'hosted',
      subscriptionStatus: 'active',
      monthlyQuotaSeconds: 60,
      usedSecondsThisPeriod: 60,
    })).toMatchObject({
      allowed: false,
      reason: 'quota_exhausted',
    });
  });

  it('blocks hosted usage when active or pending calls would overrun the quota', () => {
    expect(evaluateBillingGate({
      deploymentMode: 'hosted',
      subscriptionStatus: 'active',
      monthlyQuotaSeconds: 3600,
      usedSecondsThisPeriod: 3000,
      reservedSecondsThisPeriod: 600,
    })).toEqual({ allowed: true });

    expect(evaluateBillingGate({
      deploymentMode: 'hosted',
      subscriptionStatus: 'active',
      monthlyQuotaSeconds: 3600,
      usedSecondsThisPeriod: 3000,
      reservedSecondsThisPeriod: 601,
    })).toMatchObject({
      allowed: false,
      reason: 'quota_exhausted',
    });
  });

  it('blocks hosted usage against the default launch quota when an active org has no stored quota', () => {
    expect(getHostedQuotaSeconds(0, { HOSTED_MONTHLY_INCLUDED_MINUTES: '2' })).toBe(120);
    expect(evaluateBillingGate({
      deploymentMode: 'hosted',
      subscriptionStatus: 'active',
      monthlyQuotaSeconds: 0,
      usedSecondsThisPeriod: 60 * 60,
    })).toMatchObject({
      allowed: false,
      reason: 'quota_exhausted',
    });
  });

  it('requires paid active subscriptions by default', () => {
    expect(isHostedSubscriptionActive('active')).toBe(true);
    expect(isHostedSubscriptionActive('trialing')).toBe(false);
    expect(isHostedSubscriptionActive('trialing', { HOSTED_ALLOW_TRIALING_USAGE: 'true' })).toBe(true);
    expect(allowsHostedTrialingUsage({ HOSTED_ALLOW_TRIALING_USAGE: 'true' })).toBe(true);
    expect(isHostedSubscriptionActive('canceled')).toBe(false);
  });

  it('normalizes hosted usage ingest endpoint URLs', () => {
    expect(getHostedUsageIngestEndpoint('')).toBeNull();
    expect(getHostedUsageIngestEndpoint('https://app.example.com')).toBe('https://app.example.com/api/billing/usage');
    expect(getHostedUsageIngestEndpoint('https://app.example.com/')).toBe('https://app.example.com/api/billing/usage');
    expect(getHostedUsageIngestEndpoint(' https://app.example.com/api/billing/usage/ ')).toBe('https://app.example.com/api/billing/usage');
    expect(getHostedUsageIngestEndpoint('https://app.example.com/api/billing/usage')).toBe('https://app.example.com/api/billing/usage');
  });

  it('scopes usage lookups to the active subscription period', () => {
    const start = new Date('2026-05-01T00:00:00Z');
    const end = new Date('2026-06-01T00:00:00Z');
    expect(buildCurrentPeriodUsageWhere('org_1', { currentPeriodStart: start, currentPeriodEnd: end })).toEqual({
      orgId: 'org_1',
      kind: 'voice_seconds',
      createdAt: { gte: start, lt: end },
    });
  });
});
