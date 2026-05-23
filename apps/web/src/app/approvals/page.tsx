"use client";

import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { normalizeApproval } from "@/lib/normalize";
import { cn, timeAgo } from "@/lib/utils";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Calendar,
  MessageSquare,
  ChevronRight,
  Zap,
  Settings,
  Loader2,
  RefreshCw,
} from "lucide-react";

interface Approval {
  id: string;
  type: string;
  title: string;
  description?: string;
  risk: string;
  status: string;
  contact?: string;
  phone?: string;
  callContext?: string;
  createdAt: string;
}

export default function ApprovalsPage() {
  const [pending, setPending] = useState<Approval[]>([]);
  const [history, setHistory] = useState<Approval[]>([]);
  const [rules, setRules] = useState<Array<{ id: string; name: string; enabled: boolean }>>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchApprovals = useCallback(async () => {
    try {
      const [approvalsRes, rulesRes] = await Promise.all([
        fetch("/api/approvals"),
        fetch("/api/auto-approve-rules"),
      ]);
      if (approvalsRes.ok) {
        const data = await approvalsRes.json();
        const approvals = Array.isArray(data.approvals) ? data.approvals.map(normalizeApproval) : [];
        setPending(approvals.filter((a: Approval) => a.status === "pending"));
        setHistory(approvals.filter((a: Approval) => a.status !== "pending"));
      }
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        setRules(Array.isArray(data.rules) ? data.rules : []);
      }
    } catch {
      // silently fail on refresh
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApprovals();
    const interval = setInterval(fetchApprovals, 15000);
    return () => clearInterval(interval);
  }, [fetchApprovals]);

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      if (res.ok) {
        setPending((prev) => prev.filter((a) => a.id !== id));
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeny = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "denied" }),
      });
      if (res.ok) {
        setPending((prev) => prev.filter((a) => a.id !== id));
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleRule = async (id: string, enabled: boolean) => {
    try {
      await fetch("/api/auto-approve-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled }),
      });
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
    } catch {
      // silently fail
    }
  };

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
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Approvals</h1>
            <p className="text-sm text-muted-foreground">Review and approve agent actions</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchApprovals} className="w-full sm:w-auto">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Pending count banner */}
        {pending.length > 0 && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-warning shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">{pending.length} actions waiting for your approval</p>
              <p className="text-xs text-muted-foreground">
                The agent is paused on these tasks until you approve or deny
              </p>
            </div>
            <Button size="sm" variant="outline" className="w-full sm:w-auto">
              Approve All Safe
            </Button>
          </div>
        )}

        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">
              Pending ({pending.length})
            </TabsTrigger>
            <TabsTrigger value="history">History ({history.length})</TabsTrigger>
            <TabsTrigger value="rules">Auto-Approve Rules</TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-4">
            {pending.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No pending approvals
              </div>
            ) : (
              pending.map((item) => (
                <Card key={item.id} className={cn(item.risk === "high" && "border-warning/30")}>
                  <CardContent className="p-0">
                    <button
                      onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                      className="flex w-full items-start gap-4 p-4 text-left hover:bg-accent/30"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                        {item.risk === "high" ? (
                          <AlertTriangle className="h-4 w-4 text-warning" />
                        ) : (
                          <Calendar className="h-4 w-4 text-info" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={item.risk === "high" ? "destructive" : "secondary"}>
                            {item.type}
                          </Badge>
                          <Badge variant={item.risk === "high" ? "destructive" : "outline"}>
                            {item.risk} risk
                          </Badge>
                        </div>
                        <p className="mt-1.5 text-sm font-semibold">{item.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.contact ?? "Unknown contact"} &middot; {timeAgo(item.createdAt)}
                        </p>
                      </div>
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                          expandedId === item.id && "rotate-90"
                        )}
                      />
                    </button>

                    {expandedId === item.id && (
                      <div className="border-t px-4 py-4">
                        {item.description && (
                          <p className="text-sm text-muted-foreground">{item.description}</p>
                        )}

                        {item.callContext && (
                          <div className="mt-4 rounded-md bg-muted/50 p-3">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                              Call Context
                            </p>
                            <p className="text-sm">{item.callContext}</p>
                          </div>
                        )}

                        <div className="mt-4 flex gap-2">
                          <Button
                            variant="success"
                            disabled={actionLoading !== null}
                            onClick={() => handleApprove(item.id)}
                          >
                            {actionLoading === item.id ? (
                              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="mr-1.5 h-4 w-4" />
                            )}
                            Approve
                          </Button>
                          <Button
                            variant="destructive"
                            disabled={actionLoading !== null}
                            onClick={() => handleDeny(item.id)}
                          >
                            {actionLoading === item.id ? (
                              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            ) : (
                              <XCircle className="mr-1.5 h-4 w-4" />
                            )}
                            Deny
                          </Button>
                          <Button variant="outline">
                            <MessageSquare className="mr-1.5 h-4 w-4" />
                            Add Note
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-2">
            {history.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No approval history</div>
            ) : (
              history.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <div
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full",
                      item.status === "approved" && "bg-success/15 text-success",
                      item.status === "denied" && "bg-destructive/15 text-destructive",
                      item.status === "auto" && "bg-info/15 text-info"
                    )}
                  >
                    {item.status === "approved" && <CheckCircle2 className="h-4 w-4" />}
                    {item.status === "denied" && <XCircle className="h-4 w-4" />}
                    {item.status === "auto" && <Zap className="h-4 w-4" />}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{item.title}</p>
                  </div>
                  <Badge variant={item.status === "auto" ? "info" : "outline"} className="text-[10px]">
                    {item.status === "auto" ? "auto" : item.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{timeAgo(item.createdAt)}</span>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="rules">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Auto-Approve Rules</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {rules.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No auto-approve rules configured</p>
                ) : (
                  rules.map((rule) => (
                    <AutoApproveRuleRow
                      key={rule.id}
                      name={rule.name}
                      enabled={rule.enabled}
                      onToggle={() => handleToggleRule(rule.id, !rule.enabled)}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

function AutoApproveRuleRow({ name, enabled, onToggle }: { name: string; enabled: boolean; onToggle?: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="flex items-center gap-3">
        <Zap className={cn("h-4 w-4", enabled ? "text-success" : "text-muted-foreground")} />
        <span className="text-sm font-medium">{name}</span>
      </div>
      <Button size="sm" variant={enabled ? "success" : "outline"} onClick={onToggle}>
        {enabled ? "Enabled" : "Disabled"}
      </Button>
    </div>
  );
}
