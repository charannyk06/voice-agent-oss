import {
  ensureString,
  handleRouteError,
  json,
  optionalBoolean,
  optionalString,
  readJson,
} from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireDashboardUser } from "@/lib/auth";

export async function GET() {
  try {
    const { orgId } = await requireDashboardUser();
    const contacts = await prisma.contact.findMany({
      where: { orgId },
      orderBy: [{ starred: "desc" }, { name: "asc" }],
      include: {
        _count: {
          select: {
            memories: true,
          },
        },
      },
    });

    return json({
      contacts: contacts.map(({ _count, ...contact }) => ({
        ...contact,
        memoryCount: _count.memories,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { orgId } = await requireDashboardUser();
    const body = await readJson<Record<string, unknown>>(request);
    const contact = await prisma.contact.create({
      data: {
        orgId,
        name: ensureString(body.name, "name"),
        phone: ensureString(body.phone, "phone"),
        email: optionalString(body.email),
        category: optionalString(body.category) ?? "general",
        starred: optionalBoolean(body.starred) ?? false,
        doNotCall: optionalBoolean(body.doNotCall) ?? false,
        notes: optionalString(body.notes),
      },
    });

    return json({ contact }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
