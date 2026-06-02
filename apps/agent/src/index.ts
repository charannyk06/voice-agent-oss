import http, { type IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { config, validateHostedSecurityConfig } from './config';
import { TelephonyService } from './services/telephony';
import { ReceptionistAgent } from './agents/receptionist';
import { OutboundAgent } from './agents/outbound';
import { GeminiLiveBridge } from './services/gemini-live';
import { AsteriskAriRuntime } from './services/asterisk/ari-runtime';
import { ToolService } from './services/tools';
import { prisma } from './services/prisma';
import { createMediaStreamToken, verifyMediaStreamToken } from './services/media-stream-token';
import { ensureRuntimeDefaults } from './services/runtime-config';
import { resolveInboundOrgId } from './services/inbound-routing';
import { MediaStreamUpgradeGuard } from './services/media-stream-upgrade';
import { redactPhone } from './services/safe-log';
import {
  getDashboardTokenFromRequest,
  verifyDashboardToken,
  verifyRequestOrigin,
  type DashboardTokenAction,
  type DashboardTokenPayload,
} from './services/dashboard-token';
import {
  assertCanStartLiveCall,
  flushPendingHostedUsageEvents,
  recordCompletedCallUsage,
} from './services/billing-guard';
import type { TelephonyProviderStatus } from './services/telephony';
import type { CallActionRecord, CallSession, TranscriptLine, WSMessage } from './types';

const activeCalls = new Map<string, CallSession>();
const activeAgents = new Map<string, ReceptionistAgent | OutboundAgent>();
const liveBridges = new Map<string, GeminiLiveBridge>();
const liveBridgeIntroductions = new Set<string>();
const streamSidToCallId = new Map<string, string>();
const socketToStreamSids = new Map<WebSocket, Set<string>>();
const pendingHostedCallStarts = new Map<string, number>();
const telephony = new TelephonyService();
const MAX_BODY_SIZE = 1 * 1024 * 1024;
const LEGACY_TWILIO_WEBHOOK_PATH = '/voice/twilio-webhook';
const DEFAULT_TWILIO_WEBHOOK_PATH = '/webhook/twilio';
const PROVIDER_STATUS_PATH = telephony.getStatusPath();
const mediaStreamUpgradeGuard = new MediaStreamUpgradeGuard({
  allowedIps: config.telephony.streamAllowedIps,
  allowedOrigins: config.telephony.streamAllowedOrigins,
  maxUpgradesPerWindow: 30,
  windowMs: 60_000,
});

interface TwilioStreamStartMessage {
  event: 'start';
  start: {
    streamSid: string;
    callSid?: string;
    customParameters?: Record<string, string>;
  };
}

interface TwilioStreamMediaMessage {
  event: 'media';
  streamSid: string;
  media: {
    payload: string;
  };
}

interface TwilioStreamStopMessage {
  event: 'stop';
  streamSid: string;
}

interface PlivoStreamStartMessage {
  event: 'start';
  start: {
    callId: string;
    streamId: string;
    mediaFormat?: {
      encoding?: string;
      sampleRate?: number;
    };
  };
  extra_headers?: string;
}

interface PlivoStreamMediaMessage {
  event: 'media';
  streamId: string;
  media: {
    payload: string;
  };
}

interface PlivoStreamStopMessage {
  event: 'stop';
  streamId: string;
}

interface LiveAudioTransport {
  clearAudio: () => void;
  sendMulawAudio: (mulawBase64: string) => void;
}

async function ensureAgentConfig(): Promise<void> {
  try {
    await ensureRuntimeDefaults();
  } catch (err) {
    console.warn('[Config] Could not ensure AgentConfig row:', err);
  }
}

async function readRequestBody(
  req: IncomingMessage,
  maxBytes = MAX_BODY_SIZE,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;

    req.on('data', (chunk: Buffer | string) => {
      bytes += chunk.toString().length;
      if (bytes > maxBytes) {
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function getUrl(req: IncomingMessage): URL {
  return new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
}

function getPathname(req: IncomingMessage): string {
  return getUrl(req).pathname;
}

type DashboardAuthResult =
  | { ok: true; payload: DashboardTokenPayload }
  | { ok: false; statusCode: number; message: string };

function localDashboardPayload(): DashboardTokenPayload {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    userId: 'local-dev',
    orgId: 'default',
    subscriptionStatus: 'self_hosted',
    allowedActions: ['calls:read', 'calls:write', 'billing:read'],
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
}

function getDashboardRequestOrigin(req: IncomingMessage): string | undefined {
  const origin = req.headers.origin;
  if (typeof origin === 'string') return origin;
  const forwardedOrigin = req.headers['x-dashboard-origin'];
  if (typeof forwardedOrigin === 'string') return forwardedOrigin;
  return undefined;
}

function authenticateDashboardRequest(
  req: IncomingMessage,
  requiredAction: DashboardTokenAction,
): DashboardAuthResult {
  if (!verifyRequestOrigin(getDashboardRequestOrigin(req), config.security.dashboardAllowedOrigins)) {
    return { ok: false, statusCode: 403, message: 'Dashboard origin is not allowed' };
  }

  if (!config.security.requireDashboardToken) {
    return { ok: true, payload: localDashboardPayload() };
  }

  const token = getDashboardTokenFromRequest(req);
  const verified = verifyDashboardToken(token, {
    secret: config.security.dashboardTokenSecret,
    requiredAction,
  });

  if (verified.ok === false) {
    const missingSecret = verified.reason === 'missing_secret';
    return {
      ok: false,
      statusCode: missingSecret ? 500 : 401,
      message: missingSecret
        ? 'Dashboard token secret is not configured'
        : 'Dashboard token is invalid or expired',
    };
  }

  return verified;
}

function rejectHttp(res: http.ServerResponse, statusCode: number, message: string): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

function setHttpSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function assertStartupSecurity(): void {
  const issues = validateHostedSecurityConfig({
    deploymentMode: config.deployment.mode,
    requireDashboardToken: config.security.requireDashboardToken,
    dashboardTokenSecret: config.security.dashboardTokenSecret,
    mediaStreamTokenSecret: config.security.mediaStreamTokenSecret,
    dashboardAllowedOrigins: config.security.dashboardAllowedOrigins,
    dashboardAllowedOriginErrors: config.security.dashboardAllowedOriginErrors,
    requireWebhookSignatures: config.security.requireWebhookSignatures,
    usageIngestUrl: config.billing.usageIngestUrl,
    usageIngestSecret: config.billing.usageIngestSecret,
    inboundOrgRouteCount: config.telephony.inboundOrgRoutes.size,
  });

  if (issues.length > 0) {
    throw new Error(`Hosted security configuration is invalid: ${issues.join('; ')}`);
  }
}

function rejectUpgrade(
  socket: { write(data: string): void; destroy(): void },
  statusCode: number,
  message: string,
): void {
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: application/json\r\n' +
      `Content-Length: ${Buffer.byteLength(JSON.stringify({ error: message }))}\r\n\r\n` +
      JSON.stringify({ error: message }),
  );
  socket.destroy();
}

function getHostedCallReservationUnitSeconds(): number {
  return Math.max(1, config.agent.maxCallDurationMin * 60);
}

function getSessionOrgId(session: CallSession): string {
  return session.orgId || config.deployment.defaultOrgId;
}

function getHostedReservedSecondsForOrg(orgId: string): number {
  if (config.deployment.mode === 'self_hosted') {
    return 0;
  }

  const reservationUnit = getHostedCallReservationUnitSeconds();
  let reserved = (pendingHostedCallStarts.get(orgId) ?? 0) * reservationUnit;
  for (const session of activeCalls.values()) {
    if ((session.status === 'active' || session.status === 'transferred') && getSessionOrgId(session) === orgId) {
      reserved += reservationUnit;
    }
  }
  return reserved;
}

function reserveHostedCallStart(orgId: string): () => void {
  if (config.deployment.mode === 'self_hosted') {
    return () => undefined;
  }

  pendingHostedCallStarts.set(orgId, (pendingHostedCallStarts.get(orgId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (pendingHostedCallStarts.get(orgId) ?? 1) - 1;
    if (next <= 0) {
      pendingHostedCallStarts.delete(orgId);
    } else {
      pendingHostedCallStarts.set(orgId, next);
    }
  };
}

async function ensureBillingAllowsCall(orgId: string, res?: http.ServerResponse): Promise<boolean> {
  const gate = await assertCanStartLiveCall(orgId, {
    reservedSecondsThisPeriod: getHostedReservedSecondsForOrg(orgId),
  });
  if (gate.allowed === false) {
    console.warn(`[Billing] Live call blocked: ${gate.reason}`);
    if (res) {
      rejectHttp(res, 402, gate.message);
    }
    return false;
  }

  return true;
}

function getMediaStreamSecret(): string {
  return config.security.mediaStreamTokenSecret;
}

function createStreamTokenForSession(session: CallSession): string | undefined {
  const secret = getMediaStreamSecret();
  if (!secret) {
    if (config.deployment.productionLike) {
      throw new Error('AGENT_MEDIA_STREAM_TOKEN_SECRET is required for live media streams in hosted or production mode');
    }
    return undefined;
  }

  return createMediaStreamToken({
    secret,
    sessionId: session.id,
    providerCallId: session.providerCallId || session.id,
    orgId: session.orgId || config.deployment.defaultOrgId,
  });
}

function authorizeMediaStreamStart(params: {
  token?: string;
  sessionId?: string;
  providerCallId?: string;
}): CallSession | undefined {
  const session = params.sessionId
    ? activeCalls.get(params.sessionId)
    : params.providerCallId
      ? findSessionByProviderCallId(params.providerCallId)
      : undefined;

  if (!session) {
    return undefined;
  }

  const secret = getMediaStreamSecret();
  if (!secret) {
    return config.deployment.productionLike ? undefined : session;
  }

  const verified = verifyMediaStreamToken(params.token, {
    secret,
    expectedSessionId: session.id,
    expectedProviderCallId: session.providerCallId || session.id,
    expectedOrgId: session.orgId || config.deployment.defaultOrgId,
  });

  return verified.ok ? session : undefined;
}

function getAsteriskInboundRouteFallback(): string | undefined {
  return config.asterisk.sipDomain || config.asterisk.publicHost || config.asterisk.pjsipEndpoint;
}

function resolveInboundOrgForEvent(event: Record<string, string>): string | undefined {
  return resolveInboundOrgId({
    deploymentMode: config.deployment.mode,
    defaultOrgId: config.deployment.defaultOrgId,
    provider: telephony.getProvider(),
    event,
    routes: config.telephony.inboundOrgRoutes,
    fallbackRouteKey: telephony.getProvider() === 'asterisk' ? getAsteriskInboundRouteFallback() : undefined,
  });
}

function rejectMediaStream(ws: WebSocket, reason: string): void {
  console.warn(`[Stream] Rejected media stream: ${reason}`);
  ws.close(1008, 'Unauthorized media stream');
}

function getValidDashboardSocketClaims(ws: WebSocket): DashboardTokenPayload | undefined {
  const claims = dashboardSocketClaims.get(ws);
  if (!claims) return undefined;
  if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) {
    dashboardSocketClaims.delete(ws);
    sendDashboardError(ws, 'Dashboard websocket token expired');
    ws.close(1008, 'Dashboard token expired');
    return undefined;
  }
  return claims;
}

function dashboardSocketHasAction(ws: WebSocket, action: DashboardTokenAction): boolean {
  return getValidDashboardSocketClaims(ws)?.allowedActions.includes(action) === true;
}

function sendDashboardError(ws: WebSocket, message: string): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'error', error: message } satisfies WSMessage));
  }
}

