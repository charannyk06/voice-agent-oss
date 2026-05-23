import { handleRouteError, json } from "@/lib/api";
import { requireDashboardUser } from "@/lib/auth";
import { createAgentToken } from "@/lib/agent-token";

type TelephonyProvider = "twilio" | "plivo" | "asterisk";

type TelephonyStatus = {
  provider: TelephonyProvider;
  label: string;
  configured: boolean;
  ready: boolean;
  health: "ready" | "configuration_required" | "foundation_only";
  controlMode: "webhook" | "ari";
  liveMediaReady: boolean;
  entryPoint: string | null;
  message: string;
  webhookPath: string;
  statusPath: string;
  streamWebSocketPath: string;
  webhookUrl: string;
  statusCallbackUrl: string;
  mediaStreamUrl: string;
  details: Array<{
    label: string;
    value: string | null;
  }>;
  notes: string[];
};

function stripTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function databaseMode() {
  const url = process.env.DATABASE_URL || "";
  if (!url) return "missing";
  if (url.startsWith("file:")) return "sqlite-file";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) return "postgres";
  if (url.startsWith("mysql://")) return "mysql";
  return "other";
}

function detectTelephonyProvider(): TelephonyProvider {
  const explicit = (process.env.TELEPHONY_PROVIDER || "").toLowerCase();
  if (explicit === "twilio" || explicit === "plivo" || explicit === "asterisk") {
    return explicit;
  }
  if (process.env.PLIVO_AUTH_ID) {
    return "plivo";
  }
  if (
    process.env.ASTERISK_ARI_BASE_URL ||
    process.env.ASTERISK_PJSIP_ENDPOINT ||
    process.env.ASTERISK_SIP_DOMAIN
  ) {
    return "asterisk";
  }
  return "twilio";
}

