import {
  ApiError,
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

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { orgId } = await requireDashboardUser();
    const { id } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);

    const doc = await prisma.knowledgeDoc.update({
      where: { id_orgId: { id, orgId } },
      data: {
        name: optionalString(body.name),
        content: optionalString(body.content),
        mimeType: optionalString(body.mimeType),
        size:
          typeof body.content === "string"
            ? Buffer.byteLength(body.content, "utf8")
            : undefined,
      },
    });

    return json({ doc });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { orgId } = await requireDashboardUser();
    const { id } = await context.params;
    const existing = await prisma.knowledgeDoc.findUnique({ where: { id_orgId: { id, orgId } } });
    if (!existing) {
      throw new ApiError(404, "Knowledge doc not found");
    }

    await prisma.knowledgeDoc.delete({ where: { id_orgId: { id, orgId } } });
    return json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