function isTwilioVoiceWebhookPath(pathname: string): boolean {
  if (telephony.getProvider() !== 'twilio') {
    return false;
  }
  return [config.twilio.webhookPath, DEFAULT_TWILIO_WEBHOOK_PATH, LEGACY_TWILIO_WEBHOOK_PATH].includes(pathname);
}

function isTwilioStatusWebhookPath(pathname: string): boolean {
  return telephony.getProvider() === 'twilio' && pathname === PROVIDER_STATUS_PATH;
}

function getMessageOrgId(message: WSMessage): string | undefined {
  if ('call' in message && message.call) {
    return message.call.orgId;
  }
  if ('callId' in message && message.callId) {
    return activeCalls.get(message.callId)?.orgId;
  }
  return undefined;
}

function broadcast(message: WSMessage): void {
  const orgId = getMessageOrgId(message);
  if (!orgId && message.type !== 'error') {
    console.warn(`[WS] Skipping unscoped dashboard broadcast for ${message.type}`);
    return;
  }

  const data = JSON.stringify(message);
  dashboardWss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) {
      return;
    }
    const claims = getValidDashboardSocketClaims(client);
    if (!claims || (orgId && claims.orgId !== orgId)) {
      return;
    }
    client.send(data);
  });
}

async function persistCallSession(session: CallSession): Promise<void> {
  const orgId = session.orgId || config.deployment.defaultOrgId;

  const contact = await prisma.contact.findUnique({
    where: { orgId_phone: { orgId, phone: session.phone } },
    select: { id: true, name: true },
  }).catch(() => null);

  const transcript = JSON.stringify(session.transcript);
  const actions = session.actions.map((action) => ({
    type: action.type,
    description: action.description,
  }));

  await prisma.call.upsert({
    where: { id: session.id },
    update: {
      orgId,
      contact: contact ? { connect: { id: contact.id } } : undefined,
      contactName: contact?.name ?? session.contactName,
      phone: session.phone,
      direction: session.direction,
      status: session.status,
      duration: session.duration,
      summary: session.summary ?? null,
      transcript,
      outcome: session.outcome ?? null,
      startedAt: session.startedAt,
      endedAt: session.endedAt ?? null,
      actions: {
        deleteMany: {},
        create: actions,
      },
    },
    create: {
      id: session.id,
      orgId,
      contact: contact ? { connect: { id: contact.id } } : undefined,
      contactName: contact?.name ?? session.contactName,
      phone: session.phone,
      direction: session.direction,
      status: session.status,
      duration: session.duration,
      summary: session.summary ?? null,
      transcript,
      startedAt: session.startedAt,
      endedAt: session.endedAt ?? null,
      outcome: session.outcome ?? null,
      actions: {
        create: actions,
      },
    },
  });

  // Record cost entries for completed calls
  if (session.duration > 0 && session.endedAt) {
    const minutes = session.duration / 60;
    // Twilio Voice: ~$0.013/min for outbound, $0.0085/min for inbound
    const perMinuteCents = session.direction === 'outbound' ? 1.3 : 0.85;
    const callCostCents = Math.round(minutes * perMinuteCents);

    const existingCost = await prisma.costEntry.findFirst({
      where: { orgId, callId: session.id },
    });

    if (!existingCost) {
      await prisma.costEntry.create({
        data: {
          orgId,
          callId: session.id,
          provider: 'twilio-voice',
          amountCents: Math.max(callCostCents, 1),
          minutes: Math.round(minutes * 100) / 100,
        },
      });
    }
  }

  // Ensure contact exists for this phone number
  if (session.phone && session.phone !== 'unknown') {
    const existingContact = await prisma.contact.findUnique({
      where: { orgId_phone: { orgId, phone: session.phone } },
    }).catch(() => null);

    if (!existingContact) {
      await prisma.contact.create({
        data: {
          orgId,
          name: session.contactName || session.phone,
          phone: session.phone,
          category: 'customer',
        },
      }).catch(() => {
        // Contact might already exist from a concurrent tool call
      });
    }
  }
}

