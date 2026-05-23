import { getMonthRange, handleRouteError, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireDashboardUser } from "@/lib/auth";

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function GET() {
  try {
    const { orgId } = await requireDashboardUser();
    const { start, end } = getMonthRange();
    const [entries, agentConfig] = await prisma.$transaction([
      prisma.costEntry.findMany({
        where: {
          orgId,
          createdAt: {
            gte: start,
            lt: end,
          },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.agentConfig.findUnique({ where: { id: orgId } }),
    ]);

    const dailyMap = new Map<
      string,
      { date: string; amountCents: number; minutes: number; entries: number }
    >();
    const providerMap = new Map<
      string,
      { provider: string; amountCents: number; minutes: number; entries: number }
    >();

    let monthSpendCents = 0;
    let monthMinutes = 0;

    for (const entry of entries) {
      monthSpendCents += entry.amountCents;
      monthMinutes += entry.minutes;

      const day = dateKey(entry.createdAt);
      const daily = dailyMap.get(day) ?? {
        date: day,
        amountCents: 0,
        minutes: 0,
        entries: 0,
      };
      daily.amountCents += entry.amountCents;
      daily.minutes += entry.minutes;
      daily.entries += 1;
      dailyMap.set(day, daily);

      const provider = providerMap.get(entry.provider) ?? {
        provider: entry.provider,
        amountCents: 0,
        minutes: 0,
        entries: 0,
      };
      provider.amountCents += entry.amountCents;
      provider.minutes += entry.minutes;
      provider.entries += 1;
      providerMap.set(entry.provider, provider);
    }

    return json({
      summary: {
        monthSpendCents,
        monthMinutes,
        entryCount: entries.length,
        budgetMonthlyCents: agentConfig?.budgetMonthlyCents ?? null,
        budgetDailyAlertCents: agentConfig?.budgetDailyAlertCents ?? null,
      },
      dailyBreakdown: Array.from(dailyMap.values()).sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
      providerCosts: Array.from(providerMap.values()).sort(
        (a, b) => b.amountCents - a.amountCents,
      ),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
