"use client";

import React, { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn, formatDuration, formatPhone, timeAgo } from "@/lib/utils";
import { normalizePastCall } from "@/lib/normalize";
import { useWebSocket, type CallSession } from "@/lib/websocket";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Clock,
  Search,
  Volume2,
  ArrowUpRight,
  MessageSquare,
  CheckCircle2,
  Loader2,
  Wifi,
  WifiOff,
} from "lucide-react";

interface PastCall {
  id: string;
  contactName: string;
  phone: string;
  direction: string;
  status: string;
  duration: number;
  summary: string | null;
  outcome: string | null;
  startedAt: string;
  endedAt: string | null;
  actions: Array<{
    id: string;
    type: string;
    description: string;
  }>;
}

interface TranscriptLine {
  speaker: string;
  text: string;
  timestamp?: string;
}

interface CallDetail {
  id: string;
  contactName: string;
  phone: string;
  direction: string;
  status: string;
  duration: number;
  summary: string | null;
  outcome: string | null;
  startedAt: string;
  endedAt: string | null;
  transcript: string | null;
  actions: Array<{
    id: string;
    type: string;
    description: string;
    createdAt?: string;
  }>;
  appointment?: {
    id: string;
    customerName: string;
    service: string;
    staffMember: string | null;
    date: string;
    time: string;
    reason: string;
    status: string;
  } | null;
  approval?: {
    id: string;
    title?: string;
    status?: string;
    risk?: string;
  } | null;
  costs?: Array<{
    id: string;
    amountCents?: number;
    category?: string;
    provider?: string;
    createdAt?: string;
  }>;
}

function parseTranscript(raw: string | null | undefined): TranscriptLine[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((line): line is Record<string, unknown> => Boolean(line) && typeof line === "object")
      .map((line) => ({
        speaker: typeof line.speaker === "string" ? line.speaker : "unknown",
        text: typeof line.text === "string" ? line.text : "",
        timestamp: typeof line.timestamp === "string" ? line.timestamp : undefined,
      }))
      .filter((line) => line.text.trim().length > 0);
  } catch {
    return raw.trim() ? [{ speaker: "transcript", text: raw.trim() }] : [];
  }
}

function getLiveDuration(call: CallSession) {
  const startedAt = new Date(call.startedAt).getTime();
  if (Number.isNaN(startedAt)) {
    return call.duration;
  }
  return Math.max(call.duration, Math.floor((Date.now() - startedAt) / 1000));
}

