import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { getClerkConfigStatus } from "@/lib/auth-config";

export const metadata: Metadata = {
  title: "Voice Agent OSS Dashboard",
  description: "Open-source voice agent operations dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const clerkConfig = getClerkConfigStatus();

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ErrorBoundary>
          <Providers
            clerkEnabled={clerkConfig.configured}
            clerkPublishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
          >
            {children}
          </Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}
