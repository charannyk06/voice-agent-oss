import { prisma } from "@/lib/prisma";
import { getMonthRange, getTodayRange, handleRouteError, json } from "@/lib/api";
import { requireDashboardUser } from "@/lib/auth";

export async function GET() {
  try {
    const { orgId } = await requireDashboardUser();
    const { start: monthStart, end: monthEnd } = getMonthRange();
    const { start: todayStart, end: todayEnd } = getTodayRange();

    const [activeCalls, todayCalls, pendingApprovals, monthlyCosts, agentConfig] =
      await prisma.$transaction([
        prisma.call.count({ where: { orgId, status: "active" } }),
        prisma.call.count({
          where: {
            orgId,
            startedAt: {
              gte: todayStart,
              lt: todayEnd,
            },
          },
        }),
        prisma.approval.count({ where: { orgId, status: "pending" } }),
        prisma.costEntry.aggregate({
          _sum: { amountCents: true },
          where: {
            orgId,
            createdAt: {
              gte: monthStart,
              lt: monthEnd,
            },
          },
        }),
        prisma.agentConfig.findUnique({ where: { id: orgId } }),
      ]);

    return json({
      activeCalls,
      todayCalls,
      pendingApprovals,
      monthSpendCents: monthlyCosts._sum.amountCents ?? 0,
      businessName: agentConfig?.businessName ?? "Example Business",
      businessLocation:
        agentConfig?.businessLocation ??
        "123 Main Street, Example City",
      receptionNumber: agentConfig?.receptionNumber ?? "+15551234567",
      agent: {
        status: "configured",
        name: agentConfig?.name ?? "Reception Desk",
        voice: agentConfig?.voice ?? "v1",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