function LiveCallCard({ call }: { call: CallSession }) {
  const [showTranscript, setShowTranscript] = useState(true);
  const purpose = call.summary || "Active call";
  const transcript = Array.isArray(call.transcript) ? call.transcript : [];

  return (
    <Card className={cn("border-l-4", call.direction === "outbound" ? "border-l-info" : "border-l-success")}>
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
              {call.direction === "outbound" ? (
                <PhoneOutgoing className="h-4 w-4 text-info" />
              ) : (
                <PhoneIncoming className="h-4 w-4 text-success" />
              )}
              <span className="font-semibold">{call.contactName}</span>
              <Badge variant="secondary">{call.status}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {formatPhone(call.phone)} &middot; {purpose}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {formatDuration(getLiveDuration(call))}
            </div>
            <Button size="sm" variant="outline" disabled>
              <Volume2 className="mr-1.5 h-3.5 w-3.5" />
              Live
            </Button>
          </div>
        </div>

        {transcript.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowTranscript(!showTranscript)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Live Transcript
              <span className="text-[10px]">{showTranscript ? "(hide)" : "(show)"}</span>
            </button>
            {showTranscript && (
              <div className="mt-2 max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-3">
                {transcript.map((line, i) => (
                  <div key={`${line.timestamp}-${i}`} className="mb-2 last:mb-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-[10px] font-bold uppercase", line.speaker === "agent" ? "text-info" : "text-foreground")}>
                        {line.speaker === "agent" ? "Agent" : "Caller"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{timeAgo(line.timestamp)}</span>
                    </div>
                    <p className="mt-0.5 text-sm">{line.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PastCallRow({ call, onOpen }: { call: PastCall; onOpen: (callId: string) => void }) {
  const outcomeBadge: Record<string, React.ReactNode> = {
    success: <Badge variant="success">Completed</Badge>,
    pending: <Badge variant="warning">Pending</Badge>,
    blocked: <Badge variant="secondary">Blocked</Badge>,
    transferred: <Badge variant="info">Transferred</Badge>,
    failed: <Badge variant="destructive">Failed</Badge>,
  };
  const actions = Array.isArray(call.actions) ? call.actions : [];

  return (
    <Card className="transition-colors hover:bg-accent/30">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {call.direction === "outbound" ? (
                <PhoneOutgoing className="h-4 w-4 text-muted-foreground" />
              ) : (
                <PhoneIncoming className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="font-semibold">{call.contactName}</span>
              {call.outcome && outcomeBadge[call.outcome]}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatPhone(call.phone)} &middot; {timeAgo(call.startedAt)} &middot; {formatDuration(call.duration)}
            </p>
            {call.summary && <p className="mt-2 text-sm text-muted-foreground">{call.summary}</p>}
            {actions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {actions.map((action, i) => (
                  <Badge key={`${action.id}-${i}`} variant="outline" className="text-[11px]">
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    {action.description}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => onOpen(call.id)}>
            <ArrowUpRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CallDetailDialog({
  open,
  onOpenChange,
  loading,
  error,
  detail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  detail: CallDetail | null;
}) {
  const transcriptLines = parseTranscript(detail?.transcript);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Call details</DialogTitle>
          <DialogDescription>
            Review transcript, outcome, actions, and metadata for this call.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !detail ? (
          <p className="text-sm text-muted-foreground">No call details found.</p>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Contact</p>
                  <p className="mt-1 font-semibold">{detail.contactName}</p>
                  <p className="text-sm text-muted-foreground">{formatPhone(detail.phone)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Direction</p>
                  <p className="mt-1 font-semibold capitalize">{detail.direction}</p>
                  <p className="text-sm text-muted-foreground capitalize">{detail.status}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Started</p>
                  <p className="mt-1 font-semibold">{timeAgo(detail.startedAt)}</p>
                  <p className="text-sm text-muted-foreground">{formatDuration(detail.duration)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Outcome</p>
                  <p className="mt-1 font-semibold capitalize">{detail.outcome || "Unknown"}</p>
                  <p className="text-sm text-muted-foreground">ID: {detail.id}</p>
                </CardContent>
              </Card>
            </div>

        <div className="space-y-2">
            <h3 className="text-sm font-semibold">Call Summary</h3>
            <Card>
              <CardContent className="p-4 text-sm">
                {detail.summary?.trim() ? (
                  <p>{detail.summary}</p>
                ) : (
                  <p className="text-muted-foreground">No summary recorded for this call.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {detail.actions.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Actions & Tool Calls</h3>
              <Card>
                <CardContent className="space-y-2 p-4">
                  {detail.actions.map((action, index) => (
                    <div key={`${action.id}-${index}`} className="flex items-start gap-3 rounded-md border p-3">
                      <Badge variant="outline" className="shrink-0 mt-0.5">{action.type}</Badge>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm break-words">{action.description}</p>
                        {action.createdAt && (
                          <p className="mt-1 text-xs text-muted-foreground">{timeAgo(action.createdAt)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Linked Appointment */}
          {detail.appointment && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Linked Appointment</h3>
              <Card className="border-primary/20">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{detail.appointment.customerName}</p>
                      <p className="text-sm text-muted-foreground">{detail.appointment.service}</p>
                    </div>
                    <Badge variant={detail.appointment.status === "confirmed" ? "success" : "secondary"}>
                      {detail.appointment.status}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-sm text-muted-foreground">
                    <span>{detail.appointment.date} at {detail.appointment.time}</span>
                    {detail.appointment.staffMember && <span> {detail.appointment.staffMember}</span>}
                  </div>
                  {detail.appointment.reason && (
                    <p className="mt-2 text-sm">{detail.appointment.reason}</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Cost */}
          {detail.costs && detail.costs.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Call Cost</h3>
              <Card>
                <CardContent className="p-4">
                  {detail.costs.map((cost) => (
                    <div key={cost.id} className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{cost.provider || "Voice call"}</span>
                      <span className="font-medium">
                        {typeof cost.amountCents === "number" ? `$${(cost.amountCents / 100).toFixed(2)}` : "N/A"}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function CallsPage() {
  const { activeCalls, isConnected, makeCall } = useWebSocket();
  const [pastCalls, setPastCalls] = useState<PastCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [callDetail, setCallDetail] = useState<CallDetail | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [callPhone, setCallPhone] = useState("");
  const [callPurpose, setCallPurpose] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchPastCalls = useCallback(async () => {
    try {
      const res = await fetch("/api/calls?status=completed");
      if (!res.ok) throw new Error("Failed to fetch past calls");
      const data = await res.json();
      setPastCalls(Array.isArray(data.calls) ? data.calls.map(normalizePastCall) : []);
    } catch (err) {
      console.error("Error fetching past calls:", err);
    }
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      await fetchPastCalls();
      setLoading(false);
    };

    fetchData();
    const interval = setInterval(fetchPastCalls, 15000);
    return () => clearInterval(interval);
  }, [fetchPastCalls]);

  const openCallDetail = useCallback(async (callId: string) => {
    setSelectedCallId(callId);
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError(null);

    try {
      const response = await fetch(`/api/calls/${callId}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to load call details");
      }

      const data = await response.json();
      setCallDetail(data.call ?? null);
    } catch (error) {
      setCallDetail(null);
      setDetailError(error instanceof Error ? error.message : "Failed to load call details");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleMakeCall = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCallError(null);

    if (!isConnected) {
      setCallError("The voice agent backend is offline. Start the agent first.");
      return;
    }

    if (!callPhone.trim()) {
      setCallError("Phone number is required.");
      return;
    }

    if (!callPurpose.trim()) {
      setCallError("Purpose is required.");
      return;
    }

    setSubmitting(true);
    try {
      makeCall(callPhone.trim(), callPurpose.trim());
      setComposeOpen(false);
      setCallPhone("");
      setCallPurpose("");
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Failed to start call");
    } finally {
      setSubmitting(false);
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
            <h1 className="text-2xl font-bold tracking-tight">Calls</h1>
            <p className="text-sm text-muted-foreground">Monitor live calls and review history</p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Badge variant={isConnected ? "success" : "secondary"}>
              {isConnected ? <Wifi className="mr-1.5 h-3.5 w-3.5" /> : <WifiOff className="mr-1.5 h-3.5 w-3.5" />}
              {isConnected ? "Agent online" : "Agent offline"}
            </Badge>
            <Button className="w-full sm:w-auto" onClick={() => setComposeOpen(true)}>
              <Phone className="mr-2 h-4 w-4" />
              Make Call
            </Button>
          </div>
        </div>

        <Tabs defaultValue="live">
          <TabsList>
            <TabsTrigger value="live" className="gap-1.5">
              <div className={cn("h-2 w-2 rounded-full", activeCalls.length > 0 ? "bg-success animate-pulse" : "bg-muted-foreground")} />
              Live ({activeCalls.length})
            </TabsTrigger>
            <TabsTrigger value="history">History ({pastCalls.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="live" className="space-y-4">
            {!isConnected && (
              <Card>
                <CardContent className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
                  <WifiOff className="h-4 w-4" />
                  The dashboard is up, but the realtime voice agent websocket is offline.
                </CardContent>
              </Card>
            )}
            {activeCalls.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Phone className="h-12 w-12 text-muted-foreground/50" />
                  <p className="mt-4 text-sm text-muted-foreground">No active calls right now</p>
                </CardContent>
              </Card>
            ) : (
              activeCalls.map((call) => <LiveCallCard key={call.id} call={call} />)
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search calls..." className="pl-8" />
              </div>
              <Button variant="outline" size="sm" disabled>
                Filter
              </Button>
            </div>
            {pastCalls.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Phone className="h-12 w-12 text-muted-foreground/50" />
                  <p className="mt-4 text-sm text-muted-foreground">No call history yet</p>
                </CardContent>
              </Card>
            ) : (
              pastCalls.map((call) => <PastCallRow key={call.id} call={call} onOpen={openCallDetail} />)
            )}
          </TabsContent>
        </Tabs>
      </div>

      <CallDetailDialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            setSelectedCallId(null);
            setCallDetail(null);
            setDetailError(null);
          }
        }}
        loading={detailLoading}
        error={detailError}
        detail={selectedCallId ? callDetail : null}
      />

      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start outbound call</DialogTitle>
            <DialogDescription>
              This sends the request directly to the live voice agent backend.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleMakeCall}>
            <div className="space-y-2">
              <Label htmlFor="call-phone">Phone number</Label>
              <Input
                id="call-phone"
                value={callPhone}
                onChange={(event) => setCallPhone(event.target.value)}
                placeholder="+1 555 123 4567"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="call-purpose">Purpose</Label>
              <Input
                id="call-purpose"
                value={callPurpose}
                onChange={(event) => setCallPurpose(event.target.value)}
                placeholder="Appointment reminder"
              />
            </div>
            {callError && <p className="text-sm text-destructive">{callError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setComposeOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Phone className="mr-2 h-4 w-4" />}
                Start call
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
