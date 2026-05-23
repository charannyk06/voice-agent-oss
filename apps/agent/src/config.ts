import 'dotenv/config';
import { buildInboundOrgRouteMap, parseInboundOrgRoutes } from './services/inbound-routing';

export type TelephonyProviderName = 'twilio' | 'plivo' | 'asterisk';

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function withLeadingSlash(value: string): string {
  return value.startsWith('/') ? value : `/${value}`;
}

function optionalInt(value: string | undefined, fallback = 0): number {
  const parsed = parseInt(value || '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return value === 'true';
}

function csv(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isLocalHttpHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function normalizeTrustedOrigin(value: string): string | null {
  const raw = value.trim().replace(/\/$/, '');
  if (!raw || raw === '*') return null;

  try {
    const url = new URL(raw);
    const isAllowedProtocol = url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHttpHost(url.hostname));
    if (!isAllowedProtocol) return null;
    if (url.username || url.password) return null;
    if (url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function normalizeTrustedOrigins(values: string[]): string[] {
  const origins = new Set<string>();
  for (const value of values) {
    const origin = normalizeTrustedOrigin(value);
    if (origin) origins.add(origin);
  }
  return [...origins];
}

function invalidTrustedOrigins(values: string[]): string[] {
  return values.filter((value) => normalizeTrustedOrigin(value) === null);
}

const UNSAFE_HOSTED_SECRET_MARKERS = [
  'replace',
  'change_me',
  'change-me',
  'changeme',
  'placeholder',
  'example',
  'your_',
  'your-',
  'set_a_',
  'before_hosting',
  '32-plus',
  'random-characters',
  'secret-key',
  'secret_key',
  'password',
];

function getHostedSecretValidationIssue(name: string, value: string, minLength = 32): string | null {
  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    return `${name} must be at least ${minLength} characters in hosted mode`;
  }

  const normalized = trimmed.toLowerCase();
  if (UNSAFE_HOSTED_SECRET_MARKERS.some((marker) => normalized.includes(marker))) {
    return `${name} must not use a documented placeholder or example value in hosted mode`;
  }

  if (new Set(trimmed).size < 8 || /^(.)\1+$/.test(trimmed)) {
    return `${name} must be high entropy, not a repeated or low-variety value in hosted mode`;
  }

  return null;
}

export function normalizeHostedServiceUrl(value: string): string | null {
  const raw = stripTrailingSlash(value.trim());
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const isAllowedProtocol = url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHttpHost(url.hostname));
    if (!isAllowedProtocol) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return stripTrailingSlash(url.toString());
  } catch {
    return null;
  }
}

const dashboardAllowedOriginValues = csv(process.env.DASHBOARD_ALLOWED_ORIGINS);

export function resolveDeploymentMode(env?: { DEPLOYMENT_MODE?: string }): 'self_hosted' | 'hosted' {
  return (env ?? process.env).DEPLOYMENT_MODE === 'hosted' ? 'hosted' : 'self_hosted';
}

export function resolveProductionLike(
  env?: { NODE_ENV?: string; DEPLOYMENT_MODE?: string },
): boolean {
  const source = env ?? process.env;
  const mode = source.DEPLOYMENT_MODE === 'hosted' ? 'hosted' : 'self_hosted';
  return source.NODE_ENV === 'production' || mode === 'hosted';
}

export function resolveRequireWebhookSignatures(
  env?: {
    NODE_ENV?: string;
    DEPLOYMENT_MODE?: string;
    REQUIRE_WEBHOOK_SIGNATURES?: string;
    TWILIO_VALIDATE_SIGNATURE?: string;
    PLIVO_VALIDATE_SIGNATURE?: string;
  },
): boolean {
  const source = env ?? process.env;
  const productionDefault = source.NODE_ENV === 'production' || source.DEPLOYMENT_MODE === 'hosted';
  return optionalBoolean(
    source.REQUIRE_WEBHOOK_SIGNATURES ?? source.TWILIO_VALIDATE_SIGNATURE ?? source.PLIVO_VALIDATE_SIGNATURE,
    productionDefault,
  );
}

export function resolveMediaStreamTokenSecret(env?: {
  AGENT_MEDIA_STREAM_TOKEN_SECRET?: string;
  AGENT_DASHBOARD_TOKEN_SECRET?: string;
}): string {
  const source = env ?? process.env;
  return source.AGENT_MEDIA_STREAM_TOKEN_SECRET || source.AGENT_DASHBOARD_TOKEN_SECRET || '';
}

export function validateHostedSecurityConfig(input: {
  deploymentMode: 'self_hosted' | 'hosted';
  requireDashboardToken: boolean;
  dashboardTokenSecret: string;
  mediaStreamTokenSecret: string;
  dashboardAllowedOrigins?: string[];
  dashboardAllowedOriginErrors?: string[];
  requireWebhookSignatures: boolean;
  usageIngestUrl?: string;
  usageIngestSecret?: string;
  inboundOrgRouteCount?: number;
}): string[] {
  if (input.deploymentMode !== 'hosted') {
    return [];
  }

  const issues: string[] = [];
  if (!input.requireDashboardToken) {
    issues.push('REQUIRE_DASHBOARD_TOKEN must stay enabled in hosted mode');
  }
  const dashboardTokenIssue = getHostedSecretValidationIssue('AGENT_DASHBOARD_TOKEN_SECRET', input.dashboardTokenSecret);
  if (dashboardTokenIssue) {
    issues.push(dashboardTokenIssue);
  }
  const mediaStreamTokenIssue = getHostedSecretValidationIssue('AGENT_MEDIA_STREAM_TOKEN_SECRET', input.mediaStreamTokenSecret);
  if (mediaStreamTokenIssue) {
    issues.push(mediaStreamTokenIssue);
  }
  if (input.mediaStreamTokenSecret && input.mediaStreamTokenSecret === input.dashboardTokenSecret) {
    issues.push('AGENT_MEDIA_STREAM_TOKEN_SECRET must be separate from AGENT_DASHBOARD_TOKEN_SECRET in hosted mode');
  }
  if (!input.dashboardAllowedOrigins || input.dashboardAllowedOrigins.length === 0) {
    issues.push('DASHBOARD_ALLOWED_ORIGINS must contain at least one trusted dashboard origin in hosted mode');
  }
  if ((input.dashboardAllowedOriginErrors ?? []).length > 0) {
    issues.push('DASHBOARD_ALLOWED_ORIGINS must contain only HTTPS origins or localhost HTTP origins without paths, wildcards, credentials, query strings, or fragments');
  }
  if (!input.requireWebhookSignatures) {
    issues.push('REQUIRE_WEBHOOK_SIGNATURES must stay enabled in hosted mode');
  }
  if (!input.usageIngestUrl) {
    issues.push('BILLING_USAGE_INGEST_URL must be configured in hosted mode');
  } else if (!normalizeHostedServiceUrl(input.usageIngestUrl)) {
    issues.push('BILLING_USAGE_INGEST_URL must be a valid HTTPS URL or localhost HTTP URL in hosted mode');
  }
  const usageIngestSecretIssue = getHostedSecretValidationIssue('BILLING_USAGE_INGEST_SECRET', input.usageIngestSecret || '');
  if (usageIngestSecretIssue) {
    issues.push(usageIngestSecretIssue);
  }
  if ((input.inboundOrgRouteCount ?? 0) < 1) {
    issues.push('INBOUND_ORG_ROUTES must contain at least one hosted inbound route');
  }
  return issues;
}

const deploymentMode = resolveDeploymentMode();
const productionLike = resolveProductionLike();
const requireWebhookSignatures = resolveRequireWebhookSignatures();

const sharedPublicBaseUrl = stripTrailingSlash(
  process.env.TELEPHONY_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || ''
);
const rawBillingUsageIngestUrl = stripTrailingSlash(process.env.BILLING_USAGE_INGEST_URL || '');
const billingUsageIngestUrl = normalizeHostedServiceUrl(rawBillingUsageIngestUrl) || rawBillingUsageIngestUrl;
const telephonyProvider = (() => {
  const explicit = (process.env.TELEPHONY_PROVIDER || '').toLowerCase();
  if (explicit === 'twilio' || explicit === 'plivo' || explicit === 'asterisk') {
    return explicit as TelephonyProviderName;
  }
  if (process.env.PLIVO_AUTH_ID) {
    return 'plivo';
  }
  if (
    process.env.ASTERISK_ARI_BASE_URL ||
    process.env.ASTERISK_PJSIP_ENDPOINT ||
    process.env.ASTERISK_SIP_DOMAIN
  ) {
    return 'asterisk';
  }
  return 'twilio';
})();
const twilioPublicBaseUrl = stripTrailingSlash(
  process.env.TWILIO_PUBLIC_BASE_URL || sharedPublicBaseUrl
);
const plivoPublicBaseUrl = stripTrailingSlash(
  process.env.PLIVO_PUBLIC_BASE_URL || sharedPublicBaseUrl
);
const twilioWebhookPath = withLeadingSlash(
  process.env.TWILIO_WEBHOOK_PATH || '/webhook/twilio'
);
const plivoAnswerPath = withLeadingSlash(
  process.env.PLIVO_ANSWER_PATH || '/webhook/plivo/answer'
);
const plivoStatusPath = withLeadingSlash(
  process.env.PLIVO_STATUS_PATH || '/webhook/plivo/status'
);
const asteriskEventPath = withLeadingSlash(
  process.env.ASTERISK_EVENT_PATH || '/webhook/asterisk/events'
);
const asteriskStatusPath = withLeadingSlash(
  process.env.ASTERISK_STATUS_PATH || '/webhook/asterisk/status'
);
const asteriskMediaWsPath = withLeadingSlash(
  process.env.ASTERISK_MEDIA_WS_PATH || '/stream/asterisk'
);

export const config = {
  deployment: {
    mode: deploymentMode as 'self_hosted' | 'hosted',
    productionLike,
    defaultOrgId: process.env.AGENT_DEFAULT_ORG_ID || 'default',
  },
  security: {
    dashboardTokenSecret: process.env.AGENT_DASHBOARD_TOKEN_SECRET || '',
    mediaStreamTokenSecret: resolveMediaStreamTokenSecret(),
    dashboardAllowedOrigins: normalizeTrustedOrigins(dashboardAllowedOriginValues),
    dashboardAllowedOriginErrors: invalidTrustedOrigins(dashboardAllowedOriginValues),
    requireDashboardToken: optionalBoolean(
      process.env.REQUIRE_DASHBOARD_TOKEN,
      productionLike,
    ),
    requireWebhookSignatures,
  },
  billing: {
    usageIngestUrl: billingUsageIngestUrl,
    usageIngestSecret: process.env.BILLING_USAGE_INGEST_SECRET || '',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    liveModel: process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview',
    languageCode: process.env.GEMINI_LANGUAGE_CODE || 'en-US',
    voiceName: process.env.GEMINI_VOICE_NAME || 'Kore',
    inputSampleRate: parseInt(process.env.GEMINI_INPUT_SAMPLE_RATE || '16000', 10),
    outputSampleRate: parseInt(process.env.GEMINI_OUTPUT_SAMPLE_RATE || '24000', 10),
  },
  deepgram: {
    apiKey: process.env.DEEPGRAM_API_KEY || '',
  },
  externalSearch: {
    provider: process.env.EXTERNAL_SEARCH_PROVIDER || '',
    apiKey: process.env.EXTERNAL_SEARCH_API_KEY || '',
    model: process.env.EXTERNAL_SEARCH_MODEL || '',
    baseUrl: stripTrailingSlash(process.env.EXTERNAL_SEARCH_BASE_URL || ''),
  },
  telephony: {
    provider: telephonyProvider,
    publicBaseUrl: sharedPublicBaseUrl,
    inboundOrgRoutes: buildInboundOrgRouteMap(parseInboundOrgRoutes(process.env.INBOUND_ORG_ROUTES)),
    streamAllowedIps: csv(process.env.TELEPHONY_STREAM_ALLOWED_IPS),
    streamAllowedOrigins: csv(process.env.TELEPHONY_STREAM_ALLOWED_ORIGINS),
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
    publicBaseUrl: twilioPublicBaseUrl,
    webhookPath: twilioWebhookPath,
    mediaStreamUrl: process.env.TWILIO_MEDIA_STREAM_URL || '',
    validateSignature: requireWebhookSignatures,
  },
  plivo: {
    authId: process.env.PLIVO_AUTH_ID || '',
    authToken: process.env.PLIVO_AUTH_TOKEN || '',
    phoneNumber: process.env.PLIVO_PHONE_NUMBER || '',
    publicBaseUrl: plivoPublicBaseUrl,
    answerPath: plivoAnswerPath,
    statusPath: plivoStatusPath,
    mediaStreamUrl: process.env.PLIVO_MEDIA_STREAM_URL || '',
    validateSignature: requireWebhookSignatures,
  },
  asterisk: {
    ariBaseUrl: stripTrailingSlash(process.env.ASTERISK_ARI_BASE_URL || ''),
    ariUsername: process.env.ASTERISK_ARI_USERNAME || '',
    ariPassword: process.env.ASTERISK_ARI_PASSWORD || '',
    ariApplication: process.env.ASTERISK_ARI_APPLICATION || 'voice-agent',
    publicHost: process.env.ASTERISK_PUBLIC_HOST || '',
    sipDomain: process.env.ASTERISK_SIP_DOMAIN || '',
    pjsipEndpoint: process.env.ASTERISK_PJSIP_ENDPOINT || 'byoc-trunk',
    inboundContext: process.env.ASTERISK_INBOUND_CONTEXT || 'voice-agent-inbound',
    outboundContext: process.env.ASTERISK_OUTBOUND_CONTEXT || 'voice-agent-outbound',
    eventPath: asteriskEventPath,
    statusPath: asteriskStatusPath,
    mediaWsPath: asteriskMediaWsPath,
    externalMediaHost: process.env.ASTERISK_EXTERNAL_MEDIA_HOST || '',
    externalMediaBindAddress: process.env.ASTERISK_EXTERNAL_MEDIA_BIND_ADDRESS || '0.0.0.0',
    externalMediaPort: optionalInt(process.env.ASTERISK_EXTERNAL_MEDIA_PORT),
    outboundEndpointTemplate:
      process.env.ASTERISK_OUTBOUND_ENDPOINT_TEMPLATE || 'PJSIP/{to}@{endpoint}',
  },
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || '',
    voiceId: process.env.ELEVENLABS_VOICE_ID || '',
  },
  database: {
    url: process.env.DATABASE_URL || 'file:../web/prisma/dev.db',
  },
  agent: {
    name: process.env.AGENT_NAME || 'Reception Desk',
    maxCallDurationMin: parseInt(process.env.MAX_CALL_DURATION_MIN || '15', 10),
    role: process.env.AGENT_ROLE || 'generic_business_frontdesk',
    businessHoursStart: process.env.BUSINESS_HOURS_START || '08:00',
    businessHoursEnd: process.env.BUSINESS_HOURS_END || '21:00',
    budgetMonthlyCents: parseInt(process.env.BUDGET_MONTHLY_CENTS || '70000', 10),
    budgetDailyAlertCents: parseInt(process.env.BUDGET_DAILY_ALERT_CENTS || '3000', 10),
    autoApproveBookingsUnderCents: parseInt(
      process.env.AUTO_APPROVE_BOOKINGS_UNDER_CENTS || '5000',
      10
    ),
    bargeInEnabled: process.env.BARGE_IN_ENABLED !== 'false',
    getGreetingForTime(date: Date): string {
      const hour = date.getHours();
      if (hour >= 5 && hour < 12) return 'Good morning';
      if (hour >= 12 && hour < 17) return 'Good afternoon';
      if (hour >= 17 && hour < 22) return 'Good evening';
      return '';
    },
    getGreetingForPurpose(purpose: string): string {
      const greetings: Record<string, string> = {
        appointment_reminder: 'I am calling to remind you about your upcoming appointment',
        follow_up: 'I am calling for a follow-up regarding your recent interaction',
        service_update: 'I am calling with an update about your service request',
        marketing: 'I am calling to share a business service update with you',
        general: 'How can I help you today',
      };
      return greetings[purpose] ?? greetings['general'];
    },
  },
  business: {
    name: process.env.BUSINESS_NAME || 'Example Business',
    location: process.env.BUSINESS_LOCATION || '123 Main Street, Springfield',
    receptionNumber:
      process.env.BUSINESS_RECEPTION_NUMBER ||
      '+15551234567',
    urgentTransferNumber:
      process.env.URGENT_TRANSFER_NUMBER ||
      process.env.BUSINESS_RECEPTION_NUMBER ||
      '+15551234567',
    adminExtension: process.env.ADMIN_EXTENSION || '100',
  },
  server: {
    port: parseInt(process.env.AGENT_PORT || '3012', 10),
  },
};
