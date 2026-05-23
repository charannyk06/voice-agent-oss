"use client";

import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Bot,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  Globe,
  Loader2,
  Phone,
  PhoneCall,
  Radio,
  Save,
  Shield,
  Trash2,
  Wrench,
} from "lucide-react";

type AgentConfig = {
  name: string;
  voice: string;
  instructions: string;
  languageCode: string;
  businessName: string;
  businessLocation: string;
  receptionNumber: string;
  urgentTransferNumber: string;
  businessHoursStart: string;
  businessHoursEnd: string;
  maxCallDurationMin: number;
  budgetMonthlyCents: number;
  budgetDailyAlertCents: number;
  autoApproveBookingsUnderCents: number;
};

type ToolRow = {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
};

type KnowledgeDoc = {
  id: string;
  name: string;
  content: string | null;
  mimeType: string;
  size: number;
  createdAt: string;
};

type RuntimeStatus = {
  reachable: boolean;
  agentBaseUrl: string;
  health: null | {
    status?: string;
    activeCalls?: number;
    mode?: string;
    provider?: string;
    webhookPath?: string;
    statusPath?: string;
    streamPath?: string;
    mediaStreamUrl?: string;
    liveModel?: string;
    voiceName?: string;
    telephony?: {
      label?: string;
      health?: string;
      controlMode?: string;
      entryPoint?: string | null;
      message?: string;
      liveMediaReady?: boolean;
    };
  };
};

const defaultConfig: AgentConfig = {
  name: "",
  voice: "",
  instructions: "",
  languageCode: "",
  businessName: "",
  businessLocation: "",
  receptionNumber: "",
  urgentTransferNumber: "",
  businessHoursStart: "",
  businessHoursEnd: "",
  maxCallDurationMin: 0,
  budgetMonthlyCents: 0,
  budgetDailyAlertCents: 0,
  autoApproveBookingsUnderCents: 0,
};

