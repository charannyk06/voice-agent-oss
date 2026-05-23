import { ApiError, handleRouteError, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireDashboardUser } from "@/lib/auth";

function requestObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "Invalid appointment request body");
  }
  return value as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `${field} is required`);
  }
  return value.trim();
}

function optionalString(body: Record<string, unknown>, field: string, fallback?: string): string | null {
  const value = body[field];
  if (value === undefined) return fallback ?? null;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError(400, `${field} must be a string`);
  }
  return value.trim() || fallback || null;
}

function optionalContactId(body: Record<string, unknown>): string | null {
  const value = body.contactId;
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "contactId must be a string");
  }
  return value.trim();
}

async function assertContactBelongsToOrg(orgId: string, contactId: string | null): Promise<void> {
  if (!contactId) return;
  const contact = await prisma.contact.findUnique({
    where: { id_orgId: { id: contactId, orgId } },
    select: { id: true },
  });
  if (!contact) {
    throw new ApiError(400, "contactId does not belong to this workspace");
  }
}

export async function GET(request: Request) {
  try {
    const { orgId } = await requireDashboardUser();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const date = searchParams.get("date");

    const where: Record<string, unknown> = { orgId };
    if (status && status !== "all") where.status = status;
    if (date) where.date = date;

    const rows = await prisma.appointment.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    const contactIds = Array.from(new Set(rows.map((row) => row.contactId).filter(Boolean))) as string[];
    const contacts = contactIds.length
      ? await prisma.contact.findMany({
          where: { orgId, id: { in: contactIds } },
          select: { id: true, name: true, phone: true },
        })
      : [];
    const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
    const appointments = rows.map((appointment) => ({
      ...appointment,
      contact: appointment.contactId ? contactsById.get(appointment.contactId) ?? null : null,
    }));

    const today = new Date().toISOString().split("T")[0];
    const summary = {
      total: await prisma.appointment.count({ where: { orgId } }),
      confirmed: await prisma.appointment.count({ where: { orgId, status: "confirmed" } }),
      rescheduled: await prisma.appointment.count({ where: { orgId, status: "rescheduled" } }),
      cancelled: await prisma.appointment.count({ where: { orgId, status: "cancelled" } }),
      completed: await prisma.appointment.count({ where: { orgId, status: "completed" } }),
      today: await prisma.appointment.count({ where: { orgId, date: today } }),
    };

    return json({ appointments, summary });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { orgId } = await requireDashboardUser();
    const body = requestObject(await request.json());
    const contactId = optionalContactId(body);
    await assertContactBelongsToOrg(orgId, contactId);

    const appointment = await prisma.appointment.create({
      data: {
        orgId,
        customerName: requiredString(body, "customerName"),
        phone: requiredString(body, "phone"),
        service: optionalString(body, "service", "General Service") ?? "General Service",
        staffMember: optionalString(body, "staffMember"),
        date: requiredString(body, "date"),
        time: requiredString(body, "time"),
        reason: optionalString(body, "reason", "Manual booking") ?? "Manual booking",
        status: "confirmed",
        source: "dashboard",
        notes: optionalString(body, "notes"),
        contactId,
      },
    });
    return json({ appointment }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
