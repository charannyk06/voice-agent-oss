import { Pool } from 'pg';
import { isPostgresDatabaseUrl } from './prisma';

export interface HostedBillingSnapshot {
  subscriptionStatus: string;
  monthlyQuotaSeconds: number;
  usedSecondsThisPeriod: number;
}

let pool: Pool | undefined;
let poolUrl: string | undefined;

export function getHostedBillingDatabaseUrl(env = process.env): string | undefined {
  const explicitUrl = env.HOSTED_BILLING_DATABASE_URL;
  if (isPostgresDatabaseUrl(explicitUrl)) return explicitUrl;

  const databaseUrl = env.DATABASE_URL;
  if (isPostgresDatabaseUrl(databaseUrl)) return databaseUrl;

  return undefined;
}

function getPool(url: string): Pool {
  if (pool && poolUrl === url) return pool;

  pool?.end().catch(() => undefined);
  poolUrl = url;
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    max: 2,
  });
  return pool;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function getHostedBillingSnapshotFromPostgres(
  orgId: string,
): Promise<HostedBillingSnapshot | undefined> {
  const url = getHostedBillingDatabaseUrl();
  if (!url) return undefined;

  const client = getPool(url);
  const orgResult = await client.query<{
    subscriptionStatus: string | null;
    minuteQuotaMonthly: number | string | null;
    billingStatus: string | null;
    currentPeriodStart: Date | string | null;
    currentPeriodEnd: Date | string | null;
  }>(
    `
      SELECT
        o."subscriptionStatus" AS "subscriptionStatus",
        o."minuteQuotaMonthly" AS "minuteQuotaMonthly",
        s."status" AS "billingStatus",
        s."currentPeriodStart" AS "currentPeriodStart",
        s."currentPeriodEnd" AS "currentPeriodEnd"
      FROM "Organization" o
      LEFT JOIN LATERAL (
        SELECT "status", "currentPeriodStart", "currentPeriodEnd"
        FROM "BillingSubscription"
        WHERE "orgId" = o."id"
          AND "status" IN ('active', 'trialing')
        ORDER BY "currentPeriodEnd" DESC NULLS LAST
        LIMIT 1
      ) s ON true
      WHERE o."id" = $1
      LIMIT 1
    `,
    [orgId],
  );

  const org = orgResult.rows[0];
  if (!org) {
    return {
      subscriptionStatus: 'inactive',
      monthlyQuotaSeconds: 0,
      usedSecondsThisPeriod: 0,
    };
  }

  const where: string[] = ['"orgId" = $1', '"kind" = $2'];
  const values: unknown[] = [orgId, 'voice_seconds'];
  if (org.currentPeriodStart) {
    values.push(org.currentPeriodStart);
    where.push(`"createdAt" >= $${values.length}`);
  }
  if (org.currentPeriodEnd) {
    values.push(org.currentPeriodEnd);
    where.push(`"createdAt" < $${values.length}`);
  }

  const usageResult = await client.query<{ usedSeconds: string | number | null }>(
    `
      SELECT COALESCE(SUM("quantity"), 0) AS "usedSeconds"
      FROM "UsageEvent"
      WHERE ${where.join(' AND ')}
    `,
    values,
  );

  return {
    subscriptionStatus: org.billingStatus ?? org.subscriptionStatus ?? 'inactive',
    monthlyQuotaSeconds: toNumber(org.minuteQuotaMonthly) * 60,
    usedSecondsThisPeriod: toNumber(usageResult.rows[0]?.usedSeconds),
  };
}