function buildFallbackTelephonyStatus(provider: TelephonyProvider): TelephonyStatus {
  const publicBaseUrl = stripTrailingSlash(
    process.env.TELEPHONY_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || ""
  );
  const twilioPublicBaseUrl = stripTrailingSlash(
    process.env.TWILIO_PUBLIC_BASE_URL || publicBaseUrl
  );
  const plivoPublicBaseUrl = stripTrailingSlash(
    process.env.PLIVO_PUBLIC_BASE_URL || publicBaseUrl
  );
  const twilioWebhookPath = process.env.TWILIO_WEBHOOK_PATH || "/webhook/twilio";
  const plivoAnswerPath = process.env.PLIVO_ANSWER_PATH || "/webhook/plivo/answer";
  const plivoStatusPath = process.env.PLIVO_STATUS_PATH || "/webhook/plivo/status";
  const asteriskEventPath = process.env.ASTERISK_EVENT_PATH || "/webhook/asterisk/events";
  const asteriskStatusPath = process.env.ASTERISK_STATUS_PATH || "/webhook/asterisk/status";
  const asteriskMediaWsPath = process.env.ASTERISK_MEDIA_WS_PATH || "/stream/asterisk";

  if (provider === "plivo") {
    const configured = Boolean(
      process.env.PLIVO_AUTH_ID &&
      process.env.PLIVO_AUTH_TOKEN &&
      process.env.PLIVO_PHONE_NUMBER
    );
    const webhookUrl = plivoPublicBaseUrl ? `${plivoPublicBaseUrl}${plivoAnswerPath}` : "";
    const statusCallbackUrl = plivoPublicBaseUrl ? `${plivoPublicBaseUrl}${plivoStatusPath}` : "";
    const mediaStreamUrl =
      process.env.PLIVO_MEDIA_STREAM_URL ||
      (plivoPublicBaseUrl ? `${plivoPublicBaseUrl}/plivo-stream` : "");

    return {
      provider,
      label: "Plivo",
      configured,
      ready: configured && Boolean(webhookUrl),
      health: configured && webhookUrl ? "ready" : "configuration_required",
      controlMode: "webhook",
      liveMediaReady: Boolean(mediaStreamUrl),
      entryPoint: process.env.PLIVO_PHONE_NUMBER || null,
      message:
        configured && webhookUrl
          ? "Plivo legacy adapter is ready."
          : "Plivo credentials or callback URLs are missing.",
      webhookPath: plivoAnswerPath,
      statusPath: plivoStatusPath,
      streamWebSocketPath: "/plivo-stream",
      webhookUrl,
      statusCallbackUrl,
      mediaStreamUrl,
      details: [
        { label: "Phone number", value: process.env.PLIVO_PHONE_NUMBER || null },
        { label: "Public base URL", value: plivoPublicBaseUrl || null },
        { label: "Media stream URL", value: mediaStreamUrl || null },
      ],
      notes: [],
    };
  }

  if (provider === "asterisk") {
    const configured = Boolean(
      process.env.ASTERISK_ARI_BASE_URL &&
      process.env.ASTERISK_ARI_USERNAME &&
      process.env.ASTERISK_ARI_PASSWORD
    );
    const liveMediaConfigured = configured && Boolean(process.env.ASTERISK_EXTERNAL_MEDIA_HOST);
    const sipHost = process.env.ASTERISK_SIP_DOMAIN || process.env.ASTERISK_PUBLIC_HOST || "";
    const sipEndpoint = process.env.ASTERISK_PJSIP_ENDPOINT || "byoc-trunk";
    const entryPoint = sipHost ? `sip:${sipEndpoint}@${sipHost}` : `PJSIP/${sipEndpoint}`;
    const webhookUrl = publicBaseUrl ? `${publicBaseUrl}${asteriskEventPath}` : "";
    const statusCallbackUrl = publicBaseUrl ? `${publicBaseUrl}${asteriskStatusPath}` : "";

    return {
      provider,
      label: "Asterisk",
      configured,
      ready: liveMediaConfigured,
      health: liveMediaConfigured ? "ready" : configured ? "foundation_only" : "configuration_required",
      controlMode: "ari",
      liveMediaReady: liveMediaConfigured,
      entryPoint,
      message: !configured
        ? "Asterisk is selected, but ARI credentials are missing."
        : !liveMediaConfigured
          ? "Asterisk ARI control is configured. Set ASTERISK_EXTERNAL_MEDIA_HOST so Asterisk can send RTP to the agent runtime."
          : "Asterisk ARI control and external media are configured. Runtime connection state is verified from the agent /health endpoint.",
      webhookPath: asteriskEventPath,
      statusPath: asteriskStatusPath,
      streamWebSocketPath: asteriskMediaWsPath,
      webhookUrl,
      statusCallbackUrl,
      mediaStreamUrl: "",
      details: [
        { label: "ARI base URL", value: process.env.ASTERISK_ARI_BASE_URL || null },
        { label: "ARI application", value: process.env.ASTERISK_ARI_APPLICATION || "voice-agent" },
        { label: "SIP entry point", value: entryPoint },
        { label: "Inbound context", value: process.env.ASTERISK_INBOUND_CONTEXT || "voice-agent-inbound" },
        { label: "Outbound context", value: process.env.ASTERISK_OUTBOUND_CONTEXT || "voice-agent-outbound" },
        { label: "External media host", value: process.env.ASTERISK_EXTERNAL_MEDIA_HOST || null },
        { label: "External media bind address", value: process.env.ASTERISK_EXTERNAL_MEDIA_BIND_ADDRESS || "0.0.0.0" },
        {
          label: "External media port",
          value: process.env.ASTERISK_EXTERNAL_MEDIA_PORT || "dynamic",
        },
      ],
      notes: [
        "Route traffic in through a SIP trunk, PBX, forwarding rule, or gateway.",
        "The live bridge uses ARI externalMedia over RTP/UDP with ulaw at 8 kHz.",
        "When agent health is unavailable, this fallback cannot confirm the live ARI websocket state.",
        "If ASTERISK_EXTERNAL_MEDIA_PORT is fixed to a single port, only one live call can bind it at a time.",
      ],
    };
  }

  const configured = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );
  const webhookUrl = twilioPublicBaseUrl ? `${twilioPublicBaseUrl}${twilioWebhookPath}` : "";
  const statusCallbackUrl = twilioPublicBaseUrl ? `${twilioPublicBaseUrl}${twilioWebhookPath}/status` : "";
  const mediaStreamUrl =
    process.env.TWILIO_MEDIA_STREAM_URL ||
    (twilioPublicBaseUrl ? `${twilioPublicBaseUrl}/twilio-stream` : "");

  return {
    provider,
    label: "Twilio",
    configured,
    ready: configured && Boolean(webhookUrl),
    health: configured && webhookUrl ? "ready" : "configuration_required",
    controlMode: "webhook",
    liveMediaReady: Boolean(mediaStreamUrl),
    entryPoint: process.env.TWILIO_PHONE_NUMBER || null,
    message:
      configured && webhookUrl
        ? "Twilio legacy adapter is ready."
        : "Twilio credentials or callback URLs are missing.",
    webhookPath: twilioWebhookPath,
    statusPath: `${twilioWebhookPath}/status`,
    streamWebSocketPath: "/twilio-stream",
    webhookUrl,
    statusCallbackUrl,
    mediaStreamUrl,
    details: [
      { label: "Phone number", value: process.env.TWILIO_PHONE_NUMBER || null },
      { label: "Public base URL", value: twilioPublicBaseUrl || null },
      { label: "Media stream URL", value: mediaStreamUrl || null },
    ],
    notes: [],
  };
}

