import {
  ensureString,
  handleRouteError,
  json,
  optionalString,
  readJson,
} from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireDashboardUser } from "@/lib/auth";

export async function GET() {
  try {
    const { orgId } = await requireDashboardUser();
    const docs = await prisma.knowledgeDoc.findMany({
      where: { orgId },
      orderBy: [{ name: "asc" }],
    });

    return json({ docs });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { orgId } = await requireDashboardUser();
    const body = await readJson<Record<string, unknown>>(request);
    const name = ensureString(body.name, "name");
    const content = optionalString(body.content) ?? "";
    const mimeType = optionalString(body.mimeType) ?? "text/markdown";

    const doc = await prisma.knowledgeDoc.create({
      data: {
        orgId,
        name,
        content,
        mimeType,
        size: Buffer.byteLength(content, "utf8"),
      },
    });

    return json({ doc }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
