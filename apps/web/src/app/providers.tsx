"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider } from "@clerk/nextjs";
import type { NextClerkProviderProps } from "@clerk/nextjs/types";
import { dark } from "@clerk/themes";
import { createContext, useContext, useState, useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

const APP_NAME = "Voice Agent OSS";
const explicitClerkProxyUrl = process.env.NEXT_PUBLIC_CLERK_PROXY_URL?.trim();

const clerkLocalization: NextClerkProviderProps["localization"] = {
  signIn: {
    start: {
      title: `Sign in to ${APP_NAME}`,
      titleCombined: `Sign in to ${APP_NAME}`,
      subtitle: "Welcome back. Continue to your voice agent dashboard.",
      subtitleCombined: "Welcome back. Continue to your voice agent dashboard.",
    },
  },
  signUp: {
    start: {
      title: `Create your ${APP_NAME} account`,
      titleCombined: `Create your ${APP_NAME} account`,
      subtitle: "Set up access to your voice agent dashboard.",
      subtitleCombined: "Set up access to your voice agent dashboard.",
    },
  },
};

const ClerkEnabledContext = createContext(false);

function getClerkFrontendApiProxyUrl(publishableKey?: string) {
  if (!publishableKey) {
    return undefined;
  }

  const encodedFrontendApi = publishableKey.replace(/^pk_(?:test|live)_/, "");
  if (encodedFrontendApi === publishableKey) {
    return undefined;
  }

  try {
    const decoded = globalThis
      .atob(encodedFrontendApi.replace(/-/g, "+").replace(/_/g, "/"))
      .replace(/\$$/, "");

    if (!/^[a-z0-9.-]+$/i.test(decoded) || decoded.includes("..")) {
      return undefined;
    }

    return `https://${decoded}`;
  } catch {
    return undefined;
  }
}

export function useClerkEnabled() {
  return useContext(ClerkEnabledContext);
}

export function Providers({
  children,
  clerkEnabled,
  clerkPublishableKey,
}: {
  children: React.ReactNode;
  clerkEnabled: boolean;
  clerkPublishableKey?: string;
}) {
  const [queryClient] = useState(() => new QueryClient());
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("theme") as "light" | "dark" | null;
    const dark = saved ? saved === "dark" : true;
    setIsDark(dark);
    document.documentElement.classList.toggle("dark", dark);
  }, []);

  const content = (
    <ClerkEnabledContext.Provider value={clerkEnabled}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </ClerkEnabledContext.Provider>
  );

  const clerkProxyUrl = explicitClerkProxyUrl || getClerkFrontendApiProxyUrl(clerkPublishableKey);

  if (!clerkEnabled || !clerkPublishableKey) {
    return content;
  }

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      proxyUrl={clerkProxyUrl}
      localization={clerkLocalization}
      appearance={{ baseTheme: isDark ? dark : undefined }}
    >
      {content}
    </ClerkProvider>
  );
}
