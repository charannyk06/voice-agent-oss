import { ApiError, handleRouteError, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireDashboardUser } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(_: Request, context: RouteContext) {
  try {
    const { orgId } = await requireDashboardUser();
    const { id } = await context.params;
    const existing = await prisma.approval.findUnique({
      where: { id_orgId: { id, orgId } },
      select: { id: true },
    });

    if (!existing) {
      throw new ApiError(404, "Approval not found");
    }

    const approval = await prisma.approval.update({
      where: { id_orgId: { id, orgId } },
      data: {
        status: "denied",
        resolvedAt: new Date(),
      },
    });

    return json({ approval });
  } catch (error) {
    return handleRouteError(error);
  }
}
