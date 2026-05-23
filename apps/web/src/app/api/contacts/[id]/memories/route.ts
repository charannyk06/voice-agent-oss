import {
  ApiError,
  ensureString,
  handleRouteError,
  json,
  optionalString,
  readJson,
} from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireDashboardUser } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { orgId } = await requireDashboardUser();
    const { id } = await context.params;
    const contact = await prisma.contact.findUnique({
      where: { id_orgId: { id, orgId } },
      select: { id: true },
    });

    if (!contact) {
      throw new ApiError(404, "Contact not found");
    }

    const body = await readJson<Record<string, unknown>>(request);
    const memory = await prisma.memory.create({
      data: {
        contactId: id,
        text: ensureString(body.text, "text"),
        source: optionalString(body.source) ?? "manual",
      },
    });

    return json({ memory }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
