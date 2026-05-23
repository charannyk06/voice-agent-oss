"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Search, Bell, Menu } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { useClerkEnabled } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLayout } from "./LayoutContext";

const pathLabels: Record<string, string> = {
  dashboard: "Dashboard",
  appointments: "Appointments",
  calls: "Calls",
  contacts: "Contacts",
  approvals: "Approvals",
  costs: "Costs",
  agent: "Agent Config",
  settings: "Settings",
};

export function Header() {
  const pathname = usePathname();
  const { openSidebar } = useLayout();
  const segments = pathname.split("/").filter(Boolean);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const canRenderClerkUser = useClerkEnabled();

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      try {
        const response = await fetch("/api/dashboard", { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as { pendingApprovals?: number };
        if (!cancelled) {
          setPendingApprovals(typeof data.pendingApprovals === "number" ? data.pendingApprovals : 0);
        }
      } catch (error) {
        console.error("Failed to load header summary", error);
      }
    }

    void loadSummary();
    const interval = window.setInterval(loadSummary, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <header className="flex h-14 items-center justify-between gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={openSidebar}>
          <Menu className="h-5 w-5" />
        </Button>

        <nav className="flex items-center gap-1 text-sm">
          <Link href="/dashboard" className="text-muted-foreground hover:text-foreground no-underline">
            Home
          </Link>
          {segments.map((seg, i) => {
            const href = "/" + segments.slice(0, i + 1).join("/");
            const label = pathLabels[seg] || seg;
            const isLast = i === segments.length - 1;
            return (
              <span key={href} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                {isLast ? (
                  <span className="font-medium text-foreground">{label}</span>
                ) : (
                  <Link href={href} className="text-muted-foreground hover:text-foreground no-underline">
                    {label}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative hidden sm:block">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search calls, contacts..." className="h-8 w-60 pl-8 text-sm" />
        </div>
        <Button variant="ghost" size="icon-sm" className="relative" title="Pending approvals">
          <Bell className="h-4 w-4" />
          {pendingApprovals > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
              {pendingApprovals}
            </span>
          ) : null}
        </Button>
        {canRenderClerkUser ? (
          <UserButton
            appearance={{
              elements: {
                avatarBox: "h-8 w-8",
              },
            }}
          />
        ) : (
          <Link
            href="/sign-in"
            className="rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground no-underline hover:text-foreground"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