export default function AgentPage() {
  const [config, setConfig] = useState<AgentConfig>(defaultConfig);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingTools, setSavingTools] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [docName, setDocName] = useState("");
  const [docContent, setDocContent] = useState("");
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [savingDoc, setSavingDoc] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [configRes, runtimeRes, toolsRes, docsRes] = await Promise.all([
          fetch("/api/agent/config", { cache: "no-store" }),
          fetch("/api/agent/runtime", { cache: "no-store" }),
          fetch("/api/agent/tools", { cache: "no-store" }),
          fetch("/api/knowledge-docs", { cache: "no-store" }),
        ]);

        if (configRes.ok) {
          const data = await configRes.json();
          setConfig({ ...defaultConfig, ...data.config });
        }

        if (runtimeRes.ok) {
          setRuntime(await runtimeRes.json());
        }

        if (toolsRes.ok) {
          const data = await toolsRes.json();
          setTools(Array.isArray(data.tools) ? data.tools : []);
        }

        if (docsRes.ok) {
          const data = await docsRes.json();
          setDocs(Array.isArray(data.docs) ? data.docs : []);
        }
      } catch (error) {
        console.error("Failed to load agent page", error);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const flashSaved = (label: string) => {
    setSaveSuccess(label);
    window.setTimeout(() => setSaveSuccess(null), 2500);
  };

  const handleConfigSave = async () => {
    setSavingConfig(true);
    try {
      const response = await fetch("/api/agent/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!response.ok) {
        throw new Error("Failed to save agent config");
      }
      flashSaved("Config saved");
    } catch (error) {
      console.error(error);
      alert("Failed to save agent config");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleToolsSave = async () => {
    setSavingTools(true);
    try {
      const response = await fetch("/api/agent/tools", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tools }),
      });
      if (!response.ok) {
        throw new Error("Failed to save tool config");
      }
      flashSaved("Tools updated");
    } catch (error) {
      console.error(error);
      alert("Failed to save tool configuration");
    } finally {
      setSavingTools(false);
    }
  };

  const startEditDoc = (doc: KnowledgeDoc) => {
    setEditingDocId(doc.id);
    setDocName(doc.name);
    setDocContent(doc.content || "");
  };

  const resetDocForm = () => {
    setEditingDocId(null);
    setDocName("");
    setDocContent("");
  };

  const handleDocSave = async () => {
    if (!docName.trim()) {
      alert("Document name is required");
      return;
    }

    setSavingDoc(true);
    try {
      const response = await fetch(
        editingDocId ? `/api/knowledge-docs/${editingDocId}` : "/api/knowledge-docs",
        {
          method: editingDocId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: docName,
            content: docContent,
            mimeType: "text/markdown",
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to save knowledge doc");
      }

      const docsRes = await fetch("/api/knowledge-docs", { cache: "no-store" });
      const docsData = await docsRes.json();
      setDocs(Array.isArray(docsData.docs) ? docsData.docs : []);
      resetDocForm();
      flashSaved(editingDocId ? "Knowledge doc updated" : "Knowledge doc added");
    } catch (error) {
      console.error(error);
      alert("Failed to save knowledge doc");
    } finally {
      setSavingDoc(false);
    }
  };

  const handleDocDelete = async (id: string) => {
    setDeletingDocId(id);
    try {
      const response = await fetch(`/api/knowledge-docs/${id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("Failed to delete knowledge doc");
      }
      setDocs((current) => current.filter((doc) => doc.id !== id));
      if (editingDocId === id) {
        resetDocForm();
      }
      flashSaved("Knowledge doc deleted");
    } catch (error) {
      console.error(error);
      alert("Failed to delete knowledge doc");
    } finally {
      setDeletingDocId(null);
    }
  };

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
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Agent Config</h1>
            <p className="text-sm text-muted-foreground">
              Review the live runtime, correct business facts, and manage production behavior end to end.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saveSuccess ? <Badge variant="success">{saveSuccess}</Badge> : null}
            <Badge variant={runtime?.reachable ? "success" : "secondary"}>
              <div className="mr-1.5 h-2 w-2 rounded-full bg-current" />
              {runtime?.reachable ? "Agent Online" : "Agent Offline"}
            </Badge>
            <Button onClick={handleConfigSave} disabled={savingConfig}>
              {savingConfig ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : saveSuccess === "Config saved" ? (
                <Check className="mr-2 h-4 w-4" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Config
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Radio className="h-4 w-4" /> Runtime Status
              </CardTitle>
              <CardDescription>Live backend health for the current agent runtime</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Backend</span>
                <Badge variant={runtime?.reachable ? "success" : "secondary"}>
                  {runtime?.reachable ? "Reachable" : "Offline"}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Provider</span>
                <span>{runtime?.health?.telephony?.label || runtime?.health?.provider || "unknown"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Mode</span>
                <span>{runtime?.health?.mode || "unknown"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Telephony state</span>
                <Badge
                  variant={
                    runtime?.health?.telephony?.health === "ready"
                      ? "success"
                      : runtime?.health?.telephony?.health === "foundation_only"
                        ? "secondary"
                        : "destructive"
                  }
                >
                  {runtime?.health?.telephony?.health === "ready"
                    ? "Ready"
                    : runtime?.health?.telephony?.health === "foundation_only"
                      ? "Foundation"
                      : "Setup Needed"}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Live model</span>
                <span className="max-w-[12rem] truncate" title={runtime?.health?.liveModel}>
                  {runtime?.health?.liveModel || "not set"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Active calls</span>
                <span>{runtime?.health?.activeCalls ?? 0}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Phone className="h-4 w-4" /> Call Wiring
              </CardTitle>
              <CardDescription>Paths and endpoints the active telephony provider exposes</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm break-all">
              <div>
                <p className="text-muted-foreground">Ingress path</p>
                <p>{runtime?.health?.webhookPath || "not set"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Lifecycle path</p>
                <p>{runtime?.health?.statusPath || "not set"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Stream path</p>
                <p>{runtime?.health?.streamPath || "not set"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Media stream URL</p>
                <p>{runtime?.health?.mediaStreamUrl || "not set"}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="font-medium">{runtime?.health?.telephony?.message || "No telephony runtime message."}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {runtime?.health?.telephony?.liveMediaReady
                    ? "Live media is wired."
                    : "Live media is not wired yet."}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PhoneCall className="h-4 w-4" /> Knowledge Coverage
              </CardTitle>
              <CardDescription>What the live agent can currently use</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                {docs.length} live knowledge documents loaded
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                {tools.filter((tool) => tool.enabled).length} tools enabled
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                Live instructions come from saved dashboard config
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="identity">
          <TabsList className="flex flex-wrap gap-2 h-auto">
            <TabsTrigger value="identity">Identity</TabsTrigger>
            <TabsTrigger value="voice">Voice</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
            <TabsTrigger value="rules">Rules</TabsTrigger>
          </TabsList>

          <TabsContent value="identity" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Business and Agent Identity</CardTitle>
                <CardDescription>The saved config used by the live agent prompt</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Agent Name</Label>
                    <Input value={config.name} onChange={(e) => setConfig((prev) => ({ ...prev, name: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Language Code</Label>
                    <Input value={config.languageCode} onChange={(e) => setConfig((prev) => ({ ...prev, languageCode: e.target.value }))} placeholder="en-US" />
                  </div>
                  <div className="space-y-2">
                    <Label>Business Name</Label>
                    <Input value={config.businessName} onChange={(e) => setConfig((prev) => ({ ...prev, businessName: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Business Location</Label>
                    <Input value={config.businessLocation} onChange={(e) => setConfig((prev) => ({ ...prev, businessLocation: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Reception Number</Label>
                    <Input value={config.receptionNumber} onChange={(e) => setConfig((prev) => ({ ...prev, receptionNumber: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Urgent Transfer Number</Label>
                    <Input value={config.urgentTransferNumber} onChange={(e) => setConfig((prev) => ({ ...prev, urgentTransferNumber: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>System Instructions</Label>
                  <textarea
                    className="flex min-h-[280px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                    value={config.instructions}
                    onChange={(e) => setConfig((prev) => ({ ...prev, instructions: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    This prompt is now used by the live runtime, not just the dashboard form.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="voice" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Voice Runtime</CardTitle>
                <CardDescription>Real voice data from the running agent backend</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border p-3 text-sm">
                    <p className="text-xs text-muted-foreground">Runtime voice</p>
                    <p className="mt-1 font-medium">{runtime?.health?.voiceName || "Not exposed by runtime"}</p>
                  </div>
                  <div className="rounded-lg border p-3 text-sm">
                    <p className="text-xs text-muted-foreground">Live model</p>
                    <p className="mt-1 font-medium">{runtime?.health?.liveModel || "Not available"}</p>
                  </div>
                </div>
                <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                  This dashboard no longer shows fake voice personas. It only shows the real runtime voice data the backend exposes.
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tools" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Wrench className="h-4 w-4" /> Agent Tools
                    </CardTitle>
                    <CardDescription>Enable only the actions the live agent should be allowed to use</CardDescription>
                  </div>
                  <Button variant="outline" onClick={handleToolsSave} disabled={savingTools}>
                    {savingTools ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Tools
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {tools.map((tool) => (
                  <div key={tool.key} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">{tool.name}</p>
                      <p className="text-xs text-muted-foreground">{tool.description}</p>
                    </div>
                    <Button
                      variant={tool.enabled ? "success" : "outline"}
                      size="sm"
                      onClick={() =>
                        setTools((current) =>
                          current.map((row) =>
                            row.key === tool.key ? { ...row, enabled: !row.enabled } : row,
                          ),
                        )
                      }
                    >
                      {tool.enabled ? "Enabled" : "Disabled"}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="knowledge" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-4 w-4" /> Knowledge Base
                  </CardTitle>
                  <CardDescription>These docs are pulled into the live business prompt and searchable via tools</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {docs.map((doc) => (
                    <div key={doc.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{doc.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {(doc.content || "").slice(0, 140) || "No content yet"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => startEditDoc(doc)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            disabled={deletingDocId === doc.id}
                            onClick={() => void handleDocDelete(doc.id)}
                          >
                            {deletingDocId === doc.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {editingDocId ? "Edit Knowledge Doc" : "Add Knowledge Doc"}
                  </CardTitle>
                  <CardDescription>
                    Paste only confirmed SOPs, FAQs, hours, service details, and policies here.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <Label>Document Name</Label>
                    <Input value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="Business FAQ.md" />
                  </div>
                  <div className="space-y-2">
                    <Label>Document Content</Label>
                    <textarea
                      className="flex min-h-[320px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                      value={docContent}
                      onChange={(e) => setDocContent(e.target.value)}
                      placeholder="Paste confirmed business knowledge here"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    {editingDocId ? (
                      <Button variant="outline" onClick={resetDocForm}>
                        Cancel
                      </Button>
                    ) : null}
                    <Button onClick={() => void handleDocSave()} disabled={savingDoc}>
                      {savingDoc ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      {editingDocId ? "Update Doc" : "Add Doc"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="rules" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Operational Rules</CardTitle>
                <CardDescription>These values control runtime behavior, budgets, and escalation thresholds</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Business Hours Start</Label>
                    <Input value={config.businessHoursStart} onChange={(e) => setConfig((prev) => ({ ...prev, businessHoursStart: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Business Hours End</Label>
                    <Input value={config.businessHoursEnd} onChange={(e) => setConfig((prev) => ({ ...prev, businessHoursEnd: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Call Duration, minutes</Label>
                    <Input
                      type="number"
                      value={config.maxCallDurationMin}
                      onChange={(e) => setConfig((prev) => ({ ...prev, maxCallDurationMin: Number(e.target.value || 0) }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Auto-approve Bookings Under, cents</Label>
                    <Input
                      type="number"
                      value={config.autoApproveBookingsUnderCents}
                      onChange={(e) => setConfig((prev) => ({ ...prev, autoApproveBookingsUnderCents: Number(e.target.value || 0) }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Monthly Budget, cents</Label>
                    <Input
                      type="number"
                      value={config.budgetMonthlyCents}
                      onChange={(e) => setConfig((prev) => ({ ...prev, budgetMonthlyCents: Number(e.target.value || 0) }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Daily Budget Alert, cents</Label>
                    <Input
                      type="number"
                      value={config.budgetDailyAlertCents}
                      onChange={(e) => setConfig((prev) => ({ ...prev, budgetDailyAlertCents: Number(e.target.value || 0) }))}
                    />
                  </div>
                </div>

                <Separator />

                <div className="grid gap-3 md:grid-cols-3 text-sm">
                  <div className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center gap-2 font-medium">
                      <Clock className="h-4 w-4" /> Hours
                    </div>
                    <p className="text-muted-foreground">Outbound calls should stay inside the configured window.</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center gap-2 font-medium">
                      <Shield className="h-4 w-4" /> Escalation
                    </div>
                    <p className="text-muted-foreground">Urgent and uncertain professional cases should be transferred immediately.</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center gap-2 font-medium">
                      <Globe className="h-4 w-4" /> Language
                    </div>
                    <p className="text-muted-foreground">Use the caller's preferred language-first conversation flow, then match caller preference.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4 w-4" /> Production Readiness Notes
            </CardTitle>
            <CardDescription>What this dashboard now controls correctly</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 text-sm">
            <div className="rounded-lg border p-3">
              <p className="font-medium">Live runtime prompt</p>
              <p className="text-muted-foreground">Saved agent instructions are now consumed by the live backend, not ignored.</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-medium">Knowledge management</p>
              <p className="text-muted-foreground">Knowledge docs are editable from the UI and become part of the live prompt plus search tool results.</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-medium">Tool governance</p>
              <p className="text-muted-foreground">Tool enablement is persisted and used to limit live function declarations.</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-medium">Rules and thresholds</p>
              <p className="text-muted-foreground">Business hours, budgets, duration, and approval thresholds are all saved from this page.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
