import {
  ApiError,
  ensureString,
  handleRouteError,
  json,
  optionalDate,
  optionalInt,
  optionalString,
  readJson,
} from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireDashboardUser } from "@/lib/auth";

function parseActions(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((action, index) => {
    if (!action || typeof action !== "object") {
      throw new ApiError(400, `actions[${index}] must be an object`);
    }

    const actionRecord = action as Record<string, unknown>;
    return {
      type: ensureString(actionRecord.type, `actions[${index}].type`),
      description: ensureString(
        actionRecord.description,
        `actions[${index}].description`,
      ),
    };
  });
}

export async function GET(request: Request) {
  try {
    const { orgId } = await requireDashboardUser();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const limitParam = searchParams.get("limit");
    const take = limitParam ? optionalInt(limitParam, "limit") : undefined;

    const calls = await prisma.call.findMany({
      where: { orgId, ...(status ? { status } : {}) },
      orderBy: { startedAt: "desc" },
      take: take ?? undefined,
      include: {
        contact: true,
        approval: true,
        actions: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            type: true,
            description: true,
          },
        },
        _count: {
          select: {
            actions: true,
            costs: true,
          },
        },
      },
    });

    return json({
      calls: calls.map(({ _count, actions, ...call }) => ({
        ...call,
        actions: actions ?? [],
        actionCount: _count.actions,
        costEntryCount: _count.costs,
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
    const direction = ensureString(body.direction, "direction");
    const contactId = optionalString(body.contactId);
    const actions = parseActions(body.actions);

    const contact = contactId
      ? await prisma.contact.findUnique({
          where: { id_orgId: { id: contactId, orgId } },
          select: { id: true, name: true, phone: true },
        })
      : null;

    if (contactId && !contact) {
      throw new ApiError(400, "Contact not found");
    }

    const contactName = optionalString(body.contactName) ?? contact?.name;
    const phone = optionalString(body.phone) ?? contact?.phone;

    if (!contactName) {
      throw new ApiError(400, "contactName is required");
    }

    if (!phone) {
      throw new ApiError(400, "phone is required");
    }

    const call = await prisma.call.create({
      data: {
        orgId,
        contact: contact ? { connect: { id: contact.id } } : undefined,
        contactName,
        phone,
        direction,
        status: optionalString(body.status) ?? "completed",
        duration: optionalInt(body.duration, "duration") ?? 0,
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
        actions: actions.length
          ? {
              create: actions,
            }
          : undefined,
      },
      include: {
        actions: true,
      },
    });

    return json({ call }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
