import {
  ApiError,
  ensureString,
  handleRouteError,
  json,
  optionalString,
  readJson,
} from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireDashboardUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const { orgId } = await requireDashboardUser();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const approvals = await prisma.approval.findMany({
      where: { orgId, ...(status ? { status } : {}) },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        call: {
          select: {
            id: true,
            contactName: true,
            phone: true,
            summary: true,
            startedAt: true,
          },
        },
      },
    });

    return json({ approvals });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { orgId } = await requireDashboardUser();
    const body = await readJson<Record<string, unknown>>(request);
    const callId = optionalString(body.callId);

    if (callId) {
      const call = await prisma.call.findUnique({
        where: { id_orgId: { id: callId, orgId } },
        select: { id: true },
      });

      if (!call) {
        throw new ApiError(400, "Call not found");
      }
    }

    const approval = await prisma.approval.create({
      data: {
        orgId,
        call: callId ? { connect: { id: callId } } : undefined,
        type: ensureString(body.type, "type"),
        title: ensureString(body.title, "title"),
        description:
          "description" in body && body.description === null
            ? null
            : optionalString(body.description),
        risk: optionalString(body.risk) ?? "low",
        status: optionalString(body.status) ?? "pending",
        contact:
          "contact" in body && body.contact === null ? null : optionalString(body.contact),
        phone: "phone" in body && body.phone === null ? null : optionalString(body.phone),
        callContext:
          "callContext" in body && body.callContext === null
            ? null
            : optionalString(body.callContext),
      },
      include: {
        call: true,
      },
    });

    return json({ approval }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
