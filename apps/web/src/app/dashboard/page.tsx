"use client";

import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  normalizeDashboardData,
  normalizePendingApprovalSummary,
  normalizeRecentCall,
} from "@/lib/normalize";
import { cn, formatCents, timeAgo, formatDuration, formatPhone, initials } from "@/lib/utils";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  CircleDot,
  DollarSign,
  ShieldCheck,
  Users,
  Clock,
  TrendingUp,
  ArrowRight,
  Bot,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Pause,
  Mic,
  MicOff,
  Volume2,
  Loader2,
} from "lucide-react";
import { useWebSocket, type CallSession } from "@/lib/websocket";

interface DashboardData {
  activeCalls: number;
  todayCalls: number;
  pendingApprovals: number;
  monthSpendCents: number;
  businessName: string;
  businessLocation: string;
  receptionNumber: string;
  agent: {
    status: string;
    name: string;
    voice: string;
  };
}

interface RecentCall {
  id: string;
  contactName: string;
  phone: string;
  direction: string;
  status: string;
  summary?: string;
  startedAt: string;
}

export default function DashboardPage() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<Array<{
    id: string;
    type: string;
    title: string;
    contact?: string;
    phone?: string;
    risk: string;
  }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, 'approve' | 'deny'>>({});

  const { isConnected, activeCalls } = useWebSocket();

  const handleApprove = useCallback(async (id: string) => {
    setActionLoading((prev) => ({ ...prev, [id]: 'approve' }));
    try {
      const res = await fetch(`/api/approvals/${id}/approve`, { method: 'PUT' });
      if (res.ok) {
        setPendingApprovals((prev) => prev.filter((a) => a.id !== id));
      }
    } finally {
      setActionLoading((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }, []);

  const handleDeny = useCallback(async (id: string) => {
    setActionLoading((prev) => ({ ...prev, [id]: 'deny' }));
    try {
      const res = await fetch(`/api/approvals/${id}/deny`, { method: 'PUT' });
      if (res.ok) {
        setPendingApprovals((prev) => prev.filter((a) => a.id !== id));
      }
    } finally {
      setActionLoading((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }, []);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        setIsLoading(true);
        const [dashboardRes, callsRes, approvalsRes] = await Promise.all([
          fetch('/api/dashboard'),
          fetch('/api/calls?status=completed&limit=5'),
          fetch('/api/approvals?status=pending'),
        ]);

        if (dashboardRes.ok) {
          const data = await dashboardRes.json();
          setDashboardData(normalizeDashboardData(data));
        }

        if (callsRes.ok) {
          const data = await callsRes.json();
          setRecentCalls(Array.isArray(data.calls) ? data.calls.map(normalizeRecentCall).slice(0, 5) : []);
        }

        if (approvalsRes.ok) {
          const data = await approvalsRes.json();
          setPendingApprovals(
            Array.isArray(data.approvals) ? data.approvals.map(normalizePendingApprovalSummary).slice(0, 3) : []
          );
        }
      } catch (err) {
        setError('Failed to load dashboard data');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchDashboardData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  const metrics: Array<{
    label: string;
    value: string;
    description: string;
    icon: typeof Phone;
    trend: string | null;
    href: string;
    color?: string;
  }> = [
    {
      label: "Today's Calls",
      value: dashboardData?.todayCalls?.toString() || "0",
      description: dashboardData ? `${dashboardData.activeCalls} active` : "Loading...",
      icon: Phone,
      trend: null,
      href: "/calls",
    },
    {
      label: "Active Calls",
      value: activeCalls.length.toString(),
      description: `${activeCalls.filter(c => c.direction === 'inbound').length} inbound, ${activeCalls.filter(c => c.direction === 'outbound').length} outbound`,
      icon: CircleDot,
      color: "text-success",
      trend: null,
      href: "/calls",
    },
    {
      label: "Pending Approvals",
      value: dashboardData?.pendingApprovals?.toString() || "0",
      description: "Appointments, info requests",
      icon: ShieldCheck,
      color: "text-warning",
      trend: null,
      href: "/approvals",
    },
    {
      label: "Month Spend",
      value: dashboardData ? formatCents(dashboardData.monthSpendCents) : "$0.00",
      description: dashboardData ? dashboardData.businessName : "Loading...",
      icon: DollarSign,
      trend: null,
      href: "/costs",
    },
  ];

  const recentActivity = recentCalls.map((call, index) => ({
    id: call.id,
    action: call.status === 'completed' ? 'Completed call' : call.status === 'blocked' ? 'Call blocked' : 'Call ended',
    detail: call.summary || `Call with ${call.contactName} at ${call.phone}`,
    time: call.startedAt ? timeAgo(new Date(call.startedAt)) : 'Just now',
    icon: call.status === 'completed' ? CheckCircle2 : call.status === 'blocked' ? XCircle : AlertCircle,
    color: call.status === 'completed' ? "text-success" : call.status === 'blocked' ? "text-muted-foreground" : "text-warning",
  }));

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[calc(100vh-200px)]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Voice Agent Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              {dashboardData?.businessName || "Business"} voice operations, {dashboardData?.businessLocation || "location not set"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isConnected ? "success" : "secondary"}>
              <div className={cn("mr-1.5 h-2 w-2 rounded-full", isConnected ? "bg-success animate-pulse" : "bg-muted-foreground")} />
              {isConnected ? "Agent Connected" : "Agent Offline"}
            </Badge>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((m) => (
            <a key={m.label} href={m.href} className="block no-underline">
              <Card className="transition-colors hover:bg-accent/50">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <m.icon className={cn("h-5 w-5 text-muted-foreground", m.color)} />
                    <span className={cn("text-2xl font-bold", m.color)}>{m.value}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium">{m.label}</p>
                  <p className="text-xs text-muted-foreground">{m.description}</p>
                  {m.trend && <p className="mt-1 text-[11px] text-success">{m.trend}</p>}
                </CardContent>
              </Card>
            </a>
          ))}
        </div>

        {/* Active Calls - Live */}
        {activeCalls.length > 0 && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Live Calls ({activeCalls.length})
              </h2>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {activeCalls.map((call) => (
                <Card key={call.id} className="border-success/30 bg-success/5">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          {call.direction === "inbound" ? (
                            <PhoneIncoming className="h-4 w-4 text-success" />
                          ) : (
                            <PhoneOutgoing className="h-4 w-4 text-info" />
                          )}
                          <span className="font-semibold">{call.contactName}</span>
                        </div>
                        <p className="mt-0.5 text-sm text-muted-foreground">{call.phone}</p>
                      </div>
                      <Badge variant="success">
                        {call.status}
                      </Badge>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          {formatDuration(call.duration)}
                        </div>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          {call.status === "active" ? <Mic className="h-3.5 w-3.5 text-success" /> : <MicOff className="h-3.5 w-3.5" />}
                          {call.direction === 'inbound' ? 'Incoming call' : 'Outbound call'}
                        </div>
                      </div>
                      <Button size="sm" variant="outline">
                        <Volume2 className="mr-1.5 h-3.5 w-3.5" />
                        Listen
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Two-column layout */}
        <div className="grid gap-4 md:gap-6 md:grid-cols-2">
          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Recent Calls</CardTitle>
                <a href="/calls" className="text-sm text-muted-foreground hover:text-foreground no-underline">
                  View all <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
                </a>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {recentActivity.length > 0 ? recentActivity.map((item) => (
                  <div key={item.id} className="flex items-start gap-3 px-4 py-3 hover:bg-accent/30">
                    <item.icon className={cn("mt-0.5 h-4 w-4 shrink-0", item.color)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.action}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{item.detail}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{item.time}</span>
                  </div>
                )) : (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No recent calls
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Pending Approvals */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Pending Approvals</CardTitle>
                <a href="/approvals" className="text-sm text-muted-foreground hover:text-foreground no-underline">
                  View all <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
                </a>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {pendingApprovals.length > 0 ? pendingApprovals.map((item) => (
                  <div key={item.id} className="px-4 py-3 hover:bg-accent/30">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={item.risk === "high" ? "destructive" : "secondary"}
                            className="text-[10px]"
                          >
                            {item.type}
                          </Badge>
                          {item.contact && <span className="text-xs text-muted-foreground">{item.contact}</span>}
                        </div>
                        <p className="mt-1 text-sm font-medium line-clamp-2">{item.title}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="success"
                        className="h-7 text-xs"
                        disabled={!!actionLoading[item.id]}
                        onClick={() => handleApprove(item.id)}
                      >
                        {actionLoading[item.id] === 'approve' ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                        )}
                        {actionLoading[item.id] === 'approve' ? 'Approving...' : 'Approve'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={!!actionLoading[item.id]}
                        onClick={() => handleDeny(item.id)}
                      >
                        {actionLoading[item.id] === 'deny' ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <XCircle className="mr-1 h-3.5 w-3.5" />
                        )}
                        {actionLoading[item.id] === 'deny' ? 'Denying...' : 'Deny'}
                      </Button>
                    </div>
                  </div>
                )) : (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No pending approvals
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Agent Status */}
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Agent: {dashboardData?.agent?.name || 'Reception Desk'}</p>
              <p className="text-xs text-muted-foreground">
                {isConnected ? 'Online and ready for customer calls' : 'Offline, checking connection...'}.
                Handles appointments, front-desk questions, and routing for {dashboardData?.businessName || 'the business'}.
              </p>
            </div>
            <a href="/agent">
              <Button variant="outline" size="sm">Configure</Button>
            </a>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
