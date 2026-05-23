import {
  ApiError,
  ensureString,
  handleRouteError,
  json,
  optionalBoolean,
  optionalString,
  readJson,
} from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireDashboardUser } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: RouteContext) {
  try {
    const { orgId } = await requireDashboardUser();
    const { id } = await context.params;
    const contact = await prisma.contact.findUnique({
      where: { id_orgId: { id, orgId } },
      include: {
        memories: {
          orderBy: { createdAt: "desc" },
        },
        calls: {
          orderBy: { startedAt: "desc" },
          take: 10,
          include: {
            actions: true,
            approval: true,
            costs: true,
          },
        },
      },
    });

    if (!contact) {
      throw new ApiError(404, "Contact not found");
    }

    return json({ contact });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { orgId } = await requireDashboardUser();
    const { id } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);

    const contact = await prisma.contact.update({
      where: { id_orgId: { id, orgId } },
      data: {
        name: optionalString(body.name),
        phone: optionalString(body.phone),
        email: optionalString(body.email),
        category: optionalString(body.category),
        starred: optionalBoolean(body.starred),
        doNotCall: optionalBoolean(body.doNotCall),
        notes: "notes" in body && body.notes === null ? null : optionalString(body.notes),
      },
    });

    return json({ contact });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  try {
    const { orgId } = await requireDashboardUser();
    const { id } = await context.params;
    await prisma.contact.delete({ where: { id_orgId: { id, orgId } } });
    return json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
