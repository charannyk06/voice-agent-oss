import { handleRouteError, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireDashboardUser } from "@/lib/auth";

export async function GET() {
  try {
    const { orgId } = await requireDashboardUser();
    const calls = await prisma.call.findMany({
      where: { orgId, status: "active" },
      orderBy: { startedAt: "desc" },
      include: {
        contact: true,
        actions: true,
        approval: true,
      },
    });

    return json({ calls });
  } catch (error) {
    return handleRouteError(error);
  }
}
