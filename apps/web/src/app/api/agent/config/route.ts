import {
  handleRouteError,
  json,
  optionalInt,
  optionalString,
  readJson,
} from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireDashboardUser } from "@/lib/auth";

const defaultInstructions = `You are the live voice receptionist for Example Business.

Your job:
- handle appointment and service booking requests
- help callers reach the right team or service line
- answer basic front-desk questions using only saved business knowledge
- stay natural in English or the caller's preferred language

Start with:
"Hello, this is the Example Business reception desk. How can I help you today?"

Business context:
- Business: Example Business
- Location: 123 Main Street, Example City
- Main contact line: +15551234567
- Services: Customer Support, Billing Support, Scheduling Support, General Support

Rules:
- Never provide regulated professional advice unless approved business knowledge explicitly covers it.
- If the caller sounds urgent, distressed, or unsafe, immediately transfer or escalate to +15551234567.
- If exact staff timing, price, or slot availability is not confirmed in the dashboard data, do not guess. Collect the caller's details and offer a callback or transfer.
- Keep replies short, warm, and phone-friendly.
- Never mention AI, model names, or internal tools.`;

function defaultConfig(orgId = "default") {
  return {
    id: orgId,
    name: "Reception Desk",
    voice: "v1",
    instructions: defaultInstructions,
    languageCode: "en-US",
    businessName: "Example Business",
    businessLocation: "123 Main Street, Example City",
    receptionNumber: "+15551234567",
    urgentTransferNumber: "+15551234567",
    businessHoursStart: "00:00",
    businessHoursEnd: "23:59",
    maxCallDurationMin: 15,
    budgetMonthlyCents: 70000,
    budgetDailyAlertCents: 3000,
    autoApproveBookingsUnderCents: 5000,
  };
}

export async function GET() {
  try {
    const { orgId } = await requireDashboardUser();
    const config = await prisma.agentConfig.findUnique({
      where: { id: orgId },
    });

    return json({
      config: config ?? defaultConfig(orgId),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { orgId } = await requireDashboardUser();
    const body = await readJson<Record<string, unknown>>(request);
    const defaults = defaultConfig(orgId);

    const config = await prisma.agentConfig.upsert({
      where: { id: orgId },
      update: {
        name: optionalString(body.name),
        voice: optionalString(body.voice),
        instructions:
          "instructions" in body && body.instructions === null
            ? null
            : optionalString(body.instructions) ?? defaults.instructions,
        languageCode: optionalString(body.languageCode),
        businessName: optionalString(body.businessName),
        businessLocation: optionalString(body.businessLocation),
        receptionNumber: optionalString(body.receptionNumber),
        urgentTransferNumber: optionalString(body.urgentTransferNumber),
        businessHoursStart: optionalString(body.businessHoursStart),
        businessHoursEnd: optionalString(body.businessHoursEnd),
        maxCallDurationMin: optionalInt(body.maxCallDurationMin, "maxCallDurationMin"),
        budgetMonthlyCents: optionalInt(body.budgetMonthlyCents, "budgetMonthlyCents"),
        budgetDailyAlertCents: optionalInt(
          body.budgetDailyAlertCents,
          "budgetDailyAlertCents",
        ),
        autoApproveBookingsUnderCents: optionalInt(
          body.autoApproveBookingsUnderCents,
          "autoApproveBookingsUnderCents",
        ),
      },
      create: {
        id: orgId,
        name: optionalString(body.name) ?? defaults.name,
        voice: optionalString(body.voice) ?? defaults.voice,
        instructions:
          "instructions" in body && body.instructions === null
            ? null
            : optionalString(body.instructions) ?? defaults.instructions,
        languageCode: optionalString(body.languageCode) ?? defaults.languageCode,
        businessName: optionalString(body.businessName) ?? defaults.businessName,
        businessLocation:
          optionalString(body.businessLocation) ?? defaults.businessLocation,
        receptionNumber: optionalString(body.receptionNumber) ?? defaults.receptionNumber,
        urgentTransferNumber:
          optionalString(body.urgentTransferNumber) ?? defaults.urgentTransferNumber,
        businessHoursStart:
          optionalString(body.businessHoursStart) ?? defaults.businessHoursStart,
        businessHoursEnd: optionalString(body.businessHoursEnd) ?? defaults.businessHoursEnd,
        maxCallDurationMin:
          optionalInt(body.maxCallDurationMin, "maxCallDurationMin") ??
          defaults.maxCallDurationMin,
        budgetMonthlyCents:
          optionalInt(body.budgetMonthlyCents, "budgetMonthlyCents") ??
          defaults.budgetMonthlyCents,
        budgetDailyAlertCents:
          optionalInt(body.budgetDailyAlertCents, "budgetDailyAlertCents") ??
          defaults.budgetDailyAlertCents,
        autoApproveBookingsUnderCents:
          optionalInt(
            body.autoApproveBookingsUnderCents,
            "autoApproveBookingsUnderCents",
          ) ?? defaults.autoApproveBookingsUnderCents,
      },
    });

    return json({ config });
  } catch (error) {
    return handleRouteError(error);
  }
}
