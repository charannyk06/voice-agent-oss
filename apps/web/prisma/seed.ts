import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://localhost:5432/voice_agent";

if (databaseUrl.startsWith("file:")) {
  throw new Error("SQLite DATABASE_URL is no longer supported. Use a Postgres DATABASE_URL before running the seed script.");
}

const adapter = new PrismaPg(new Pool({ connectionString: databaseUrl, max: 5 }));
const prisma = new PrismaClient({ adapter });

const toolSeeds = [
  {
    key: "appointment-booking",
    name: "Appointment Booking",
    description: "Book and confirm service appointments.",
    enabled: true,
  },
  {
    key: "appointment-rescheduling",
    name: "Appointment Changes",
    description: "Reschedule or cancel existing appointments.",
    enabled: true,
  },
  {
    key: "follow-up-workflows",
    name: "Follow-up Workflows",
    description: "Schedule callbacks and follow-up tasks.",
    enabled: true,
  },
  {
    key: "contact-lookup",
    name: "Contact Lookup",
    description: "Look up known customers by phone and caller history.",
    enabled: true,
  },
  {
    key: "people-memory-search",
    name: "People Memory Search",
    description: "Search caller notes, memories, and known people by name, phone, or topic.",
    enabled: true,
  },
  {
    key: "recent-call-history",
    name: "Recent Call History",
    description: "Summarize recent calls, outcomes, and appointments for a caller.",
    enabled: true,
  },
  {
    key: "service-directory",
    name: "Service Directory",
    description: "Look up services, policies, escalation paths, and saved front-desk details.",
    enabled: true,
  },
  {
    key: "callback-capture",
    name: "Callback Capture",
    description: "Capture unresolved questions for staff callback with preferred timing.",
    enabled: true,
  },
  {
    key: "business-knowledge",
    name: "Business Knowledge",
    description: "Answer service and policy questions from knowledge docs.",
    enabled: true,
  },
  {
    key: "external-knowledge-search",
    name: "External Knowledge Search",
    description: "Search public, non-professional information when an external search provider is configured.",
    enabled: false,
  },
  {
    key: "sms-notifications",
    name: "SMS Notifications",
    description: "Send confirmations, reminders, and callback texts.",
    enabled: true,
  },
  {
    key: "human-transfer",
    name: "Human Transfer",
    description: "Escalate urgent and unresolved cases to a team member.",
    enabled: true,
  },
  {
    key: "marketing-outreach",
    name: "Marketing Outreach",
    description: "Track campaign interest and do-not-call preferences.",
    enabled: true,
  },
];

async function main() {
  const orgId = process.env.SEED_ORG_ID || "default";

  // Only seed system-level config. No fake contacts, calls, or approvals.
  // Real data comes from real calls made through the voice agent.

  // Upsert generic agent config with safe local defaults
  await prisma.agentConfig.upsert({
    where: { id: orgId },
    update: {},
    create: {
      id: orgId,
      name: "Demo Agent",
      voice: "v1",
      languageCode: "en-US",
      businessName: "Example Business",
      businessLocation: "123 Main Street, Example City",
      receptionNumber: "+15551234567",
      urgentTransferNumber: "+15551234567",
      instructions: `You are the live voice receptionist for Example Business, Example City.
Handle appointment booking, rescheduling, follow-up calls, and front-desk conversations.
Start with: "Hello, this is Example Business. How can I help you today?"
Never provide regulated professional advice unless approved business knowledge explicitly covers it. Transfer urgent and uncertain questions to a team member immediately.`,
      businessHoursStart: "08:00",
      businessHoursEnd: "21:00",
      maxCallDurationMin: 15,
      budgetMonthlyCents: 70000,
      budgetDailyAlertCents: 3000,
      autoApproveBookingsUnderCents: 5000,
    },
  });

  // Upsert tool configs
  for (const tool of toolSeeds) {
    await prisma.agentToolConfig.upsert({
      where: { orgId_key: { orgId, key: tool.key } },
      update: {},
      create: { ...tool, orgId },
    });
  }

  // Upsert auto-approve rules
  const rules = [
    { name: "booking_under_amount", condition: "5000", enabled: true },
    { name: "spam_block", condition: "always", enabled: true },
  ];
  for (const rule of rules) {
    const existing = await prisma.autoApproveRule.findFirst({
      where: { orgId, name: rule.name },
    });
    if (!existing) {
      await prisma.autoApproveRule.create({ data: { ...rule, orgId } });
    }
  }

  console.log("Seed complete: system config only, no dummy data.");
}

main()
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
