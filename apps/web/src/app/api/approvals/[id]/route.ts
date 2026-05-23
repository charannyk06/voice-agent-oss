import { handleRouteError, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireDashboardUser } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId } = await requireDashboardUser();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const approval = await prisma.approval.update({
      where: { id_orgId: { id, orgId } },
      data: {
        status: body.status ?? "approved",
        resolvedAt: new Date(),
      },
    });

    return json({ approval });
  } catch (error) {
    return handleRouteError(error);
  }
}
