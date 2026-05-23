type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asDirection(value: unknown): "inbound" | "outbound" {
  return value === "outbound" ? "outbound" : "inbound";
}

function asCallStatus(value: unknown): "active" | "completed" | "missed" | "blocked" | "transferred" {
  return value === "completed" || value === "missed" || value === "blocked" || value === "transferred"
    ? value
    : "active";
}

function asSpeaker(value: unknown): "agent" | "human" {
  return value === "agent" ? "agent" : "human";
}

export function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export type UiCallAction = {
  id: string;
  type: string;
  description: string;
};

export type WsCallAction = {
  type: string;
  description: string;
  timestamp: string;
};

export type TranscriptLine = {
  speaker: "agent" | "human";
  text: string;
  timestamp: string;
};

export type WsCallSession = {
  id: string;
  providerCallId?: string;
  contactName: string;
  phone: string;
  direction: "inbound" | "outbound";
  status: "active" | "completed" | "missed" | "blocked" | "transferred";
  startedAt: string;
  endedAt?: string;
  duration: number;
  transcript: TranscriptLine[];
  actions: WsCallAction[];
  summary?: string;
  outcome?: string;
};

export type PastCall = {
  id: string;
  contactName: string;
  phone: string;
  direction: string;
  status: string;
  duration: number;
  summary: string | null;
  outcome: string | null;
  startedAt: string;
  endedAt: string | null;
  actions: UiCallAction[];
};

export type Approval = {
  id: string;
  type: string;
  title: string;
  description?: string;
  risk: string;
  status: string;
  contact?: string;
  phone?: string;
  callContext?: string;
  createdAt: string;
};

export type Contact = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  category: string;
  starred: boolean;
  doNotCall: boolean;
  notes: string | null;
  memoryCount: number;
  lastCall: string | null;
};

export type ContactMemory = {
  id: string;
  text: string;
  source: string;
  createdAt: string;
};

export type ContactCall = {
  id: string;
  contactName: string;
  phone: string;
  direction: string;
  status: string;
  duration: number;
  summary: string | null;
  startedAt: string;
  actions: UiCallAction[];
};

export type ContactDetail = Contact & {
  memories: ContactMemory[];
  calls: ContactCall[];
};

export type DashboardData = {
  activeCalls: number;
  todayCalls: number;
  pendingApprovals: number;
  monthSpendCents: number;
  businessName: string;
  businessLocation: string;
  receptionNumber: string;
  agent: {
    status: string;
    name: string;
    voice: string;
  };
};

export type RecentCall = {
  id: string;
  contactName: string;
  phone: string;
  direction: string;
  status: string;
  summary?: string;
  startedAt: string;
};

export type PendingApprovalSummary = {
  id: string;
  type: string;
  title: string;
  contact?: string;
  phone?: string;
  risk: string;
};

export type SettingsStatus = {
  telephonyProvider: string;
  phoneNumber: string | null;
  entryPoint: string | null;
  agentUrl: string | null;
  websocketUrl: string | null;
  twilioPublicBaseUrl: string | null;
  twilioMediaStreamUrl: string | null;
  plivoPublicBaseUrl: string | null;
  plivoMediaStreamUrl: string | null;
  asteriskAriBaseUrl: string | null;
  databaseMode: string;
  telephony: {
    provider: string;
    label: string;
    configured: boolean;
    ready: boolean;
    health: string;
    controlMode: string;
    liveMediaReady: boolean;
    entryPoint: string | null;
    message: string;
    webhookPath: string;
    statusPath: string;
    streamWebSocketPath: string;
    webhookUrl: string | null;
    statusCallbackUrl: string | null;
    mediaStreamUrl: string | null;
    details: Array<{
      label: string;
      value: string | null;
    }>;
    notes: string[];
  } | null;
  security: {
    authProvider: string;
    clerkConfigured: boolean;
  };
  providers: Array<{
    key: string;
    name: string;
    configured: boolean;
    ready: boolean;
    active: boolean;
    message: string;
  }>;
};

export function normalizeUiCallAction(value: unknown): UiCallAction {
  const record = asRecord(value);
  return {
    id: asString(record?.id, `action-${Math.random().toString(36).slice(2, 10)}`),
    type: asString(record?.type, "unknown"),
    description: asString(record?.description, "Action recorded"),
  };
}

export function normalizeWsCallAction(value: unknown): WsCallAction {
  const record = asRecord(value);
  return {
    type: asString(record?.type, "unknown"),
    description: asString(record?.description, "Action recorded"),
    timestamp: asString(record?.timestamp, new Date().toISOString()),
  };
}

