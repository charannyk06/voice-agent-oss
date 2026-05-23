import {
  ApiError,
  handleRouteError,
  json,
  optionalDate,
  optionalInt,
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
    const call = await prisma.call.findUnique({
      where: { id_orgId: { id, orgId } },
      include: {
        contact: true,
        actions: {
          orderBy: { createdAt: "asc" },
        },
        appointment: true,
        approval: true,
        costs: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!call) {
      throw new ApiError(404, "Call not found");
    }

    return json({ call });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { orgId } = await requireDashboardUser();
    const { id } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);

    let contactConnect:
      | { connect: { id: string } }
      | { disconnect: true }
      | undefined;

    if ("contactId" in body) {
      const nextContactId =
        body.contactId === null ? null : optionalString(body.contactId);

      if (nextContactId) {
        const contact = await prisma.contact.findUnique({
          where: { id_orgId: { id: nextContactId, orgId } },
          select: { id: true },
        });

        if (!contact) {
          throw new ApiError(400, "Contact not found");
        }

        contactConnect = { connect: { id: nextContactId } };
      } else {
        contactConnect = { disconnect: true };
      }
    }

    const call = await prisma.call.update({
      where: { id_orgId: { id, orgId } },
      data: {
        contact: contactConnect,
        contactName: optionalString(body.contactName),
        phone: optionalString(body.phone),
        direction: optionalString(body.direction),
        status: optionalString(body.status),
        duration: optionalInt(body.duration, "duration"),
        summary:
          "summary" in body && body.summary === null ? null : optionalString(body.summary),
        transcript:
          "transcript" in body && body.transcript === null
            ? null
            : optionalString(body.transcript),
        outcome:
          "outcome" in body && body.outcome === null ? null : optionalString(body.outcome),
        startedAt: optionalDate(body.startedAt, "startedAt"),
        endedAt:
          "endedAt" in body && body.endedAt === null
            ? null
            : optionalDate(body.endedAt, "endedAt"),
      },
      include: {
        actions: true,
        approval: true,
        costs: true,
      },
    });

    return json({ call });
  } catch (error) {
    return handleRouteError(error);
  }
}
