import { describe, it, expect } from 'vitest';
import { config, normalizeHostedServiceUrl, normalizeTrustedOrigin, normalizeTrustedOrigins, resolveDeploymentMode, resolveMediaStreamTokenSecret, resolveProductionLike, resolveRequireWebhookSignatures, validateHostedSecurityConfig } from './config';

const safeFixtureSecret = (label: string) => ['voiceagent', label, 'alpha', 'bravo', 'charlie', 'delta', '1234567890'].join('_');
const unsafePlaceholderSecret = ['replace', 'with', 'hosted', 'value', 'before', 'hosting', '1234567890'].join('_');

describe('config', () => {
  it('should have required agent fields', () => {
    expect(config).toBeDefined();
    expect(typeof config.agent.name).toBe('string');
    expect(config.agent.name.length).toBeGreaterThan(0);
    expect(typeof config.agent.maxCallDurationMin).toBe('number');
  });

  it('should have valid business hours format', () => {
    expect(config.agent.businessHoursStart).toMatch(/^\d{2}:\d{2}$/);
    expect(config.agent.businessHoursEnd).toMatch(/^\d{2}:\d{2}$/);
  });

  it('should have valid time-based greeting', () => {
    const { getGreetingForTime } = config.agent;
    expect(typeof getGreetingForTime).toBe('function');

    // Morning boundary (before 12)
    expect(getGreetingForTime(new Date('2024-01-01T08:00:00'))).toContain('morning');
    // Afternoon boundary (12-17)
    expect(getGreetingForTime(new Date('2024-01-01T14:00:00'))).toContain('afternoon');
    // Evening boundary (17-22)
    expect(getGreetingForTime(new Date('2024-01-01T19:00:00'))).toContain('evening');
    // Late night (22-5), should not greet
    expect(getGreetingForTime(new Date('2024-01-01T23:00:00'))).toBe('');
    expect(getGreetingForTime(new Date('2024-01-01T04:00:00'))).toBe('');
  });

  it('should have purpose-based greetings', () => {
    const { getGreetingForPurpose } = config.agent;
    expect(typeof getGreetingForPurpose).toBe('function');

    expect(getGreetingForPurpose('appointment_reminder')).toContain('appointment');
    expect(getGreetingForPurpose('follow_up')).toContain('follow');
    expect(getGreetingForPurpose('service_update')).toContain('service');
    expect(getGreetingForPurpose('general')).toContain('help');
    expect(getGreetingForPurpose('unknown_purpose')).toContain('help'); // falls back to general
  });

  it('should have valid urgent transfer config', () => {
    expect(config.business.urgentTransferNumber).toMatch(/^\+?\d+$/);
    expect(config.agent.bargeInEnabled).toBe(true);
  });

  it('should have valid budget config', () => {
    expect(config.agent.budgetMonthlyCents).toBeGreaterThan(0);
    expect(config.agent.budgetDailyAlertCents).toBeGreaterThan(0);
    expect(config.agent.maxCallDurationMin).toBeGreaterThan(0);
    expect(config.agent.autoApproveBookingsUnderCents).toBeGreaterThanOrEqual(0);
  });

  it('should have valid business name', () => {
    expect(config.business.name.length).toBeGreaterThan(0);
    expect(typeof config.business.adminExtension).toBe('string');
  });

  it('should have server config', () => {
    expect(typeof config.server.port).toBe('number');
    expect(config.server.port).toBeGreaterThan(0);
  });

  it('should expose a supported telephony provider contract', () => {
    expect(['twilio', 'plivo', 'asterisk']).toContain(config.telephony.provider);
    expect(typeof config.asterisk.ariApplication).toBe('string');
    expect(typeof config.asterisk.eventPath).toBe('string');
    expect(typeof config.asterisk.outboundEndpointTemplate).toBe('string');
    expect(typeof config.asterisk.externalMediaBindAddress).toBe('string');
    expect(config.asterisk.eventPath.startsWith('/')).toBe(true);
    expect(config.asterisk.statusPath.startsWith('/')).toBe(true);
    expect(config.asterisk.mediaWsPath.startsWith('/')).toBe(true);
  });

  it('resolves production-style security defaults for hosted deployments', () => {
    expect(resolveDeploymentMode({ DEPLOYMENT_MODE: 'hosted' })).toBe('hosted');
    expect(resolveDeploymentMode({ DEPLOYMENT_MODE: 'unexpected' })).toBe('self_hosted');
    expect(resolveProductionLike({ DEPLOYMENT_MODE: 'hosted' })).toBe(true);
    expect(resolveProductionLike({ NODE_ENV: 'production' })).toBe(true);
    expect(resolveProductionLike({ NODE_ENV: 'development', DEPLOYMENT_MODE: 'self_hosted' })).toBe(false);
  });

  it('requires telephony webhook signatures by default in hosted or production modes', () => {
    expect(resolveRequireWebhookSignatures({ DEPLOYMENT_MODE: 'hosted' })).toBe(true);
    expect(resolveRequireWebhookSignatures({ NODE_ENV: 'production' })).toBe(true);
    expect(resolveRequireWebhookSignatures({ DEPLOYMENT_MODE: 'hosted', REQUIRE_WEBHOOK_SIGNATURES: 'false' })).toBe(false);
    expect(resolveRequireWebhookSignatures({ TWILIO_VALIDATE_SIGNATURE: 'true' })).toBe(true);
    expect(resolveRequireWebhookSignatures({ NODE_ENV: 'development', DEPLOYMENT_MODE: 'self_hosted' })).toBe(false);
  });

  it('uses a separate media stream token secret when provided', () => {
    expect(resolveMediaStreamTokenSecret({
      AGENT_MEDIA_STREAM_TOKEN_SECRET: 'stream-secret',
      AGENT_DASHBOARD_TOKEN_SECRET: 'dashboard-secret',
    })).toBe('stream-secret');
    expect(resolveMediaStreamTokenSecret({
      AGENT_DASHBOARD_TOKEN_SECRET: 'dashboard-secret',
    })).toBe('dashboard-secret');
  });

  it('normalizes trusted hosted origins and service URLs', () => {
    expect(normalizeTrustedOrigin('https://dashboard.example.com/')).toBe('https://dashboard.example.com');
    expect(normalizeTrustedOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeTrustedOrigin('http://dashboard.example.com')).toBeNull();
    expect(normalizeTrustedOrigin('https://dashboard.example.com/path')).toBeNull();
    expect(normalizeTrustedOrigin('*')).toBeNull();
    expect(normalizeTrustedOrigins([
      'https://dashboard.example.com/',
      'https://dashboard.example.com',
      'https://billing.example.com',
      'javascript:alert(1)',
    ])).toEqual(['https://dashboard.example.com', 'https://billing.example.com']);
    expect(normalizeHostedServiceUrl('https://dashboard.example.com/api/billing/usage/')).toBe('https://dashboard.example.com/api/billing/usage');
    expect(normalizeHostedServiceUrl('http://localhost:3000/api/billing/usage')).toBe('http://localhost:3000/api/billing/usage');
    expect(normalizeHostedServiceUrl('https://dashboard.example.com/api/billing/usage?debug=true')).toBeNull();
    expect(normalizeHostedServiceUrl('http://dashboard.example.com/api/billing/usage')).toBeNull();
  });

  it('fails hosted security validation when payment-protected runtime checks are disabled', () => {
    expect(validateHostedSecurityConfig({
      deploymentMode: 'hosted',
      requireDashboardToken: false,
      dashboardTokenSecret: 'short',
      mediaStreamTokenSecret: 'short',
      dashboardAllowedOrigins: [],
      dashboardAllowedOriginErrors: ['https://dashboard.example.com/path'],
      requireWebhookSignatures: false,
      usageIngestUrl: '',
      usageIngestSecret: 'short',
    })).toEqual([
      'REQUIRE_DASHBOARD_TOKEN must stay enabled in hosted mode',
      'AGENT_DASHBOARD_TOKEN_SECRET must be at least 32 characters in hosted mode',
      'AGENT_MEDIA_STREAM_TOKEN_SECRET must be at least 32 characters in hosted mode',
      'AGENT_MEDIA_STREAM_TOKEN_SECRET must be separate from AGENT_DASHBOARD_TOKEN_SECRET in hosted mode',
      'DASHBOARD_ALLOWED_ORIGINS must contain at least one trusted dashboard origin in hosted mode',
      'DASHBOARD_ALLOWED_ORIGINS must contain only HTTPS origins or localhost HTTP origins without paths, wildcards, credentials, query strings, or fragments',
      'REQUIRE_WEBHOOK_SIGNATURES must stay enabled in hosted mode',
      'BILLING_USAGE_INGEST_URL must be configured in hosted mode',
      'BILLING_USAGE_INGEST_SECRET must be at least 32 characters in hosted mode',
      'INBOUND_ORG_ROUTES must contain at least one hosted inbound route',
    ]);

    expect(validateHostedSecurityConfig({
      deploymentMode: 'hosted',
      requireDashboardToken: true,
      dashboardTokenSecret: unsafePlaceholderSecret,
      mediaStreamTokenSecret: 'm'.repeat(32),
      dashboardAllowedOrigins: ['https://dashboard.example.com'],
      requireWebhookSignatures: true,
      usageIngestUrl: 'https://dashboard.example.com',
      usageIngestSecret: unsafePlaceholderSecret,
      inboundOrgRouteCount: 1,
    })).toEqual([
      'AGENT_DASHBOARD_TOKEN_SECRET must not use a documented placeholder or example value in hosted mode',
      'AGENT_MEDIA_STREAM_TOKEN_SECRET must be high entropy, not a repeated or low-variety value in hosted mode',
      'BILLING_USAGE_INGEST_SECRET must not use a documented placeholder or example value in hosted mode',
    ]);

    expect(validateHostedSecurityConfig({
      deploymentMode: 'hosted',
      requireDashboardToken: true,
      dashboardTokenSecret: safeFixtureSecret('dash'),
      mediaStreamTokenSecret: safeFixtureSecret('stream'),
      dashboardAllowedOrigins: ['https://dashboard.example.com'],
      requireWebhookSignatures: true,
      usageIngestUrl: 'https://dashboard.example.com',
      usageIngestSecret: safeFixtureSecret('usage'),
      inboundOrgRouteCount: 1,
    })).toEqual([]);

    expect(validateHostedSecurityConfig({
      deploymentMode: 'hosted',
      requireDashboardToken: true,
      dashboardTokenSecret: safeFixtureSecret('dash'),
      mediaStreamTokenSecret: safeFixtureSecret('stream'),
      dashboardAllowedOrigins: ['https://dashboard.example.com'],
      requireWebhookSignatures: true,
      usageIngestUrl: 'http://dashboard.example.com/api/billing/usage',
      usageIngestSecret: safeFixtureSecret('usage'),
      inboundOrgRouteCount: 1,
    })).toContain('BILLING_USAGE_INGEST_URL must be a valid HTTPS URL or localhost HTTP URL in hosted mode');

    expect(validateHostedSecurityConfig({
      deploymentMode: 'self_hosted',
      requireDashboardToken: false,
      dashboardTokenSecret: '',
      mediaStreamTokenSecret: '',
      requireWebhookSignatures: false,
    })).toEqual([]);
  });
});
