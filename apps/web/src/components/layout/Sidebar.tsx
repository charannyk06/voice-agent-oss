"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Phone,
  Users,
  ShieldCheck,
  DollarSign,
  CreditCard,
  Bot,
  Settings,
  Moon,
  Sun,
  ChevronLeft,
  PhoneIncoming,
  CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { useLayout } from "./LayoutContext";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Appointments", href: "/appointments", icon: CalendarClock },
  { label: "Calls", href: "/calls", icon: Phone },
  { label: "Contacts", href: "/contacts", icon: Users },
  { label: "Approvals", href: "/approvals", icon: ShieldCheck },
  { label: "Costs", href: "/costs", icon: DollarSign },
  { label: "Billing", href: "/billing", icon: CreditCard },
  { label: "Agent", href: "/agent", icon: Bot },
  { label: "Settings", href: "/settings", icon: Settings },
];

type DashboardSummary = {
  activeCalls: number;
  pendingApprovals: number;
};

type AgentConfigSummary = {
  businessName: string;
};

type RuntimeSummary = {
  reachable: boolean;
};

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [businessName, setBusinessName] = useState("Business Dashboard");
  const [dashboard, setDashboard] = useState<DashboardSummary>({ activeCalls: 0, pendingApprovals: 0 });
  const [runtime, setRuntime] = useState<RuntimeSummary>({ reachable: false });
  const { sidebarOpen, closeSidebar } = useLayout();

  useEffect(() => {
    const saved = localStorage.getItem("theme") as "light" | "dark" | null;
    if (saved) {
      setTheme(saved);
      document.documentElement.classList.toggle("dark", saved === "dark");
    } else {
      document.documentElement.classList.add("dark");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSidebarData() {
      try {
        const [configRes, dashboardRes, runtimeRes] = await Promise.all([
          fetch("/api/agent/config", { cache: "no-store" }),
          fetch("/api/dashboard", { cache: "no-store" }),
          fetch("/api/agent/runtime", { cache: "no-store" }),
        ]);

        if (configRes.ok) {
          const data = (await configRes.json()) as { config?: AgentConfigSummary };
          if (!cancelled && data.config?.businessName) {
            setBusinessName(data.config.businessName);
          }
        }

        if (dashboardRes.ok) {
          const data = (await dashboardRes.json()) as Partial<DashboardSummary>;
          if (!cancelled) {
            setDashboard({
              activeCalls: typeof data.activeCalls === "number" ? data.activeCalls : 0,
              pendingApprovals: typeof data.pendingApprovals === "number" ? data.pendingApprovals : 0,
            });
          }
        }

        if (runtimeRes.ok) {
          const data = (await runtimeRes.json()) as RuntimeSummary;
          if (!cancelled) {
            setRuntime({ reachable: Boolean(data.reachable) });
          }
        }
      } catch (error) {
        console.error("Failed to load sidebar data", error);
      }
    }

    void loadSidebarData();
    const interval = window.setInterval(loadSidebarData, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  const getBadgeValue = (href: string) => {
    if (href === "/calls") return dashboard.activeCalls;
    if (href === "/approvals") return dashboard.pendingApprovals;
    return 0;
  };

  const desktopSidebar = (
    <div
      className="hidden md:flex h-full flex-col border-r bg-sidebar-background text-sidebar-foreground transition-all duration-200"
      style={{ width: collapsed ? "4rem" : "15rem" }}
    >
      <div className="flex h-14 items-center justify-between border-b px-4">
        {!collapsed ? (
          <Link href="/dashboard" className="flex items-center gap-2 no-underline text-inherit">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <PhoneIncoming className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-tight">{businessName}</span>
              <span className="text-[10px] text-muted-foreground">Voice Agent</span>
            </div>
          </Link>
        ) : (
          <Link href="/dashboard" className="mx-auto no-underline text-inherit">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <PhoneIncoming className="h-4 w-4" />
            </div>
          </Link>
        )}
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const badgeValue = getBadgeValue(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors no-underline",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                collapsed && "justify-center px-2"
              )}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1">{item.label}</span>
                  {badgeValue > 0 ? (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                      {badgeValue}
                    </span>
                  ) : null}
                </>
              )}
            </Link>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="border-t p-3">
          <div className="rounded-md bg-success/10 border border-success/20 px-3 py-2">
            <div className="flex items-center gap-2">
              <div className={cn("h-2 w-2 rounded-full", runtime.reachable ? "bg-success animate-pulse" : "bg-muted-foreground")} />
              <span className={cn("text-xs font-medium", runtime.reachable ? "text-success" : "text-muted-foreground")}>
                {runtime.reachable ? "Agent runtime reachable" : "Agent runtime offline"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{businessName}</p>
          </div>
        </div>
      )}

      <div className="border-t p-2">
        <div className="flex items-center gap-1">
          {!collapsed && (
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground"
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span className="ml-2">{theme === "dark" ? "Light" : "Dark"}</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-sidebar-foreground/70 hover:text-sidebar-foreground"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4 rotate-180" />}
          </Button>
        </div>
      </div>
    </div>
  );

  const mobileOverlay = sidebarOpen && (
    <div className="md:hidden fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/50 animate-in fade-in duration-200" onClick={closeSidebar} />
      <div className="fixed left-0 top-0 h-full w-64 bg-sidebar-background text-sidebar-foreground flex flex-col animate-in slide-in-from-left duration-200">
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Link href="/dashboard" className="flex items-center gap-2 no-underline text-inherit" onClick={closeSidebar}>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <PhoneIncoming className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-tight">{businessName}</span>
              <span className="text-[10px] text-muted-foreground">Voice Agent</span>
            </div>
          </Link>
          <Button variant="ghost" size="icon-sm" onClick={closeSidebar}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 space-y-1 p-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            const badgeValue = getBadgeValue(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeSidebar}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors no-underline",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                {badgeValue > 0 ? (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {badgeValue}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="border-t p-3">
          <div className="rounded-md bg-success/10 border border-success/20 px-3 py-2">
            <div className="flex items-center gap-2">
              <div className={cn("h-2 w-2 rounded-full", runtime.reachable ? "bg-success animate-pulse" : "bg-muted-foreground")} />
              <span className={cn("text-xs font-medium", runtime.reachable ? "text-success" : "text-muted-foreground")}>
                {runtime.reachable ? "Agent runtime reachable" : "Agent runtime offline"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{businessName}</p>
          </div>
        </div>

        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground"
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            <span className="ml-2">{theme === "dark" ? "Light" : "Dark"}</span>
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {desktopSidebar}
      {mobileOverlay}
    </>
  );
}
