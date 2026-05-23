import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function ensureString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `${fieldName} is required`);
  }

  return value.trim();
}

export function optionalString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

export function optionalInt(value: unknown, fieldName: string) {
  if (value === undefined) {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ApiError(400, `${fieldName} must be an integer`);
  }

  return parsed;
}

export function optionalNumber(value: unknown, fieldName: string) {
  if (value === undefined) {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(400, `${fieldName} must be a number`);
  }

  return parsed;
}

export function optionalDate(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, `${fieldName} must be a valid date`);
  }

  return parsed;
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
}

export function getMonthRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { start, end };
}

export function getTodayRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return { start, end };
}

export function handleRouteError(error: unknown) {
  if (error instanceof ApiError) {
    return json({ error: error.message }, error.status);
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return json({ error: "A record with that value already exists" }, 400);
    }

    if (error.code === "P2025") {
      return json({ error: "Resource not found" }, 404);
    }
  }

  console.error(error);
  return json({ error: "Internal server error" }, 500);
}
