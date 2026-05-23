import { describe, expect, it } from 'vitest';
import { buildCurrentPeriodUsageWhere, evaluateBillingGate, getHostedUsageIngestEndpoint, isHostedSubscriptionActive } from './billing-guard';

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

  it('treats active and trialing subscriptions as usable', () => {
    expect(isHostedSubscriptionActive('active')).toBe(true);
    expect(isHostedSubscriptionActive('trialing')).toBe(true);
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
