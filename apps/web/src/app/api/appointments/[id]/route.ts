import type { Prisma } from "@prisma/client";
import { ApiError, handleRouteError, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireDashboardUser } from "@/lib/auth";

function notFound(label: string) {
  return Response.json({ error: `${label} not found` }, { status: 404 });
}

function requestObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "Invalid appointment request body");
  }
  return value as Record<string, unknown>;
}

function optionalStringUpdate(body: Record<string, unknown>, field: string, allowNull = false): string | null | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (value === null) {
    if (allowNull) return null;
    throw new ApiError(400, `${field} must be a string`);
  }
  if (typeof value !== "string") {
    throw new ApiError(400, `${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed && !allowNull) {
    throw new ApiError(400, `${field} is required`);
  }
  return trimmed || null;
}

function optionalContactUpdate(body: Record<string, unknown>): string | null | undefined {
  if (!("contactId" in body)) return undefined;
  const value = body.contactId;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "contactId must be a string");
  }
  return value.trim();
}

async function assertContactBelongsToOrg(orgId: string, contactId: string | null | undefined): Promise<void> {
  if (!contactId) return;
  const contact = await prisma.contact.findUnique({
    where: { id_orgId: { id: contactId, orgId } },
    select: { id: true },
  });
  if (!contact) {
    throw new ApiError(400, "contactId does not belong to this workspace");
  }
}

function buildAppointmentUpdate(body: Record<string, unknown>) {
  const data: {
    customerName?: string | null;
    phone?: string | null;
    service?: string | null;
    staffMember?: string | null;
    date?: string | null;
    time?: string | null;
    reason?: string | null;
    status?: string | null;
    notes?: string | null;
    contactId?: string | null;
  } = {};

  const nullableFields = new Set(["staffMember", "notes"]);
  for (const field of [
    "customerName",
    "phone",
    "service",
    "staffMember",
    "date",
    "time",
    "reason",
    "status",
    "notes",
  ] as const) {
    const value = optionalStringUpdate(body, field, nullableFields.has(field));
    if (value !== undefined) data[field] = value;
  }

  const contactId = optionalContactUpdate(body);
  if (contactId !== undefined) data.contactId = contactId;

  if (Object.keys(data).length === 0) {
    throw new ApiError(400, "No supported appointment fields provided");
  }

  return data;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId } = await requireDashboardUser();
    const { id } = await params;
    const appt = await prisma.appointment.findUnique({
      where: { id_orgId: { id, orgId } },
    });
    if (!appt) return notFound("Appointment");

    const [contact, call] = await Promise.all([
      appt.contactId
        ? prisma.contact.findUnique({
            where: { id_orgId: { id: appt.contactId, orgId } },
            select: { id: true, name: true, phone: true, email: true, category: true },
          })
        : null,
      appt.callId
        ? prisma.call.findUnique({
            where: { id_orgId: { id: appt.callId, orgId } },
            select: { id: true, contactName: true, phone: true, direction: true, status: true, startedAt: true, endedAt: true },
          })
        : null,
    ]);

    return json({ appointment: { ...appt, contact, call } });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId } = await requireDashboardUser();
    const { id } = await params;
    const body = requestObject(await request.json());
    const data = buildAppointmentUpdate(body);
    await assertContactBelongsToOrg(orgId, data.contactId);

    const updated = await prisma.appointment.update({
      where: { id_orgId: { id, orgId } },
      data: data as Prisma.AppointmentUncheckedUpdateInput,
    });
    return json({ appointment: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId } = await requireDashboardUser();
    const { id } = await params;
    await prisma.appointment.delete({ where: { id_orgId: { id, orgId } } });
    return json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
