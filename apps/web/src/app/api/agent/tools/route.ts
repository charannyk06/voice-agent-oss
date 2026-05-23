import {
  ApiError,
  handleRouteError,
  json,
  optionalBoolean,
  optionalString,
  readJson,
} from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireDashboardUser } from "@/lib/auth";

const defaultTools = [
  {
    key: "appointment-booking",
    name: "Appointment Booking",
    description: "Book and confirm service appointments.",
  },
  {
    key: "appointment-rescheduling",
    name: "Appointment Changes",
    description: "Reschedule or cancel existing appointments.",
  },
  {
    key: "follow-up-workflows",
    name: "Follow-up Workflows",
    description: "Schedule callbacks and follow-up tasks.",
  },
  {
    key: "contact-lookup",
    name: "Contact Lookup",
    description: "Look up known customers by phone and caller history.",
  },
  {
    key: "people-memory-search",
    name: "People Memory Search",
    description: "Search caller notes, memories, and known people by name, phone, or topic.",
  },
  {
    key: "recent-call-history",
    name: "Recent Call History",
    description: "Summarize recent calls, outcomes, and appointments for a caller.",
  },
  {
    key: "service-directory",
    name: "Service Directory",
    description: "Look up services, policies, escalation paths, and saved front-desk details.",
  },
  {
    key: "callback-capture",
    name: "Callback Capture",
    description: "Capture unresolved questions for staff callback with preferred timing.",
  },
  {
    key: "business-knowledge",
    name: "Business Knowledge",
    description: "Answer service and policy questions using saved business knowledge.",
  },
  {
    key: "external-knowledge-search",
    name: "External Knowledge Search",
    description: "Search public, non-professional information when an external search provider is configured.",
  },
  {
    key: "sms-notifications",
    name: "SMS Notifications",
    description: "Send confirmations, reminders, and callback texts.",
  },
  {
    key: "human-transfer",
    name: "Human Transfer",
    description: "Escalate urgent and unresolved cases to a team member.",
  },
  {
    key: "marketing-outreach",
    name: "Marketing Outreach",
    description: "Track campaign interest and do-not-call preferences.",
  },
];

async function ensureToolDefaults(orgId: string) {
  for (const tool of defaultTools) {
    await prisma.agentToolConfig.upsert({
      where: { orgId_key: { orgId, key: tool.key } },
      update: {
        name: tool.name,
        description: tool.description,
      },
      create: {
        ...tool,
        orgId,
        enabled: true,
      },
    });
  }
}

export async function GET() {
  try {
    const { orgId } = await requireDashboardUser();
    await ensureToolDefaults(orgId);
    const tools = await prisma.agentToolConfig.findMany({
      where: { orgId },
      orderBy: { name: "asc" },
    });

    return json({ tools });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { orgId } = await requireDashboardUser();
    const body = await readJson<Record<string, unknown>>(request);
    const tools = Array.isArray(body.tools) ? body.tools : null;
    if (!tools) {
      throw new ApiError(400, "tools array is required");
    }

    const updated = [];
    for (const entry of tools) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const key = optionalString((entry as Record<string, unknown>).key);
      if (!key) {
        continue;
      }

      const tool = await prisma.agentToolConfig.upsert({
        where: { orgId_key: { orgId, key } },
        update: {
          name: optionalString((entry as Record<string, unknown>).name),
          description: optionalString((entry as Record<string, unknown>).description),
          enabled: optionalBoolean((entry as Record<string, unknown>).enabled),
        },
        create: {
          orgId,
          key,
          name: optionalString((entry as Record<string, unknown>).name) ?? key,
          description: optionalString((entry as Record<string, unknown>).description) ?? "",
          enabled: optionalBoolean((entry as Record<string, unknown>).enabled) ?? true,
        },
      });
      updated.push(tool);
    }

    return json({ tools: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}