function findSessionByProviderCallId(providerCallId?: string): CallSession | undefined {
  if (!providerCallId) {
    return undefined;
  }

  for (const session of activeCalls.values()) {
    if (session.providerCallId === providerCallId) {
      return session;
    }
  }

  return undefined;
}

function findActiveSessionByPhone(phone: string, direction: 'inbound' | 'outbound', orgId: string): CallSession | undefined {
  for (const session of activeCalls.values()) {
    if (session.status === 'active' && session.direction === direction && session.phone === phone && (session.orgId || config.deployment.defaultOrgId) === orgId) {
      return session;
    }
  }

  return undefined;
}

function deriveSummary(session: CallSession): string {
  const transcriptSummary = session.transcript
    .map((entry) => `${entry.speaker}: ${entry.text}`)
    .join(' | ')
    .trim();

  if (transcriptSummary) {
    return transcriptSummary;
  }

  const actionSummary = session.actions
    .filter((action) =>
      action.description &&
      !action.description.startsWith('Connected to gemini') &&
      !action.description.startsWith('Model generation interrupted') &&
      !action.description.startsWith('Gemini Live session')
    )
    .slice(-6)
    .map((action) => action.description)
    .join('. ')
    .trim();

  return actionSummary;
}

function createLiveHooks(session: CallSession) {
  return {
    onTranscript: (line: TranscriptLine) => {
      session.transcript.push(line);
      session.summary = deriveSummary(session);
      broadcast({ type: 'call_transcript', callId: session.id, line });
      void persistCallSession(session).catch((error) => {
        console.error('[Call] Failed to persist transcript:', error);
      });
    },
    onAction: (action: CallActionRecord) => {
      session.actions.push(action);
      session.summary = deriveSummary(session);
      broadcast({ type: 'call_action', callId: session.id, action });
      void persistCallSession(session).catch((error) => {
        console.error('[Call] Failed to persist action:', error);
      });
    },
  };
}

