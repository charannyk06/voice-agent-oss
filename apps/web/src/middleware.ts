import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getClerkConfigStatus } from "./lib/auth-config";
import { isAllowedMutationOrigin } from "./lib/request-security";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/agent/health(.*)",
  "/api/billing/webhook",
  "/api/billing/usage",
]);

const securedMiddleware = clerkMiddleware(
  async (auth, request) => {
    if (!isPublicRoute(request)) {
      if (!isAllowedMutationOrigin({
        method: request.method,
        requestOrigin: request.nextUrl.origin,
        originHeader: request.headers.get("origin"),
        refererHeader: request.headers.get("referer"),
      })) {
        return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
      }

      await auth.protect();
    }
  },
  {
    frontendApiProxy: {
      enabled: true,
      path: "/__clerk",
    },
  },
);

export default function middleware(...args: Parameters<typeof securedMiddleware>) {
  const request = args[0];
  const clerkConfig = getClerkConfigStatus();
  if (!clerkConfig.configured) {
    if (isPublicRoute(request)) {
      return NextResponse.next();
    }

    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication is not configured" }, { status: 503 });
    }

    return NextResponse.redirect(new URL("/sign-in?setup=missing-clerk", request.url));
  }

  return securedMiddleware(...args);
}

export const config = {
  matcher: [
    // Always run Clerk's Frontend API proxy, including .js assets under /__clerk.
    "/__clerk(.*)",
    // Skip Next.js internals and all static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
