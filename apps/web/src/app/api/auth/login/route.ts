import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Returns the current Clerk auth status.
 * Used by the dashboard to verify the session is valid.
 */
export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({ authenticated: true, userId });
}