export function normalizeTranscriptLine(value: unknown): TranscriptLine {
  const record = asRecord(value);
  return {
    speaker: asSpeaker(record?.speaker),
    text: asString(record?.text),
    timestamp: asString(record?.timestamp, new Date().toISOString()),
  };
}

export function normalizeWsCallSession(value: unknown): WsCallSession {
  const record = asRecord(value);
  return {
    id: asString(record?.id),
    providerCallId: asNullableString(record?.providerCallId) ?? undefined,
    contactName: asString(record?.contactName, "Unknown caller"),
    phone: asString(record?.phone),
    direction: asDirection(record?.direction),
    status: asCallStatus(record?.status),
    startedAt: asString(record?.startedAt, new Date().toISOString()),
    endedAt: asNullableString(record?.endedAt) ?? undefined,
    duration: asNumber(record?.duration),
    transcript: ensureArray(record?.transcript).map(normalizeTranscriptLine),
    actions: ensureArray(record?.actions).map(normalizeWsCallAction),
    summary: asNullableString(record?.summary) ?? undefined,
    outcome: asNullableString(record?.outcome) ?? undefined,
  };
}

export function normalizePastCall(value: unknown): PastCall {
  const record = asRecord(value);
  return {
    id: asString(record?.id),
    contactName: asString(record?.contactName, "Unknown caller"),
    phone: asString(record?.phone),
    direction: asString(record?.direction, "inbound"),
    status: asString(record?.status, "completed"),
    duration: asNumber(record?.duration),
    summary: asNullableString(record?.summary),
    outcome: asNullableString(record?.outcome),
    startedAt: asString(record?.startedAt, new Date().toISOString()),
    endedAt: asNullableString(record?.endedAt),
    actions: ensureArray(record?.actions).map(normalizeUiCallAction),
  };
}

export function normalizeApproval(value: unknown): Approval {
  const record = asRecord(value);
  return {
    id: asString(record?.id),
    type: asString(record?.type, "general"),
    title: asString(record?.title, "Untitled approval"),
    description: asNullableString(record?.description) ?? undefined,
    risk: asString(record?.risk, "medium"),
    status: asString(record?.status, "pending"),
    contact: asNullableString(record?.contact) ?? undefined,
    phone: asNullableString(record?.phone) ?? undefined,
    callContext: asNullableString(record?.callContext) ?? undefined,
    createdAt: asString(record?.createdAt, new Date().toISOString()),
  };
}

export function normalizeContact(value: unknown): Contact {
  const record = asRecord(value);
  return {
    id: asString(record?.id),
    name: asString(record?.name, "Unknown contact"),
    phone: asString(record?.phone),
    email: asNullableString(record?.email),
    category: asString(record?.category, "general"),
    starred: asBoolean(record?.starred),
    doNotCall: asBoolean(record?.doNotCall),
    notes: asNullableString(record?.notes),
    memoryCount: asNumber(record?.memoryCount),
    lastCall: asNullableString(record?.lastCall),
  };
}

export function normalizeContactMemory(value: unknown): ContactMemory {
  const record = asRecord(value);
  return {
    id: asString(record?.id),
    text: asString(record?.text),
    source: asString(record?.source, "unknown"),
    createdAt: asString(record?.createdAt, new Date().toISOString()),
  };
}

export function normalizeContactCall(value: unknown): ContactCall {
  const record = asRecord(value);
  return {
    id: asString(record?.id),
    contactName: asString(record?.contactName, "Unknown caller"),
    phone: asString(record?.phone),
    direction: asString(record?.direction, "inbound"),
    status: asString(record?.status, "completed"),
    duration: asNumber(record?.duration),
    summary: asNullableString(record?.summary),
    startedAt: asString(record?.startedAt, new Date().toISOString()),
    actions: ensureArray(record?.actions).map(normalizeUiCallAction),
  };
}

export function normalizeContactDetail(value: unknown): ContactDetail {
  const record = asRecord(value);
  const base = normalizeContact(record);
  return {
    ...base,
    memories: ensureArray(record?.memories).map(normalizeContactMemory),
    calls: ensureArray(record?.calls).map(normalizeContactCall),
  };
}

