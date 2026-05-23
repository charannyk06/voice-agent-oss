import { handleRouteError, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireDashboardUser } from "@/lib/auth";

export async function GET() {
  try {
    const { orgId } = await requireDashboardUser();
    const rules = await prisma.autoApproveRule.findMany({
      where: { orgId },
      orderBy: { createdAt: "asc" },
    });
    return json({ rules });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { orgId } = await requireDashboardUser();
    const body = await request.json();
    const { id, enabled } = body as { id: string; enabled: boolean };
    const rule = await prisma.autoApproveRule.update({
      where: { id_orgId: { id, orgId } },
      data: { enabled },
    });
    return json({ rule });
  } catch (error) {
    return handleRouteError(error);
  }
}