async function ensureCallSession(params: {
  phone: string;
  direction: 'inbound' | 'outbound';
  providerCallId?: string;
  contactName?: string;
  orgId?: string;
  billingAuthorizedAt?: Date;
}): Promise<CallSession> {
  const orgId = params.orgId || config.deployment.defaultOrgId;
  const existing = params.providerCallId
    ? findSessionByProviderCallId(params.providerCallId)
    : undefined;
  if (existing && (existing.orgId || config.deployment.defaultOrgId) !== orgId) {
    throw new Error('Provider call already belongs to another organization');
  }
  const phoneMatch = !existing && params.phone && params.phone !== 'unknown'
    ? findActiveSessionByPhone(params.phone, params.direction, orgId)
    : undefined;
  const matchedSession = existing ?? phoneMatch;

  if (matchedSession) {
    let updated = false;
    if ((matchedSession.phone === 'unknown' || !matchedSession.phone) && params.phone && params.phone !== 'unknown') {
      matchedSession.phone = params.phone;
      updated = true;
    }
    if (!matchedSession.providerCallId && params.providerCallId) {
      matchedSession.providerCallId = params.providerCallId;
      updated = true;
    }
    if ((matchedSession.contactName === 'Unknown' || !matchedSession.contactName) && params.contactName && params.contactName !== 'Unknown') {
      matchedSession.contactName = params.contactName;
      updated = true;
    }
    if (params.billingAuthorizedAt && !matchedSession.billingAuthorizedAt) {
      matchedSession.billingAuthorizedAt = params.billingAuthorizedAt;
      updated = true;
    }
    if (updated) {
      await persistCallSession(matchedSession).catch((error) => {
        console.error('[Call] Failed to persist enriched session:', error);
      });
    }
    return matchedSession;
  }

  const session: CallSession = {
    id: `call-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    providerCallId: params.providerCallId,
    orgId,
    contactName: params.contactName || params.phone || 'Unknown',
    phone: params.phone,
    direction: params.direction,
    status: 'active',
    startedAt: new Date(),
    billingAuthorizedAt: params.billingAuthorizedAt,
    duration: 0,
    transcript: [],
    actions: [],
  };

  activeCalls.set(session.id, session);
  await persistCallSession(session).catch((error) => {
    console.error('[Call] Failed to persist initial session:', error);
  });
  broadcast({ type: 'call_started', call: session });
  return session;
}

async function attachSimulationAgent(
  session: CallSession,
  purpose?: string,
): Promise<void> {
  if (activeAgents.has(session.id)) {
    return;
  }

  if (session.direction === 'outbound') {
    const agent = new OutboundAgent(session, purpose || 'general', createLiveHooks(session));
    activeAgents.set(session.id, agent);
    await agent.getOpeningLine();
    return;
  }

  const agent = new ReceptionistAgent(session, createLiveHooks(session));
  activeAgents.set(session.id, agent);
  await agent.start();
}

async function startOutboundCall(phone: string, purpose: string, orgId: string): Promise<CallSession> {
  const releaseReservation = reserveHostedCallStart(orgId);
  try {
    const billingAllowed = await ensureBillingAllowsCall(orgId);
    if (!billingAllowed) {
      throw new Error('Hosted usage requires an active billing subscription before outbound calls can start.');
    }

    const billingAuthorizedAt = new Date();
    const providerCall = await telephony.makeCall(phone, { orgId });
    const session = await ensureCallSession({
      phone,
      direction: 'outbound',
      providerCallId: providerCall.callControlId,
      orgId,
      billingAuthorizedAt,
    });

    if (providerCall.callControlId.startsWith('simulated-') || !config.gemini.apiKey) {
      await attachSimulationAgent(session, purpose);
    }

    console.log('[Call] Outbound started', {
      phone: redactPhone(phone),
      purpose: '[redacted]',
    });
    return session;
  } finally {
    releaseReservation();
  }
}

async function endCall(callId: string, options?: { hangupProvider?: boolean }): Promise<void> {
  const session = activeCalls.get(callId);
  if (!session) {
    return;
  }

  if (session.status === 'active') {
    session.status = 'completed';
  }

  session.endedAt = new Date();
  session.duration = Math.floor((session.endedAt.getTime() - session.startedAt.getTime()) / 1000);

  const bridge = liveBridges.get(callId);
  bridge?.close();
  liveBridges.delete(callId);
  liveBridgeIntroductions.delete(callId);

  const agent = activeAgents.get(callId);
  if (agent instanceof ReceptionistAgent) {
    session.summary = (await agent.end()) || deriveSummary(session);
  } else if (agent instanceof OutboundAgent) {
    session.summary = agent.getSummary() || deriveSummary(session);
  } else {
    session.summary = deriveSummary(session);
  }

  await persistCallSession(session).catch((err) => {
    console.error('[Call] Failed to persist session:', err);
  });

  if (config.deployment.mode === 'hosted' && !session.billingAuthorizedAt) {
    console.error(`[Billing] Skipping usage record for unauthorized hosted call session ${session.id}`);
  } else {
    await recordCompletedCallUsage({
      orgId: session.orgId || config.deployment.defaultOrgId,
      callId: session.id,
      durationSeconds: session.duration,
      provider: telephony.getProvider(),
    });
  }

  if (options?.hangupProvider && session.providerCallId) {
    await telephony.hangupCall(session.providerCallId).catch((error) => {
      console.error('[Call] Hangup failed:', error);
    });
  }

  activeCalls.delete(callId);
  activeAgents.delete(callId);

  broadcast({ type: 'call_ended', call: session });
  console.log(`[Call] Ended: ${callId} (${session.duration}s)`);
}

async function ensureGeminiBridge(
  callSession: CallSession,
  transport: LiveAudioTransport,
): Promise<GeminiLiveBridge> {
  if (liveBridges.has(callSession.id)) {
    return liveBridges.get(callSession.id)!;
  }

  const hooks = createLiveHooks(callSession);

  const bridge = new GeminiLiveBridge({
    session: callSession,
    toolService: new ToolService(callSession.orgId || config.deployment.defaultOrgId),
    sendAudioToCaller: (mulawBase64) => {
      transport.sendMulawAudio(mulawBase64);
    },
    clearCallerAudio: () => {
      transport.clearAudio();
    },
    onTranscript: hooks.onTranscript,
    onAction: hooks.onAction,
  });

  await bridge.connect();

  liveBridges.set(callSession.id, bridge);
  return bridge;
}

function startGeminiConversation(callSession: CallSession): void {
  if (liveBridgeIntroductions.has(callSession.id)) {
    return;
  }

  const bridge = liveBridges.get(callSession.id);
  if (!bridge) {
    return;
  }

  liveBridgeIntroductions.add(callSession.id);

  if (callSession.direction === 'outbound') {
    bridge.sendTextInstruction(
      `The outbound call has just connected. Start speaking immediately. Greet the callee in natural English. Clearly say you are calling from ${config.business.name}, explain the purpose in one short sentence, and ask one simple question so the callee knows the line is live.`,
    );

    setTimeout(() => {
      const stillActive = activeCalls.get(callSession.id)?.status === 'active';
      const heardHuman = callSession.transcript.some((line) => line.speaker === 'human');
      if (stillActive && !heardHuman) {
        bridge.sendTextInstruction(
          `The callee has not responded yet. Politely say hello again, repeat that this is ${config.business.name}, and ask if they can hear you.`,
        );
      }
    }, 5000);
    return;
  }

  bridge.sendTextInstruction(
    "The phone call has just connected. Greet the caller in natural English or the caller's preferred language, then ask how you can help.",
  );
}

function unregisterStream(ws: WebSocket, streamSid: string): void {
  const streamSids = socketToStreamSids.get(ws);
  if (streamSids) {
    streamSids.delete(streamSid);
    if (streamSids.size === 0) {
      socketToStreamSids.delete(ws);
    }
  }

  streamSidToCallId.delete(streamSid);
}

async function cleanupSocketStreams(ws: WebSocket): Promise<void> {
  const streamSids = socketToStreamSids.get(ws);
  if (!streamSids || streamSids.size === 0) {
    socketToStreamSids.delete(ws);
    return;
  }

  const callIds = new Set<string>();
  for (const streamSid of streamSids) {
    const callId = streamSidToCallId.get(streamSid);
    if (callId) {
      callIds.add(callId);
    }
    streamSidToCallId.delete(streamSid);
  }

  socketToStreamSids.delete(ws);

  for (const callId of callIds) {
    await endCall(callId);
  }
}

async function hydrateCallMetadataFromProvider(callSession: CallSession): Promise<void> {
  if (!callSession.providerCallId) {
    return;
  }

  const info = await telephony.getCallInfo(callSession.providerCallId);
  if (!info) {
    return;
  }

  let updated = false;
  const nextPhone = info.from || info.to;
  if (nextPhone && (callSession.phone === 'unknown' || !callSession.phone)) {
    callSession.phone = nextPhone;
    updated = true;
  }

  if (updated) {
    await persistCallSession(callSession).catch((error) => {
      console.error('[Call] Failed to persist hydrated provider call info:', error);
    });
  }
}

async function reconcileStaleCallRows(): Promise<void> {
  try {
    const staleCalls = await prisma.call.findMany({
      where: { status: 'active' },
      select: { id: true, startedAt: true },
    });

    for (const staleCall of staleCalls) {
      await prisma.call.update({
        where: { id: staleCall.id },
        data: {
          status: 'completed',
          endedAt: staleCall.startedAt,
          summary: 'Recovered stale active call during agent startup.',
        },
      });
    }

    if (staleCalls.length > 0) {
      console.log(`[Startup] Reconciled ${staleCalls.length} stale active call rows`);
    }
  } catch (error) {
    console.error('[Startup] Failed to reconcile stale call rows:', error);
  }
}

async function handleTelephonyVoiceRequest(event: Record<string, string>, res: http.ServerResponse): Promise<void> {
  const context = telephony.extractCallContext(event);
  const orgId = context.direction === 'inbound'
    ? resolveInboundOrgForEvent(event)
    : findSessionByProviderCallId(context.providerCallId)?.orgId ||
      (config.deployment.mode === 'self_hosted' ? config.deployment.defaultOrgId : undefined);

  if (!orgId) {
    console.warn(`[Webhook] Rejected unrouted hosted ${telephony.getProvider()} inbound voice request`);
    rejectHttp(res, 403, 'Unknown inbound route');
    return;
  }

  if (telephony.getProvider() === 'asterisk') {
    const inboundResponse = telephony.buildInboundResponse({
      sessionId: '',
      providerCallId: context.providerCallId,
      phone: context.phone,
      useLiveStream: Boolean(config.gemini.apiKey),
    });

    res.writeHead(inboundResponse.statusCode ?? 200, { 'Content-Type': inboundResponse.contentType });
    res.end(inboundResponse.body);
    return;
  }

  const session = await ensureCallSession({
    phone: context.phone,
    direction: context.direction,
    providerCallId: context.providerCallId,
    orgId,
    billingAuthorizedAt: new Date(),
  });

  const inboundResponse = telephony.buildInboundResponse({
    sessionId: session.id,
    providerCallId: context.providerCallId,
    phone: context.phone,
    useLiveStream: Boolean(config.gemini.apiKey),
    streamToken: createStreamTokenForSession(session),
  });

  res.writeHead(inboundResponse.statusCode ?? 200, { 'Content-Type': inboundResponse.contentType });
  res.end(inboundResponse.body);
}

async function handleTelephonyStatusCallback(event: Record<string, string>, res: http.ServerResponse): Promise<void> {
  if (telephony.getProvider() === 'asterisk') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      provider: 'asterisk',
      message: 'Asterisk call lifecycle is driven by the ARI websocket runtime. This HTTP status path is not used.',
    }));
    return;
  }

  try {
    const result = await telephony.handleWebhook(event);
    const { direction } = telephony.extractCallContext(event);

    let session = result.callControlId
      ? findSessionByProviderCallId(result.callControlId)
      : undefined;
    const callbackOrgId = session?.orgId || (
      direction === 'inbound' ? resolveInboundOrgForEvent(event) : undefined
    );

    if (!callbackOrgId && direction === 'inbound' && config.deployment.mode === 'hosted') {
      console.warn(`[Webhook] Rejected unrouted hosted ${telephony.getProvider()} inbound status callback`);
      rejectHttp(res, 403, 'Unknown inbound route');
      return;
    }

    if (!session && result.callControlId && result.type !== 'ignored' && result.type !== 'call_hangup') {
      if (!callbackOrgId) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ignored: true }));
        return;
      }
      if (config.deployment.mode === 'hosted') {
        console.warn(`[Webhook] Ignored hosted ${telephony.getProvider()} status callback without an authorized live-call session`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ignored: true }));
        return;
      }
      session = await ensureCallSession({
        phone: result.phone || 'unknown',
        direction,
        providerCallId: result.callControlId,
        orgId: callbackOrgId,
      });
    }

    if (session && (result.type === 'inbound_started' || result.type === 'call_answered')) {
      await hydrateCallMetadataFromProvider(session);
    }

    if (result.type === 'call_hangup' && result.callControlId) {
      session ??= findSessionByProviderCallId(result.callControlId);
      if (session) {
        await endCall(session.id);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    console.error('[Webhook] Status callback error:', message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
}

function parsePlivoExtraHeaders(extraHeaders?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!extraHeaders) {
    return result;
  }

  for (const pair of extraHeaders.split(/[;,]/)) {
    const [key, ...rest] = pair.split('=');
    if (!key || rest.length === 0) {
      continue;
    }
    result[key.trim()] = rest.join('=').trim();
  }

  return result;
}

async function handleTwilioStreamMessage(ws: WebSocket, rawData: Buffer): Promise<void> {
  const payload = JSON.parse(rawData.toString()) as TwilioStreamStartMessage | TwilioStreamMediaMessage | TwilioStreamStopMessage | { event?: string };

  if (payload.event === 'start') {
    const startPayload = payload as TwilioStreamStartMessage;
    const streamSids = socketToStreamSids.get(ws) ?? new Set<string>();
    streamSids.add(startPayload.start.streamSid);
    socketToStreamSids.set(ws, streamSids);

    const sessionId = startPayload.start.customParameters?.sessionId;
    const providerCallId = startPayload.start.customParameters?.callId || startPayload.start.callSid;
    const phone = startPayload.start.customParameters?.phone || 'unknown';
    const streamToken = startPayload.start.customParameters?.streamToken;

    const session = authorizeMediaStreamStart({ token: streamToken, sessionId, providerCallId });
    if (!session) {
      rejectMediaStream(ws, 'missing or invalid Twilio stream token');
      return;
    }

    if ((session.phone === 'unknown' || !session.phone) && phone !== 'unknown') {
      session.phone = phone;
      await persistCallSession(session).catch((error) => {
        console.error('[Call] Failed to persist stream phone:', error);
      });
    }

    streamSidToCallId.set(startPayload.start.streamSid, session.id);

    await hydrateCallMetadataFromProvider(session);

    if (config.gemini.apiKey) {
      const transport: LiveAudioTransport = {
        clearAudio: () => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(telephony.buildClearAudioMessage(startPayload.start.streamSid));
          }
        },
        sendMulawAudio: (mulawBase64) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(telephony.buildStreamMediaMessage(startPayload.start.streamSid, mulawBase64));
          }
        },
      };
      await ensureGeminiBridge(session, transport);
      startGeminiConversation(session);
    } else {
      await attachSimulationAgent(session);
    }

    return;
  }

  if (payload.event === 'media') {
    const mediaPayload = payload as TwilioStreamMediaMessage;
    const callId = streamSidToCallId.get(mediaPayload.streamSid);
    if (!callId) {
      return;
    }

    const bridge = liveBridges.get(callId);
    if (bridge) {
      bridge.sendMulawAudio(mediaPayload.media.payload);
    }
    return;
  }

  if (payload.event === 'stop') {
    const stopPayload = payload as TwilioStreamStopMessage;
    const callId = streamSidToCallId.get(stopPayload.streamSid);
    unregisterStream(ws, stopPayload.streamSid);
    if (callId) {
      liveBridges.get(callId)?.endInputAudio();
      liveBridges.get(callId)?.close();
      liveBridges.delete(callId);
      await endCall(callId);
    }
  }
}

async function handlePlivoStreamMessage(ws: WebSocket, rawData: Buffer): Promise<void> {
  const payload = JSON.parse(rawData.toString()) as PlivoStreamStartMessage | PlivoStreamMediaMessage | PlivoStreamStopMessage | { event?: string };

  if (payload.event === 'start') {
    const startPayload = payload as PlivoStreamStartMessage;
    const streamId = startPayload.start.streamId;
    const streamSids = socketToStreamSids.get(ws) ?? new Set<string>();
    streamSids.add(streamId);
    socketToStreamSids.set(ws, streamSids);

    const headers = parsePlivoExtraHeaders(startPayload.extra_headers);
    const providerCallId = startPayload.start.callId;
    const phone = headers.phone || 'unknown';

    const session = authorizeMediaStreamStart({
      token: headers.streamToken,
      sessionId: headers.sessionId,
      providerCallId,
    });
    if (!session) {
      rejectMediaStream(ws, 'missing or invalid Plivo stream token');
      return;
    }

    if ((session.phone === 'unknown' || !session.phone) && phone !== 'unknown') {
      session.phone = phone;
      await persistCallSession(session).catch((error) => {
        console.error('[Call] Failed to persist stream phone:', error);
      });
    }

    streamSidToCallId.set(streamId, session.id);

    await hydrateCallMetadataFromProvider(session);

    if (config.gemini.apiKey) {
      const transport: LiveAudioTransport = {
        clearAudio: () => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(telephony.buildClearAudioMessage(streamId));
          }
        },
        sendMulawAudio: (mulawBase64) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(telephony.buildStreamMediaMessage(streamId, mulawBase64));
          }
        },
      };
      await ensureGeminiBridge(session, transport);
      startGeminiConversation(session);
    } else {
      await attachSimulationAgent(session);
    }

    return;
  }

  if (payload.event === 'media') {
    const mediaPayload = payload as PlivoStreamMediaMessage;
    const callId = streamSidToCallId.get(mediaPayload.streamId);
    if (!callId) {
      return;
    }

    const bridge = liveBridges.get(callId);
    if (bridge) {
      bridge.sendMulawAudio(mediaPayload.media.payload);
    }
    return;
  }

  if (payload.event === 'stop') {
    const stopPayload = payload as PlivoStreamStopMessage;
    const callId = streamSidToCallId.get(stopPayload.streamId);
    unregisterStream(ws, stopPayload.streamId);
    if (callId) {
      liveBridges.get(callId)?.endInputAudio();
      liveBridges.get(callId)?.close();
      liveBridges.delete(callId);
      await endCall(callId);
    }
  }
}

async function handleAsteriskStreamMessage(ws: WebSocket, _rawData?: Buffer): Promise<void> {
  console.warn('[asterisk Stream] The live Asterisk path uses ARI externalMedia over RTP/UDP, not websocket media');
  if (ws.readyState === WebSocket.OPEN) {
    ws.close(1008, 'Asterisk live media bridge uses RTP external media');
  }
}

let asteriskRuntime: AsteriskAriRuntime | null = null;

function getRuntimeTelephonyStatus(): TelephonyProviderStatus {
  const baseStatus = telephony.getStatus();

  if (baseStatus.provider !== 'asterisk' || !asteriskRuntime) {
    return baseStatus;
  }

  const snapshot = asteriskRuntime.getStatusSnapshot();
  const geminiReady = Boolean(config.gemini.apiKey);
  const runtimeReady = baseStatus.liveMediaReady && geminiReady && snapshot.connected;

  const details = [
    ...baseStatus.details,
    { label: 'ARI websocket', value: snapshot.connected ? 'connected' : 'disconnected' },
    { label: 'Active ARI live calls', value: String(snapshot.activeCallCount) },
  ];

  let message = baseStatus.message;
  if (!geminiReady) {
    message = 'GEMINI_API_KEY is required for live Asterisk voice. Calls are rejected when live voice is disabled.';
  } else if (!baseStatus.liveMediaReady) {
    message = 'Asterisk ARI control is configured. Set ASTERISK_EXTERNAL_MEDIA_HOST so Asterisk can send RTP to the agent runtime.';
  } else if (snapshot.connected) {
    message = 'Asterisk ARI live bridge is connected and ready.';
  } else if (snapshot.lastError) {
    message = `Asterisk ARI is configured, but the runtime websocket is disconnected: ${snapshot.lastError}`;
  } else {
    message = 'Asterisk ARI is configured. Waiting for the runtime websocket connection.';
  }

  return {
    ...baseStatus,
    ready: runtimeReady,
    liveMediaReady: runtimeReady,
    health: runtimeReady ? 'ready' : baseStatus.configured ? 'foundation_only' : 'configuration_required',
    message,
    details,
  };
}

if (telephony.getProvider() === 'asterisk') {
  asteriskRuntime = new AsteriskAriRuntime({
    onAudioFrame: ({ providerCallId, mulawBase64 }) => {
      const session = findSessionByProviderCallId(providerCallId);
      if (!session) {
        return;
      }

      liveBridges.get(session.id)?.sendMulawAudio(mulawBase64);
    },
    onCallEnded: async ({ providerCallId, reason }) => {
      const session = findSessionByProviderCallId(providerCallId);
      if (!session) {
        return;
      }

      createLiveHooks(session).onAction({
        type: 'asterisk_call_ended',
        description: reason,
        timestamp: new Date().toISOString(),
      });

      await endCall(session.id);
    },
    onCallPreflight: async ({
      providerCallId,
      direction,
      orgId: callbackOrgId,
      routeKey,
    }) => {
      const session = findSessionByProviderCallId(providerCallId);
      const resolvedOrgId = session
        ? getSessionOrgId(session)
        : direction === 'inbound'
          ? resolveInboundOrgId({
              deploymentMode: config.deployment.mode,
              defaultOrgId: config.deployment.defaultOrgId,
              provider: 'asterisk',
              event: {},
              routes: config.telephony.inboundOrgRoutes,
              fallbackRouteKey: routeKey || getAsteriskInboundRouteFallback(),
            })
          : callbackOrgId || (config.deployment.mode === 'self_hosted' ? config.deployment.defaultOrgId : undefined);
      if (!resolvedOrgId) {
        throw new Error(direction === 'inbound' ? 'Unknown hosted Asterisk inbound route' : 'Unknown hosted Asterisk outbound org');
      }

      const releaseReservation = session ? () => undefined : reserveHostedCallStart(resolvedOrgId);
      try {
        const billingAllowed = await ensureBillingAllowsCall(resolvedOrgId);
        if (!billingAllowed) {
          throw new Error('Hosted usage requires an active billing subscription before Asterisk live calls can start.');
        }
        return { orgId: resolvedOrgId, releaseReservation };
      } catch (error) {
        releaseReservation();
        throw error;
      }
    },
    onCallReady: async ({
      providerCallId,
      phone,
      direction,
      orgId,
      transport,
    }) => {
      let session = findSessionByProviderCallId(providerCallId);
      const billingAuthorizedAt = new Date();

      if (session && getSessionOrgId(session) !== orgId) {
        throw new Error('Asterisk call session belongs to another organization');
      }

      if (!session) {
        session = await ensureCallSession({
          phone,
          direction,
          providerCallId,
          orgId,
          billingAuthorizedAt,
        });
      } else if (!session.billingAuthorizedAt) {
        session.billingAuthorizedAt = billingAuthorizedAt;
        await persistCallSession(session).catch((error) => {
          console.error('[Call] Failed to persist Asterisk billing authorization:', error);
        });
      }

      await hydrateCallMetadataFromProvider(session);
      await ensureGeminiBridge(session, transport);
      startGeminiConversation(session);
    },
  });
}

assertStartupSecurity();

const server = http.createServer(async (req, res) => {
  setHttpSecurityHeaders(res);
  const pathname = getPathname(req);
  const isProviderVoiceWebhook = pathname === telephony.getAnswerPath() || isTwilioVoiceWebhookPath(pathname);
  const isProviderStatusWebhook = pathname === telephony.getStatusPath() || isTwilioStatusWebhookPath(pathname);

  if (req.method === 'POST' && (isProviderVoiceWebhook || isProviderStatusWebhook)) {
    const rawBody = await readRequestBody(req).catch(() => {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request body too large' }));
      return '';
    });
    if (!rawBody) {
      return;
    }

    const params = new URLSearchParams(rawBody);
    const event: Record<string, string> = {};
    for (const [key, value] of params) {
      event[key] = value;
    }

    const signature = telephony.getProvider() === 'plivo'
      ? req.headers['x-plivo-signature-v3'] as string | undefined
      : req.headers['x-twilio-signature'] as string | undefined;
    const nonce = req.headers['x-plivo-signature-v3-nonce'] as string | undefined;
    if (!telephony.verifyWebhookSignature(event, signature ?? null, isProviderStatusWebhook ? 'status' : 'voice', { nonce })) {
      console.warn(`[Webhook] Invalid ${telephony.getProvider()} signature, rejecting`);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid signature' }));
      return;
    }

    if (isProviderStatusWebhook) {
      await handleTelephonyStatusCallback(event, res);
      return;
    }

    const context = telephony.extractCallContext(event);
    const existingSession = findSessionByProviderCallId(context.providerCallId);
    const orgId = context.direction === 'inbound'
      ? resolveInboundOrgForEvent(event)
      : existingSession?.orgId ||
        (config.deployment.mode === 'self_hosted' ? config.deployment.defaultOrgId : undefined);
    if (!orgId) {
      console.warn(`[Webhook] Rejected unrouted hosted ${telephony.getProvider()} voice request`);
      rejectHttp(res, 403, 'Unknown inbound route');
      return;
    }

    const releaseReservation = existingSession && getSessionOrgId(existingSession) === orgId
      ? () => undefined
      : reserveHostedCallStart(orgId);
    try {
      const billingAllowed = await ensureBillingAllowsCall(orgId);
      if (!billingAllowed) {
        const response = telephony.buildInboundResponse({
          sessionId: '',
          providerCallId: event.CallSid || event.CallUUID || '',
          phone: event.From || event.To || '',
          useLiveStream: false,
        });
        res.writeHead(response.statusCode ?? 402, { 'Content-Type': response.contentType });
        res.end(response.body);
        return;
      }

      await handleTelephonyVoiceRequest(event, res);
    } finally {
      releaseReservation();
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'GET' && pathname === '/health/details') {
    const auth = authenticateDashboardRequest(req, 'calls:read');
    if (auth.ok === false) {
      rejectHttp(res, auth.statusCode, auth.message);
      return;
    }

    const telephonyStatus = getRuntimeTelephonyStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      activeCalls: activeCalls.size,
      mode: config.gemini.apiKey ? 'live' : 'simulation',
      provider: telephony.getProvider(),
      telephony: telephonyStatus,
      webhookPath: telephony.getAnswerPath(),
      statusPath: telephony.getStatusPath(),
      streamPath: telephony.getStreamWebSocketPath(),
      mediaStreamUrl: telephony.getMediaStreamUrl(),
      liveModel: config.gemini.liveModel,
      voiceName: config.gemini.voiceName,
    }));
    return;
  }

  if (req.method === 'GET' && pathname === '/calls/active') {
    const auth = authenticateDashboardRequest(req, 'calls:read');
    if (auth.ok === false) {
      rejectHttp(res, auth.statusCode, auth.message);
      return;
    }

    const calls = Array.from(activeCalls.values())
      .filter((session) => (session.orgId || config.deployment.defaultOrgId) === auth.payload.orgId)
      .map((session) => ({
      ...session,
      duration: Math.floor((Date.now() - session.startedAt.getTime()) / 1000),
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(calls));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const dashboardWss = new WebSocketServer({ noServer: true });
const telephonyStreamWss = new WebSocketServer({ noServer: true });
const dashboardSocketClaims = new Map<WebSocket, DashboardTokenPayload>();

server.on('upgrade', (req, socket, head) => {
  const pathname = getPathname(req);

  if (pathname === '/ws') {
    const auth = authenticateDashboardRequest(req, 'calls:read');
    if (auth.ok === false) {
      rejectUpgrade(socket, auth.statusCode, auth.message);
      return;
    }

    dashboardWss.handleUpgrade(req, socket, head, (ws) => {
      dashboardSocketClaims.set(ws, auth.payload);
      dashboardWss.emit('connection', ws, req);
    });
    return;
  }

  if (
    pathname === telephony.getStreamWebSocketPath() ||
    (telephony.getProvider() === 'twilio' && pathname === '/twilio-stream') ||
    (telephony.getProvider() === 'plivo' && pathname === '/plivo-stream')
  ) {
    const guardResult = mediaStreamUpgradeGuard.check(req);
    if (guardResult.ok === false) {
      rejectUpgrade(socket, guardResult.statusCode, guardResult.message);
      return;
    }

    telephonyStreamWss.handleUpgrade(req, socket, head, (ws) => {
      telephonyStreamWss.emit('connection', ws, req);
    });
    return;
  }

  socket.destroy();
});

dashboardWss.on('connection', (ws) => {
  console.log('[WS] Dashboard client connected');

  const initialState: WSMessage = {
    type: 'state',
    activeCalls: Array.from(activeCalls.values())
      .filter((session) => (session.orgId || config.deployment.defaultOrgId) === dashboardSocketClaims.get(ws)?.orgId)
      .map((session) => ({
      ...session,
      duration: Math.floor((Date.now() - session.startedAt.getTime()) / 1000),
    })),
  };
  ws.send(JSON.stringify(initialState));

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString()) as {
        type?: string;
        phone?: string;
        purpose?: string;
        callId?: string;
      };

      if (msg.type === 'make_call' && msg.phone && msg.purpose) {
        if (!dashboardSocketHasAction(ws, 'calls:write')) {
          sendDashboardError(ws, 'Dashboard token is not authorized to start calls');
          return;
        }

        const claims = getValidDashboardSocketClaims(ws);
        if (!claims) {
          return;
        }
        await startOutboundCall(msg.phone, msg.purpose, claims.orgId);
      }

      if (msg.type === 'barge_in' && msg.callId) {
        if (!dashboardSocketHasAction(ws, 'calls:write')) {
          sendDashboardError(ws, 'Dashboard token is not authorized to control calls');
          return;
        }

        const claims = getValidDashboardSocketClaims(ws);
        if (!claims) {
          return;
        }

        const session = activeCalls.get(msg.callId);
        if (!session) {
          sendDashboardError(ws, 'Call not found');
          return;
        }
        if ((session.orgId || config.deployment.defaultOrgId) !== claims.orgId) {
          sendDashboardError(ws, 'Call does not belong to this organization');
          return;
        }

        session.status = 'transferred';
        liveBridges.get(msg.callId)?.close();
        liveBridges.delete(msg.callId);

        const agent = activeAgents.get(msg.callId);
        if (agent instanceof ReceptionistAgent) {
          agent.stop();
        }

        if (session) {
          await persistCallSession(session).catch((error) => {
            console.error('[Call] Failed to persist transfer state:', error);
          });
        }

        broadcast({
          type: 'call_action',
          callId: msg.callId,
          action: {
            type: 'barge_in',
            description: 'User took over the call',
            timestamp: new Date().toISOString(),
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Dashboard websocket action failed';
      console.error('[WS] Error:', error);
      sendDashboardError(ws, message);
    }
  });

  ws.on('close', () => {
    dashboardSocketClaims.delete(ws);
    console.log('[WS] Dashboard client disconnected');
  });
});

telephonyStreamWss.on('connection', (ws) => {
  console.log(`[${telephony.getProvider()} Stream] Connected`);

  ws.on('message', (data) => {
    const handler = telephony.getProvider() === 'plivo'
      ? handlePlivoStreamMessage
      : telephony.getProvider() === 'asterisk'
        ? handleAsteriskStreamMessage
        : handleTwilioStreamMessage;
    void handler(ws, Buffer.isBuffer(data) ? data : Buffer.from(data.toString())).catch((error) => {
      console.error(`[${telephony.getProvider()} Stream] Error handling message:`, error);
    });
  });

  ws.on('close', () => {
    console.log(`[${telephony.getProvider()} Stream] Closed`);
    void cleanupSocketStreams(ws).catch((error) => {
      console.error(`[${telephony.getProvider()} Stream] Failed to cleanup socket streams:`, error);
    });
  });
});

setInterval(() => {
  const maxDuration = config.agent.maxCallDurationMin * 60 * 1000;
  for (const [id, session] of activeCalls) {
    const elapsed = Date.now() - session.startedAt.getTime();
    session.duration = Math.floor(elapsed / 1000);
    if (elapsed > maxDuration) {
      console.log(`[Call] Auto-ending call ${id}, max duration reached`);
      void endCall(id, { hangupProvider: true });
    }
  }
}, 30000);

setInterval(() => {
  void flushPendingHostedUsageEvents().catch((error) => {
    console.error('[Billing] Failed to flush pending hosted usage:', error);
  });
}, 5 * 60 * 1000).unref();

server.listen(config.server.port, async () => {
  await reconcileStaleCallRows();
  await ensureAgentConfig();
  await flushPendingHostedUsageEvents().catch((error) => {
    console.error('[Billing] Failed to flush pending hosted usage on startup:', error);
  });
  await asteriskRuntime?.start();
  const telephonyStatus = getRuntimeTelephonyStatus();
  console.log('');
  console.log('============================================');
  console.log('  Business Voice Agent');
  console.log('============================================');
  console.log(`  HTTP:  http://localhost:${config.server.port}`);
  console.log(`  WS:    ws://localhost:${config.server.port}/ws`);
  if (telephony.getProvider() === 'asterisk') {
    console.log(`  Media: RTP/UDP externalMedia -> ${config.asterisk.externalMediaHost || 'not configured'}:dynamic`);
    console.log(`  ARI:   ${config.asterisk.ariBaseUrl || 'not configured'}`);
  } else {
    console.log(`  Stream: ws://localhost:${config.server.port}${telephony.getStreamWebSocketPath()}`);
  }
  console.log(`  Telephony: ${telephony.getProvider().toUpperCase()}`);
  console.log(`  Agent: ${config.agent.name}`);
  console.log(`  Role:  ${config.agent.role}`);
  console.log(`  Business: ${config.business.name}`);
  console.log(`  Mode:  ${config.gemini.apiKey ? `LIVE (${config.gemini.liveModel})` : 'SIMULATION (no GEMINI_API_KEY)'}`);
  console.log(`  Telephony status: ${telephonyStatus.message}`);
  if (telephony.getProvider() === 'asterisk') {
    console.log('  Webhook: not used (ARI websocket runtime)');
    console.log('  Status:  not used (ARI websocket runtime)');
  } else {
    console.log(`  Webhook: ${telephony.getAnswerPath()}`);
    console.log(`  Status:  ${telephony.getStatusPath()}`);
  }
  console.log(`  Health: http://localhost:${config.server.port}/health`);
  console.log('============================================');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n[Agent] Shutting down...');
  const shutdown = Array.from(activeCalls.keys()).map((id) => endCall(id));
  Promise.allSettled(shutdown).finally(() => {
    const stopRuntime = asteriskRuntime ? asteriskRuntime.stop() : Promise.resolve();
    void stopRuntime.finally(() => {
      server.close(() => process.exit(0));
    });
  });
});