function buildProviderSummaries(
  activeProvider: TelephonyProvider,
  activeStatus: TelephonyStatus
) {
  const twilioConfigured = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );
  const plivoConfigured = Boolean(
    process.env.PLIVO_AUTH_ID &&
    process.env.PLIVO_AUTH_TOKEN &&
    process.env.PLIVO_PHONE_NUMBER
  );
  const asteriskConfigured = Boolean(
    process.env.ASTERISK_ARI_BASE_URL &&
    process.env.ASTERISK_ARI_USERNAME &&
    process.env.ASTERISK_ARI_PASSWORD
  );

  const fallback: Record<TelephonyProvider, {
    key: TelephonyProvider;
    name: string;
    configured: boolean;
    ready: boolean;
    active: boolean;
    message: string;
  }> = {
    twilio: {
      key: "twilio",
      name: "Twilio",
      configured: twilioConfigured,
      ready: twilioConfigured && Boolean(process.env.TWILIO_PUBLIC_BASE_URL || process.env.TELEPHONY_PUBLIC_BASE_URL),
      active: activeProvider === "twilio",
      message: twilioConfigured
        ? "Twilio credentials detected."
        : "Twilio credentials missing.",
    },
    plivo: {
      key: "plivo",
      name: "Plivo",
      configured: plivoConfigured,
      ready: plivoConfigured && Boolean(process.env.PLIVO_PUBLIC_BASE_URL || process.env.TELEPHONY_PUBLIC_BASE_URL),
      active: activeProvider === "plivo",
      message: plivoConfigured
        ? "Plivo credentials detected."
        : "Plivo credentials missing.",
    },
    asterisk: {
      key: "asterisk",
      name: "Asterisk",
      configured: asteriskConfigured,
      ready: asteriskConfigured && Boolean(process.env.ASTERISK_EXTERNAL_MEDIA_HOST),
      active: activeProvider === "asterisk",
      message: asteriskConfigured
        ? process.env.ASTERISK_EXTERNAL_MEDIA_HOST
          ? "Asterisk ARI credentials and external media host detected."
          : "Asterisk ARI credentials detected, but ASTERISK_EXTERNAL_MEDIA_HOST is missing."
        : "Asterisk ARI credentials missing.",
    },
  };

  fallback[activeProvider] = {
    key: activeStatus.provider,
    name: activeStatus.label,
    configured: activeStatus.configured,
    ready: activeStatus.ready,
    active: true,
    message: activeStatus.message,
  };

  return [fallback.twilio, fallback.plivo, fallback.asterisk];
}

async function fetchAgentTelephonyStatus(agentUrl: string, token?: string): Promise<TelephonyStatus | null> {
  try {
    const response = await fetch(`${agentUrl}/health/details`, {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      telephony?: TelephonyStatus;
    };
    return payload.telephony ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const { userId, orgId } = await requireDashboardUser();
    const agentUrl = process.env.NEXT_PUBLIC_AGENT_URL || process.env.AGENT_URL || "";
    const dashboardSecret = process.env.AGENT_DASHBOARD_TOKEN_SECRET || "";
    const agentToken = dashboardSecret
      ? createAgentToken({
          userId,
          orgId,
          subscriptionStatus: "dashboard",
          allowedActions: ["calls:read"],
        }, {
          secret: dashboardSecret,
          ttlSeconds: 60,
        })
      : "";
    const explicitWs = process.env.NEXT_PUBLIC_WS_URL || "";
    const telephonyProvider = detectTelephonyProvider();
    const telephony =
      (agentUrl ? await fetchAgentTelephonyStatus(agentUrl, agentToken) : null) ??
      buildFallbackTelephonyStatus(telephonyProvider);

    return json({
      telephonyProvider: telephony.provider,
      phoneNumber:
        process.env.PLIVO_PHONE_NUMBER ||
        process.env.TWILIO_PHONE_NUMBER ||
        null,
      entryPoint: telephony.entryPoint,
      telephony,
      agentUrl: agentUrl || null,
      websocketUrl: explicitWs || null,
      twilioPublicBaseUrl: process.env.TWILIO_PUBLIC_BASE_URL || null,
      twilioMediaStreamUrl: process.env.TWILIO_MEDIA_STREAM_URL || null,
      plivoPublicBaseUrl: process.env.PLIVO_PUBLIC_BASE_URL || null,
      plivoMediaStreamUrl: process.env.PLIVO_MEDIA_STREAM_URL || null,
      asteriskAriBaseUrl: process.env.ASTERISK_ARI_BASE_URL || null,
      databaseMode: databaseMode(),
      security: {
        authProvider: "clerk",
        clerkConfigured: Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
      },
      providers: buildProviderSummaries(telephony.provider, telephony),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
