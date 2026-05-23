"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Calendar,
  Clock,
  User,
  Phone,
  Building2,
  Stethoscope,
  MessageSquare,
  CheckCircle2,
  XCircle,
  RotateCcw,
  CalendarClock,
  Plus,
  Filter,
  Search,
  Loader2,
  ChevronRight,
  AlertCircle,
  RefreshCw,
  X,
  Edit3,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Appointment = {
  id: string;
  customerName: string;
  phone: string;
  service: string;
  staffMember: string | null;
  date: string;
  time: string;
  reason: string;
  status: string;
  source: string;
  notes: string | null;
  contactId: string | null;
  contact?: { id: string; name: string; phone: string } | null;
  callId?: string | null;
  createdAt: string;
  updatedAt: string;
};

type Summary = {
  total: number;
  confirmed: number;
  rescheduled: number;
  cancelled: number;
  completed: number;
  today: number;
};

function statusBadge(status: string) {
  switch (status) {
    case "confirmed":
      return <Badge variant="success">Confirmed</Badge>;
    case "rescheduled":
      return <Badge variant="secondary">Rescheduled</Badge>;
    case "cancelled":
      return <Badge variant="destructive">Cancelled</Badge>;
    case "completed":
      return <Badge variant="success">Completed</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function statusIcon(status: string) {
  switch (status) {
    case "confirmed":
      return <CheckCircle2 className="h-5 w-5 text-success" />;
    case "rescheduled":
      return <RotateCcw className="h-5 w-5 text-warning" />;
    case "cancelled":
      return <XCircle className="h-5 w-5 text-destructive" />;
    case "completed":
      return <CheckCircle2 className="h-5 w-5 text-success" />;
    default:
      return <AlertCircle className="h-5 w-5 text-muted-foreground" />;
  }
}

function formatDate(dateStr: string) {
  if (!dateStr) return "TBD";
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, confirmed: 0, rescheduled: 0, cancelled: 0, completed: 0, today: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newAppt, setNewAppt] = useState({ customerName: "", phone: "", service: "General Service", staffMember: "", date: "", time: "", reason: "" });

  const fetchAppointments = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/appointments?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAppointments(Array.isArray(data.appointments) ? data.appointments : []);
        if (data.summary) setSummary(data.summary);
      }
    } catch {
      // silently fail
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchAppointments();
    const interval = setInterval(fetchAppointments, 30000);
    return () => clearInterval(interval);
  }, [fetchAppointments]);

  const filtered = appointments.filter((a) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.customerName.toLowerCase().includes(q) ||
      a.phone.includes(q) ||
      a.service.toLowerCase().includes(q) ||
      (a.staffMember && a.staffMember.toLowerCase().includes(q))
    );
  });

  const selected = selectedId ? appointments.find((a) => a.id === selectedId) : null;

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setAppointments((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a))
        );
      }
    } catch {
      // silently fail
    }
  };

  const handleCreate = async () => {
    if (!newAppt.customerName || !newAppt.phone || !newAppt.date || !newAppt.time) return;
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAppt),
      });
      if (res.ok) {
        setShowNewForm(false);
        setNewAppt({ customerName: "", phone: "", service: "General Service", staffMember: "", date: "", time: "", reason: "" });
        fetchAppointments();
      }
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

  const filterButtons = [
    { key: "all", label: "All", count: summary.total },
    { key: "confirmed", label: "Confirmed", count: summary.confirmed },
    { key: "rescheduled", label: "Rescheduled", count: summary.rescheduled },
    { key: "completed", label: "Completed", count: summary.completed },
    { key: "cancelled", label: "Cancelled", count: summary.cancelled },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Appointments</h1>
            <p className="text-sm text-muted-foreground">Manage customer appointments and follow-ups</p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Button variant="outline" size="sm" onClick={fetchAppointments}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button className="w-full sm:w-auto" onClick={() => setShowNewForm(!showNewForm)}>
              <Plus className="mr-2 h-4 w-4" />
              New Appointment
            </Button>
          </div>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => setStatusFilter("all")}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Total</span>
              </div>
              <p className="mt-1 text-2xl font-bold">{summary.total}</p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => setStatusFilter("confirmed")}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="text-xs text-muted-foreground">Confirmed</span>
              </div>
              <p className="mt-1 text-2xl font-bold text-success">{summary.confirmed}</p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => setStatusFilter("rescheduled")}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-warning" />
                <span className="text-xs text-muted-foreground">Rescheduled</span>
              </div>
              <p className="mt-1 text-2xl font-bold text-warning">{summary.rescheduled}</p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => setStatusFilter("completed")}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Completed</span>
              </div>
              <p className="mt-1 text-2xl font-bold">{summary.completed}</p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:bg-accent/50 transition-colors col-span-2 sm:col-span-1" onClick={() => setStatusFilter("cancelled")}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-destructive" />
                <span className="text-xs text-muted-foreground">Cancelled</span>
              </div>
              <p className="mt-1 text-2xl font-bold text-destructive">{summary.cancelled}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filter and search bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
            {filterButtons.map((f) => (
              <Button
                key={f.key}
                variant={statusFilter === f.key ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(f.key)}
              >
                {f.label}
                {f.count > 0 && (
                  <span className="ml-1.5 text-xs opacity-70">({f.count})</span>
                )}
              </Button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, phone, service..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full pl-8 text-sm sm:w-64"
            />
          </div>
        </div>

        {/* New appointment form */}
        {showNewForm && (
          <Card className="border-primary/30">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">New Appointment</CardTitle>
                <Button variant="ghost" size="icon-sm" onClick={() => setShowNewForm(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Customer Name *</label>
                  <Input
                    value={newAppt.customerName}
                    onChange={(e) => setNewAppt({ ...newAppt, customerName: e.target.value })}
                    placeholder="Customer name"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Phone *</label>
                  <Input
                    value={newAppt.phone}
                    onChange={(e) => setNewAppt({ ...newAppt, phone: e.target.value })}
                    placeholder="+1 555 010 1234"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Service</label>
                  <Input
                    value={newAppt.service}
                    onChange={(e) => setNewAppt({ ...newAppt, service: e.target.value })}
                    placeholder="General Service"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Staff Member</label>
                  <Input
                    value={newAppt.staffMember}
                    onChange={(e) => setNewAppt({ ...newAppt, staffMember: e.target.value })}
                    placeholder=" Name (optional)"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Date *</label>
                  <Input
                    type="date"
                    value={newAppt.date}
                    onChange={(e) => setNewAppt({ ...newAppt, date: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Time *</label>
                  <Input
                    type="time"
                    value={newAppt.time}
                    onChange={(e) => setNewAppt({ ...newAppt, time: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                  <label className="text-xs font-medium text-muted-foreground">Reason</label>
                  <Input
                    value={newAppt.reason}
                    onChange={(e) => setNewAppt({ ...newAppt, reason: e.target.value })}
                    placeholder="Reason for visit"
                  />
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowNewForm(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={!newAppt.customerName || !newAppt.phone || !newAppt.date || !newAppt.time}>
                  <CalendarClock className="mr-2 h-4 w-4" />
                  Book Appointment
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Detail panel */}
        {selected && (
          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {statusIcon(selected.status)}
                  <div>
                    <CardTitle className="text-base">{selected.customerName}</CardTitle>
                    <CardDescription>
                      {selected.service} {selected.staffMember ? `with  ${selected.staffMember}` : ""}
                    </CardDescription>
                  </div>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => setSelectedId(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" /> Date
                  </div>
                  <p className="mt-1 text-sm font-medium">{formatDate(selected.date)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" /> Time
                  </div>
                  <p className="mt-1 text-sm font-medium">{selected.time}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" /> Phone
                  </div>
                  <p className="mt-1 text-sm font-medium">{selected.phone}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" /> Service
                  </div>
                  <p className="mt-1 text-sm font-medium">{selected.service}</p>
                </div>
              </div>

              {selected.reason && (
                <div className="mt-4 rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <MessageSquare className="h-3.5 w-3.5" /> Reason
                  </div>
                  <p className="mt-1 text-sm">{selected.reason}</p>
                </div>
              )}

              {selected.notes && (
                <div className="mt-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  {selected.notes}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Source: {selected.source}</span>
                  <span>|</span>
                  <span>Created: {new Date(selected.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex gap-2">
                  {selected.status === "confirmed" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => handleStatusChange(selected.id, "completed")}>
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                        Complete
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleStatusChange(selected.id, "cancelled")}>
                        <XCircle className="mr-1.5 h-3.5 w-3.5" />
                        Cancel
                      </Button>
                    </>
                  )}
                  {selected.status === "rescheduled" && (
                    <Button size="sm" variant="outline" onClick={() => handleStatusChange(selected.id, "confirmed")}>
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      Confirm
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Appointments list */}
        <div className="space-y-3">
          {filtered.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <CalendarClock className="h-12 w-12 text-muted-foreground/30" />
                <p className="mt-4 text-sm font-medium text-muted-foreground">
                  {statusFilter === "all" ? "No appointments yet" : `No ${statusFilter} appointments`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Appointments booked through voice calls will appear here automatically
                </p>
                <Button variant="outline" className="mt-4" onClick={() => setShowNewForm(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create First Appointment
                </Button>
              </CardContent>
            </Card>
          ) : (
            filtered.map((appt) => (
              <Card
                key={appt.id}
                className={cn(
                  "cursor-pointer transition-colors hover:bg-accent/50",
                  selectedId === appt.id && "ring-2 ring-primary/30"
                )}
                onClick={() => setSelectedId(selectedId === appt.id ? null : appt.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">{statusIcon(appt.status)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{appt.customerName}</span>
                        {statusBadge(appt.status)}
                        {appt.source === "voice-agent" && (
                          <Badge variant="outline" className="text-[10px]">Voice</Badge>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(appt.date)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {appt.time}
                        </span>
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {appt.service}
                        </span>
                        {appt.staffMember && (
                          <span className="flex items-center gap-1">
                            <Stethoscope className="h-3 w-3" />
                             {appt.staffMember}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {appt.phone}
                        </span>
                      </div>
                      {appt.reason && (
                        <p className="mt-1.5 line-clamp-1 text-xs text-muted-foreground">{appt.reason}</p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </AppLayout>
  );
}
