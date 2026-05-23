"use client";

import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { normalizeContact, normalizeContactDetail } from "@/lib/normalize";
import { cn, formatPhone, timeAgo, formatDate, initials } from "@/lib/utils";
import {
  Users,
  Search,
  Plus,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Calendar,
  MapPin,
  Star,
  StarOff,
  Shield,
  ShieldOff,
  MessageSquare,
  Clock,
  Edit3,
  Trash2,
  Brain,
  ChevronRight,
  Loader2,
  X,
} from "lucide-react";

interface Memory {
  id: string;
  text: string;
  source: string;
  createdAt: string;
}

interface Call {
  id: string;
  contactName: string;
  phone: string;
  direction: string;
  status: string;
  duration: number;
  summary: string | null;
  startedAt: string;
  actions: Array<{
    id: string;
    type: string;
    description: string;
  }>;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  category: string;
  starred: boolean;
  doNotCall: boolean;
  notes: string | null;
  memoryCount: number;
  lastCall: string | null;
}

interface ContactDetail extends Contact {
  memories: Memory[];
  calls: Call[];
}

interface NewContactForm {
  name: string;
  phone: string;
  email: string;
  category: string;
}

function ContactCard({ contact, selected, onClick }: { contact: Contact; selected: boolean; onClick: () => void }) {
  const categoryColors: Record<string, string> = {
    Customer: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    Services: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    Vendor: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    Partner: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
    general: "bg-muted text-muted-foreground",
    Blocked: "bg-red-500/15 text-red-600 dark:text-red-400",
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50",
        selected ? "border-primary bg-accent/50" : "border-transparent"
      )}
    >
      <Avatar className="h-9 w-9">
        <AvatarFallback className={cn("text-xs", contact.category === "Blocked" && "bg-destructive/10 text-destructive")}>
          {initials(contact.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{contact.name}</span>
          {contact.starred && <Star className="h-3.5 w-3.5 fill-warning text-warning" />}
          {contact.doNotCall && <ShieldOff className="h-3.5 w-3.5 text-destructive" />}
        </div>
        <p className="text-xs text-muted-foreground">{formatPhone(contact.phone)}</p>
        <div className="mt-1 flex items-center gap-2">
          <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", categoryColors[contact.category] || "bg-muted text-muted-foreground")}>
            {contact.category}
          </span>
          <span className="text-[10px] text-muted-foreground">{contact.memoryCount} memories</span>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function ContactDetail({ contact, onRefresh }: { contact: ContactDetail; onRefresh: () => void }) {
  const [newMemory, setNewMemory] = useState("");
  const [savingMemory, setSavingMemory] = useState(false);

  const handleAddMemory = async () => {
    if (!newMemory.trim()) return;
    setSavingMemory(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}/memories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newMemory, source: "manual" }),
      });
      if (res.ok) {
        setNewMemory("");
        onRefresh();
      }
    } catch (err) {
      console.error("Error adding memory:", err);
    }
    setSavingMemory(false);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12">
            <AvatarFallback className="text-sm">{initials(contact.name)}</AvatarFallback>
          </Avatar>
          <div>
            <h2 className="text-lg font-bold">{contact.name}</h2>
            <p className="text-sm text-muted-foreground">{formatPhone(contact.phone)}</p>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant="outline">{contact.category}</Badge>
              {contact.doNotCall && <Badge variant="destructive">Do Not Call</Badge>}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Phone className="mr-1.5 h-3.5 w-3.5" />
            Call
          </Button>
          <Button variant="ghost" size="sm">
            <Edit3 className="mr-1.5 h-3.5 w-3.5" />
            Edit
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{contact.calls?.length || 0}</p>
            <p className="text-xs text-muted-foreground">Total Calls</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{contact.memories?.length || 0}</p>
            <p className="text-xs text-muted-foreground">Memories</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{contact.lastCall ? timeAgo(contact.lastCall) : "Never"}</p>
            <p className="text-xs text-muted-foreground">Last Call</p>
          </CardContent>
        </Card>
      </div>

      {/* Memory Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="h-4 w-4" />
              Agent Memory
            </CardTitle>
          </div>
          <CardDescription>Things the agent remembers about this contact</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {contact.memories && contact.memories.length > 0 ? (
            contact.memories.map((memory) => (
              <div key={memory.id} className="rounded-md border p-3">
                <p className="text-sm">{memory.text}</p>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">
                      {memory.source}
                    </Badge>
                    <span>{formatDate(memory.createdAt)}</span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No memories yet</p>
          )}

          {/* Add new memory */}
          <div className="flex gap-2">
            <Input
              placeholder="Add a memory the agent should know..."
              value={newMemory}
              onChange={(e) => setNewMemory(e.target.value)}
              className="text-sm"
            />
            <Button size="sm" onClick={handleAddMemory} disabled={savingMemory || !newMemory.trim()}>
              {savingMemory ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent Calls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Calls</CardTitle>
        </CardHeader>
        <CardContent>
          {contact.calls && contact.calls.length > 0 ? (
            <div className="space-y-2">
              {contact.calls.map((call) => (
                <div key={call.id} className="flex items-center gap-3 rounded-md border p-2.5">
                  {call.direction === "inbound" ? (
                    <PhoneIncoming className="h-4 w-4 text-success" />
                  ) : (
                    <PhoneOutgoing className="h-4 w-4 text-info" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {call.summary || `${call.direction === "inbound" ? "Received" : "Made"} call`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(call.startedAt)} &middot; {Math.floor(call.duration / 60)}m {call.duration % 60}s
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {call.status}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No calls yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<ContactDetail | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newContact, setNewContact] = useState<NewContactForm>({ name: "", phone: "", email: "", category: "general" });
  const [saving, setSaving] = useState(false);

  const fetchContacts = useCallback(async () => {
    try {
      const res = await fetch("/api/contacts");
      if (!res.ok) throw new Error("Failed to fetch contacts");
      const data = await res.json();
      setContacts(Array.isArray(data.contacts) ? data.contacts.map(normalizeContact) : []);
    } catch (err) {
      console.error("Error fetching contacts:", err);
    }
  }, []);

  const fetchContactDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/contacts/${id}`);
      if (!res.ok) throw new Error("Failed to fetch contact detail");
      const data = await res.json();
      setSelectedContact(data.contact ? normalizeContactDetail(data.contact) : null);
    } catch (err) {
      console.error("Error fetching contact detail:", err);
    }
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      await fetchContacts();
      setLoading(false);
    };
    fetchData();
  }, [fetchContacts]);

  useEffect(() => {
    if (selectedContact) {
      fetchContactDetail(selectedContact.id);
    }
  }, [selectedContact?.id, fetchContactDetail]);

  const filtered = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
  );

  const handleAddContact = async () => {
    if (!newContact.name.trim() || !newContact.phone.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newContact),
      });
      if (res.ok) {
        setShowAddModal(false);
        setNewContact({ name: "", phone: "", email: "", category: "general" });
        await fetchContacts();
      }
    } catch (err) {
      console.error("Error adding contact:", err);
    }
    setSaving(false);
  };

  const handleSelectContact = (contact: Contact) => {
    setSelectedContact(contact as unknown as ContactDetail);
    fetchContactDetail(contact.id);
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
            <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
            <p className="text-sm text-muted-foreground">Manage contacts and agent memory</p>
          </div>
          <Button className="w-full sm:w-auto" onClick={() => setShowAddModal(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Contact
          </Button>
        </div>

        {/* Add Contact Modal */}
        {showAddModal && (
          <Card className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <Card className="w-full max-w-md mx-4">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Add Contact</CardTitle>
                  <Button variant="ghost" size="icon-sm" onClick={() => setShowAddModal(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name *</label>
                  <Input
                    value={newContact.name}
                    onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                    placeholder="Customer name"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Phone *</label>
                  <Input
                    value={newContact.phone}
                    onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                    placeholder="+1 555 010 1234"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Email</label>
                  <Input
                    value={newContact.email}
                    onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                    placeholder="customer@email.com"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Category</label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                    value={newContact.category}
                    onChange={(e) => setNewContact({ ...newContact, category: e.target.value })}
                  >
                    <option value="general">General</option>
                    <option value="Customer">Customer</option>
                    <option value="Partner">Partner</option>
                    <option value="Services">Services</option>
                    <option value="Vendor">Vendor</option>
                    <option value="Blocked">Blocked</option>
                  </select>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" onClick={() => setShowAddModal(false)} className="flex-1">
                    Cancel
                  </Button>
                  <Button onClick={handleAddContact} disabled={saving || !newContact.name.trim() || !newContact.phone.trim()} className="flex-1">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Contact"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Card>
        )}

        {/* Mobile: stacked layout, Desktop: side-by-side */}
        <div className="flex flex-col md:flex-row gap-6">
          {/* Contact list */}
          <div className="md:w-80 md:shrink-0">
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search contacts..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {/* On mobile, limit height and allow scroll */}
            <div className="max-h-[40vh] overflow-y-auto md:max-h-none space-y-1">
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No contacts found</p>
              ) : (
                filtered.map((contact) => (
                  <ContactCard
                    key={contact.id}
                    contact={contact}
                    selected={selectedContact?.id === contact.id}
                    onClick={() => handleSelectContact(contact)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Contact detail */}
          <div className="flex-1">
            {selectedContact ? (
              <ContactDetail 
                contact={selectedContact} 
                onRefresh={() => fetchContactDetail(selectedContact.id)} 
              />
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <Users className="h-12 w-12 text-muted-foreground/50" />
                  <p className="mt-4 text-sm text-muted-foreground">Select a contact to view details</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}