export function normalizeDashboardData(value: unknown): DashboardData {
  const record = asRecord(value);
  const agentRecord = asRecord(record?.agent);
  return {
    activeCalls: asNumber(record?.activeCalls),
    todayCalls: asNumber(record?.todayCalls),
    pendingApprovals: asNumber(record?.pendingApprovals),
    monthSpendCents: asNumber(record?.monthSpendCents),
    businessName: asString(record?.businessName, "Example Business"),
    businessLocation: asString(
      record?.businessLocation,
      "123 Main Street, Example City"
    ),
    receptionNumber: asString(record?.receptionNumber, "+15551234567"),
    agent: {
      status: asString(agentRecord?.status, "unknown"),
      name: asString(agentRecord?.name, "Reception Desk"),
      voice: asString(agentRecord?.voice, "v1"),
    },
  };
}

export function normalizeRecentCall(value: unknown): RecentCall {
  const record = asRecord(value);
  return {
    id: asString(record?.id),
    contactName: asString(record?.contactName, "Unknown caller"),
    phone: asString(record?.phone),
    direction: asString(record?.direction, "inbound"),
    status: asString(record?.status, "completed"),
    summary: asNullableString(record?.summary) ?? undefined,
    startedAt: asString(record?.startedAt, new Date().toISOString()),
  };
}

export function normalizePendingApprovalSummary(value: unknown): PendingApprovalSummary {
  const record = asRecord(value);
  return {
    id: asString(record?.id),
    type: asString(record?.type, "general"),
    title: asString(record?.title, "Untitled approval"),
    contact: asNullableString(record?.contact) ?? undefined,
    phone: asNullableString(record?.phone) ?? undefined,
    risk: asString(record?.risk, "medium"),
  };
}

export function normalizeSettingsStatus(value: unknown): SettingsStatus {
  const record = asRecord(value);
  const security = asRecord(record?.security);
  const telephony = asRecord(record?.telephony);

  return {
    telephonyProvider: asString(record?.telephonyProvider, "twilio"),
    phoneNumber: asNullableString(record?.phoneNumber),
    entryPoint: asNullableString(record?.entryPoint),
    agentUrl: asNullableString(record?.agentUrl),
    websocketUrl: asNullableString(record?.websocketUrl),
    twilioPublicBaseUrl: asNullableString(record?.twilioPublicBaseUrl),
    twilioMediaStreamUrl: asNullableString(record?.twilioMediaStreamUrl),
    plivoPublicBaseUrl: asNullableString(record?.plivoPublicBaseUrl),
    plivoMediaStreamUrl: asNullableString(record?.plivoMediaStreamUrl),
    asteriskAriBaseUrl: asNullableString(record?.asteriskAriBaseUrl),
    databaseMode: asString(record?.databaseMode, "unknown"),
    telephony: telephony
      ? {
          provider: asString(telephony.provider, "twilio"),
          label: asString(telephony.label, "Telephony"),
          configured: asBoolean(telephony.configured),
          ready: asBoolean(telephony.ready),
          health: asString(telephony.health, "configuration_required"),
          controlMode: asString(telephony.controlMode, "webhook"),
          liveMediaReady: asBoolean(telephony.liveMediaReady),
          entryPoint: asNullableString(telephony.entryPoint),
          message: asString(telephony.message),
          webhookPath: asString(telephony.webhookPath),
          statusPath: asString(telephony.statusPath),
          streamWebSocketPath: asString(telephony.streamWebSocketPath),
          webhookUrl: asNullableString(telephony.webhookUrl),
          statusCallbackUrl: asNullableString(telephony.statusCallbackUrl),
          mediaStreamUrl: asNullableString(telephony.mediaStreamUrl),
          details: ensureArray(telephony.details).map((detail) => {
            const detailRecord = asRecord(detail);
            return {
              label: asString(detailRecord?.label, "Detail"),
              value: asNullableString(detailRecord?.value),
            };
          }),
          notes: ensureArray(telephony.notes).map((note) => asString(note)).filter(Boolean),
        }
      : null,
    security: {
      authProvider: String(security?.authProvider || "unknown"),
      clerkConfigured: asBoolean(security?.clerkConfigured),
    },
    providers: ensureArray(record?.providers).map((provider) => {
      const providerRecord = asRecord(provider);
      return {
        key: asString(providerRecord?.key, "unknown"),
        name: asString(providerRecord?.name, "Unknown provider"),
        configured: asBoolean(providerRecord?.configured),
        ready: asBoolean(providerRecord?.ready),
        active: asBoolean(providerRecord?.active),
        message: asString(providerRecord?.message),
      };
    }),
  };
}
