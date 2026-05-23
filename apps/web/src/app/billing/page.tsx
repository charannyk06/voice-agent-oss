"use client";

import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, CreditCard, Loader2, ShieldCheck, Zap } from "lucide-react";

interface BillingStatus {
  deploymentMode: "self_hosted" | "hosted";
  orgName: string;
  stripeCustomerId: string | null;
  subscriptionStatus: string;
  currentPeriodEnd: string | null;
  active: boolean;
  quotaSeconds: number;
  usedSeconds: number;
  usagePercent: number;
}

function formatMinutes(seconds: number) {
  return `${Math.round(seconds / 60).toLocaleString()} min`;
}

function statusVariant(active: boolean, status: string) {
  if (active) return "success" as const;
  if (status === "past_due" || status === "unpaid") return "warning" as const;
  return "secondary" as const;
}

async function postForUrl(endpoint: string) {
  const response = await fetch(endpoint, { method: "POST" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  }
  if (typeof data.url !== "string") {
    throw new Error("Missing redirect URL");
  }
  window.location.href = data.url;
}

export default function BillingPage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadBilling() {
      try {
        setError(null);
        const response = await fetch("/api/billing/status", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Failed to load billing");
        }
        if (!cancelled) setStatus(data as BillingStatus);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load billing");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadBilling();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCheckout() {
    try {
      setBusyAction("checkout");
      setError(null);
      await postForUrl("/api/billing/checkout");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
      setBusyAction(null);
    }
  }

  async function handlePortal() {
    try {
      setBusyAction("portal");
      setError(null);
      await postForUrl("/api/billing/portal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing portal");
      setBusyAction(null);
    }
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  const quotaSeconds = status?.quotaSeconds ?? 0;
  const usedSeconds = status?.usedSeconds ?? 0;
  const usagePercent = status?.usagePercent ?? 0;
  const hosted = status?.deploymentMode === "hosted";

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
            <p className="text-sm text-muted-foreground">
              Hosted usage must have an active Stripe subscription before live calls can start.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {hosted ? (
              <Button onClick={handleCheckout} disabled={busyAction !== null} className="w-full sm:w-auto">
                {busyAction === "checkout" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                {status?.active ? "Change plan" : "Start subscription"}
              </Button>
            ) : null}
            {status?.stripeCustomerId ? (
              <Button variant="outline" onClick={handlePortal} disabled={busyAction !== null} className="w-full sm:w-auto">
                {busyAction === "portal" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                Billing portal
              </Button>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <p className="text-sm font-medium">Billing action failed</p>
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {status?.active ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
                Access
              </CardTitle>
              <CardDescription>Live call gate</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Badge variant={statusVariant(Boolean(status?.active), status?.subscriptionStatus ?? "inactive")}>
                {status?.active ? "Enabled" : "Blocked"}
              </Badge>
              <p className="text-sm text-muted-foreground">
                {hosted
                  ? status?.active
                    ? "Hosted calls are enabled for this workspace."
                    : "Hosted calls are blocked until Stripe marks the subscription active."
                  : "Self-hosted mode is enabled. Users bring their own telephony and model credentials."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                Subscription
              </CardTitle>
              <CardDescription>{status?.orgName || "Default workspace"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Mode</span>
                <span className="font-medium">{hosted ? "Hosted" : "Self-hosted"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Status</span>
                <span className="font-medium">{status?.subscriptionStatus || "inactive"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Stripe customer</span>
                <span className="font-medium">{status?.stripeCustomerId || "Not created"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Period end</span>
                <span className="font-medium">
                  {status?.currentPeriodEnd ? new Date(status.currentPeriodEnd).toLocaleDateString() : "Not set"}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-4 w-4 text-muted-foreground" />
                Usage
              </CardTitle>
              <CardDescription>Current monthly voice quota</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-2xl font-bold">{formatMinutes(usedSeconds)}</p>
                  <p className="text-xs text-muted-foreground">used this month</p>
                </div>
                <p className="text-sm text-muted-foreground">of {quotaSeconds ? formatMinutes(quotaSeconds) : "unlimited"}</p>
              </div>
              <div className="h-2 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(usagePercent, 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{usagePercent}% of included hosted usage consumed.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
