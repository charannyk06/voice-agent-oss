"use client";

import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { normalizeSettingsStatus, type SettingsStatus } from "@/lib/normalize";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Globe,
  Key,
  Loader2,
  Phone,
  Radio,
  Shield,
} from "lucide-react";

export default function SettingsPage() {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const telephonyHealthVariant = status?.telephony?.health === "ready"
    ? "success"
    : status?.telephony?.health === "foundation_only"
      ? "secondary"
      : "destructive";
  const telephonyHealthLabel = status?.telephony?.health === "ready"
    ? "Ready"
    : status?.telephony?.health === "foundation_only"
      ? "Foundation"
      : "Setup Needed";

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/settings/status", { cache: "no-store" });
        if (response.ok) {
          setStatus(normalizeSettingsStatus(await response.json()));
        }
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Real deployment and provider status for the live business voice agent stack.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Phone className="h-4 w-4" /> Telephony
              </CardTitle>
              <CardDescription>Live provider state and call entry wiring</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm break-all">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-muted-foreground">Active Provider</p>
                  <p>{status?.telephony?.label || status?.telephonyProvider || "Unknown"}</p>
                </div>
                <Badge variant={telephonyHealthVariant}>
                  {telephonyHealthLabel}
                </Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Entry Point</p>
                <p>{status?.telephony?.entryPoint || status?.entryPoint || status?.phoneNumber || "Not configured"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Control Mode</p>
                <p>{status?.telephony?.controlMode || "unknown"}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="font-medium">{status?.telephony?.message || "No telephony status available."}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {status?.telephony?.liveMediaReady
                    ? "Live media path is configured."
                    : "Live media path is not ready yet."}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Radio className="h-4 w-4" /> Runtime Endpoints
              </CardTitle>
              <CardDescription>What the dashboard is trying to reach</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm break-all">
              <div>
                <p className="text-muted-foreground">Agent URL</p>
                <p>{status?.agentUrl || "Not configured"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Explicit WebSocket URL</p>
                <p>{status?.websocketUrl || "Derived automatically"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Database Mode</p>
                <Badge variant={status?.databaseMode === "postgres" ? "success" : "secondary"}>
                  {status?.databaseMode || "unknown"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="h-4 w-4" /> Security
              </CardTitle>
              <CardDescription>Authentication status</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="font-medium">Authentication Provider</p>
                  <p className="text-xs text-muted-foreground">Clerk manages sign-in and sessions</p>
                </div>
                <Badge variant="success">
                  Clerk
                </Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="font-medium">Clerk configured</p>
                  <p className="text-xs text-muted-foreground">Publishable key detected</p>
                </div>
                <Badge variant={status?.security.clerkConfigured ? "success" : "destructive"}>
                  {status?.security.clerkConfigured ? "Active" : "Missing keys"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Key className="h-4 w-4" /> Provider Status
            </CardTitle>
            <CardDescription>Configured adapters and provider readiness</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(status?.providers ?? []).map((provider) => (
              <div key={provider.key} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{provider.name}</span>
                  <Badge variant={provider.active ? "success" : provider.ready ? "secondary" : provider.configured ? "secondary" : "destructive"}>
                    {provider.active ? "Active" : provider.ready ? "Ready" : provider.configured ? "Configured" : "Missing"}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{provider.message || "No status details."}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="h-4 w-4" /> Telephony Details
            </CardTitle>
            <CardDescription>Provider-specific wiring the runtime currently exposes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {(status?.telephony?.details ?? []).length === 0 ? (
              <p className="text-muted-foreground">No provider details exposed yet.</p>
            ) : (
              (status?.telephony?.details ?? []).map((detail) => (
                <div key={detail.label} className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{detail.label}</p>
                  <p className="mt-1 break-all">{detail.value || "Not configured"}</p>
                </div>
              ))
            )}
            {(status?.telephony?.notes ?? []).map((note) => (
              <div key={note} className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                {note}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4" /> Production Notes
            </CardTitle>
            <CardDescription>What still matters before calling this fully production-grade</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start gap-3 rounded-lg border p-3">
              {status?.databaseMode === "sqlite-file" ? (
                <AlertCircle className="mt-0.5 h-4 w-4 text-warning" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
              )}
              <div>
                <p className="font-medium">Database persistence</p>
                <p className="text-muted-foreground">
                  SQLite file mode is okay for local development, but Vercel production should use a managed database.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border p-3">
              <Globe className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <p className="font-medium">Frontend to backend routing</p>
                <p className="text-muted-foreground">
                  The dashboard now derives the websocket URL from the agent URL when an explicit WS URL is not provided.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button asChild variant="outline">
                <a href="/agent">Open Agent Config</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
