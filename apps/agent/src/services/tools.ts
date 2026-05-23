import twilio from 'twilio';
import { prisma } from './prisma';
import { config } from '../config';
import { getServiceSuggestions } from './agent-profile';
import { getRuntimeSnapshot } from './runtime-config';
import { searchExternalKnowledge as runExternalKnowledgeSearch } from './connectors/web-search';
import { redactPhone, safeLogFields } from './safe-log';
import type { ToolResult } from '../types';

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

function clampLimit(value: number | undefined, fallback: number, max = 10): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(value as number)));
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildExcerpt(text: string, query?: string, maxLength = 180): string {
  const clean = compactWhitespace(text);
  if (clean.length <= maxLength) {
    return clean;
  }

  if (!query) {
    return `${clean.slice(0, maxLength - 1)}…`;
  }

  const lowerClean = clean.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerClean.indexOf(lowerQuery);
  if (index === -1) {
    return `${clean.slice(0, maxLength - 1)}…`;
  }

  const start = Math.max(0, index - Math.floor(maxLength / 3));
  const end = Math.min(clean.length, start + maxLength);
  const excerpt = clean.slice(start, end);
  return `${start > 0 ? '…' : ''}${excerpt}${end < clean.length ? '…' : ''}`;
}

export class ToolService {
  private readonly orgId: string;

  constructor(orgId = config.deployment?.defaultOrgId ?? 'default') {
    this.orgId = orgId;
  }

  private smsClient = config.twilio.accountSid && config.twilio.authToken
    ? twilio(config.twilio.accountSid, config.twilio.authToken)
    : null;

  private async ensureContact(params: {
    name?: string;
    phone: string;
    category?: string;
  }) {
    const phone = normalizePhone(params.phone);
    const existing = await prisma.contact.findUnique({
      where: { orgId_phone: { orgId: this.orgId, phone } },
    });

    if (existing) {
      if (params.name && existing.name !== params.name) {
        return prisma.contact.update({
          where: { id_orgId: { id: existing.id, orgId: this.orgId } },
          data: { name: params.name },
        });
      }
      return existing;
    }

    return prisma.contact.create({
      data: {
        orgId: this.orgId,
        name: params.name || 'Unknown Customer',
        phone,
        category: params.category || 'customer',
      },
    });
  }

  private async logContactMemory(contactId: string, text: string, source = 'voice-agent') {
    await prisma.memory.create({
      data: {
        contactId,
        text,
        source,
      },
    });
  }

  private async notify(type: string, title: string, body: string) {
    await prisma.notification.create({
      data: {
        orgId: this.orgId,
        type,
        title,
        body,
      },
    });
  }

  async bookAppointment(params: {
    customerName: string;
    phone?: string;
    service: string;
    staffMember?: string;
    date: string;
    time: string;
    reason: string;
    language?: string;
    callId?: string;
  }): Promise<ToolResult> {
    console.log('[Tool] Booking appointment', safeLogFields({
      customerName: params.customerName,
      phone: params.phone,
      service: params.service,
      date: params.date,
      time: params.time,
      reason: params.reason,
      callId: params.callId,
    }));

    if (!params.phone) {
      return { success: false, message: 'Phone number is required to book an appointment' };
    }

    const contact = await this.ensureContact({
      name: params.customerName,
      phone: params.phone,
      category: 'customer',
    });

    const suggestions = getServiceSuggestions(params.service);

    // Create a structured appointment record
    await prisma.appointment.create({
      data: {
        orgId: this.orgId,
        contactId: contact.id,
        customerName: params.customerName,
        phone: normalizePhone(params.phone),
        service: params.service,
        staffMember: params.staffMember || null,
        date: params.date,
        time: params.time,
        reason: params.reason,
        status: 'confirmed',
        source: 'voice-agent',
        notes: suggestions.length > 0 ? `Alternate slots: ${suggestions.join(', ')}` : null,
        callId: params.callId || null,
      },
    });

    const note = [
      `Appointment booked for ${params.customerName}`,
      `Service: ${params.service}`,
      params.staffMember ? `Staff Member: ${params.staffMember}` : null,
      `Date: ${params.date}`,
      `Time: ${params.time}`,
      `Reason: ${params.reason}`,
      params.language ? `Language: ${params.language}` : null,
      suggestions.length > 0 ? `Suggested alternate slots: ${suggestions.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(' | ');

    await this.logContactMemory(contact.id, note, 'appointment');
    await this.notify(
      'appointment',
      `Appointment booked for ${params.customerName}`,
      `${params.service} on ${params.date} at ${params.time}`,
    );

    return {
      success: true,
      message:
        `Appointment booked for ${params.customerName} in ${params.service} on ${params.date} at ${params.time}${params.staffMember ? ` with  ${params.staffMember}` : ''}.` +
        (suggestions.length > 0 ? ` Alternate slots: ${suggestions.join(', ')}` : ''),
      data: { contactId: contact.id, alternateSlots: suggestions },
    };
  }

  async rescheduleAppointment(params: {
    phone: string;
    customerName?: string;
    currentDate?: string;
    newDate: string;
    newTime: string;
    service?: string;
    reason?: string;
  }): Promise<ToolResult> {
    const contact = await this.ensureContact({
      name: params.customerName,
      phone: params.phone,
      category: 'customer',
    });

    // Try to find the most recent confirmed appointment for this customer
    const existingAppt = await prisma.appointment.findFirst({
      where: {
        orgId: this.orgId,
        phone: normalizePhone(params.phone),
        status: 'confirmed',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingAppt) {
      await prisma.appointment.update({
        where: { id_orgId: { id: existingAppt.id, orgId: this.orgId } },
        data: {
          date: params.newDate,
          time: params.newTime,
          service: params.service || existingAppt.service,
          status: 'rescheduled',
          notes: `Rescheduled from ${existingAppt.date} ${existingAppt.time} to ${params.newDate} ${params.newTime}${params.reason ? `. Reason: ${params.reason}` : ''}`,
        },
      });
    } else {
      // No existing record, create a rescheduled one
      await prisma.appointment.create({
        data: {
          orgId: this.orgId,
          contactId: contact.id,
          customerName: params.customerName || contact.name,
          phone: normalizePhone(params.phone),
          service: params.service || 'General Service',
          date: params.newDate,
          time: params.newTime,
          reason: params.reason || 'Rescheduled appointment',
          status: 'rescheduled',
          source: 'voice-agent',
          notes: `Rescheduled${params.currentDate ? ` from ${params.currentDate}` : ''}`,
        },
      });
    }

    await this.logContactMemory(
      contact.id,
      `Appointment rescheduled${params.currentDate ? ` from ${params.currentDate}` : ''} to ${params.newDate} at ${params.newTime}${params.service ? ` for ${params.service}` : ''}${params.reason ? `. Reason: ${params.reason}` : ''}`,
      'appointment',
    );
    await this.notify(
      'appointment',
      `Appointment rescheduled for ${contact.name}`,
      `${params.newDate} at ${params.newTime}`,
    );

    return {
      success: true,
      message: `Rescheduled appointment to ${params.newDate} at ${params.newTime}.`,
      data: { contactId: contact.id },
    };
  }

  async cancelAppointment(params: {
    phone: string;
    customerName?: string;
    date?: string;
    reason?: string;
  }): Promise<ToolResult> {
    const contact = await this.ensureContact({
      name: params.customerName,
      phone: params.phone,
      category: 'customer',
    });

    // Mark matching appointment as cancelled
    const where: Record<string, unknown> = {
      orgId: this.orgId,
      phone: normalizePhone(params.phone),
      status: 'confirmed',
    };
    if (params.date) where.date = params.date;

    const existingAppt = await prisma.appointment.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
    });

    if (existingAppt) {
      await prisma.appointment.update({
        where: { id_orgId: { id: existingAppt.id, orgId: this.orgId } },
        data: {
          status: 'cancelled',
          notes: `Cancelled${params.reason ? `. Reason: ${params.reason}` : ''}`,
        },
      });
    }

    await this.logContactMemory(
      contact.id,
      `Appointment cancelled${params.date ? ` for ${params.date}` : ''}${params.reason ? `. Reason: ${params.reason}` : ''}`,
      'appointment',
    );
    await this.notify(
      'appointment',
      `Appointment cancelled for ${contact.name}`,
      params.date ? `Cancelled for ${params.date}` : 'Cancelled during live call',
    );

    return {
      success: true,
      message: `Cancelled${params.date ? ` the appointment on ${params.date}` : ' the appointment'} for ${contact.name}.`,
      data: { contactId: contact.id },
    };
  }

  async searchPeopleMemory(query: string, phone?: string, limit?: number): Promise<ToolResult> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery && !phone) {
      return { success: false, message: 'A name, phone number, or topic is required' };
    }

    const normalizedPhone = phone ? normalizePhone(phone) : undefined;
    const resultLimit = clampLimit(limit, 3, 8);

    try {
      const contacts = await prisma.contact.findMany({
        where: {
          orgId: this.orgId,
          AND: [
            normalizedPhone
              ? {
                  OR: [{ phone: normalizedPhone }, { phone: { contains: normalizedPhone } }],
                }
              : {},
            trimmedQuery
              ? {
                  OR: [
                    { name: { contains: trimmedQuery } },
                    { phone: { contains: trimmedQuery } },
                    { notes: { contains: trimmedQuery } },
                    { memories: { some: { text: { contains: trimmedQuery } } } },
                  ],
                }
              : {},
          ],
        },
        include: {
          memories: {
            orderBy: { createdAt: 'desc' },
            take: 3,
          },
          appointments: {
            orderBy: { createdAt: 'desc' },
            take: 2,
          },
          calls: {
            orderBy: { startedAt: 'desc' },
            take: 2,
          },
        },
        take: resultLimit,
      });

      if (contacts.length === 0) {
        return { success: false, message: 'No matching people or memories found' };
      }

      const contactSummaries = contacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        category: contact.category,
        notes: contact.notes || null,
        memorySnippets: contact.memories.map((memory) => buildExcerpt(memory.text, trimmedQuery || undefined)),
        recentAppointments: contact.appointments.map((appointment) => ({
          id: appointment.id,
          service: appointment.service,
          date: appointment.date,
          time: appointment.time,
          status: appointment.status,
        })),
        recentCalls: contact.calls.map((call) => ({
          id: call.id,
          summary: call.summary,
          outcome: call.outcome,
          status: call.status,
          startedAt: call.startedAt,
        })),
      }));

      return {
        success: true,
        message: `Found ${contacts.length} matching contact${contacts.length === 1 ? '' : 's'}: ${contacts.map((contact) => contact.name).join(', ')}`,
        data: {
          contacts: contactSummaries,
        },
      };
    } catch (error) {
      console.error('[Tool] Error searching people memory:', error);
      return { success: false, message: 'Error searching people memory' };
    }
  }

  async getRecentCallHistory(params: {
    phone?: string;
    customerName?: string;
    limit?: number;
  }): Promise<ToolResult> {
    if (!params.phone && !params.customerName) {
      return { success: false, message: 'A phone number or customer name is required' };
    }

    const normalizedPhone = params.phone ? normalizePhone(params.phone) : undefined;
    const resultLimit = clampLimit(params.limit, 3, 8);
    const callFilters: Record<string, unknown>[] = [];
    const appointmentFilters: Record<string, unknown>[] = [];

    if (normalizedPhone) {
      callFilters.push({ phone: normalizedPhone });
      appointmentFilters.push({ phone: normalizedPhone });
    }

    if (params.customerName) {
      callFilters.push({ contactName: { contains: params.customerName } });
      appointmentFilters.push({ customerName: { contains: params.customerName } });
    }

    try {
      const calls = (await prisma.call.findMany({
        where: { orgId: this.orgId, OR: callFilters },
        include: {
          actions: {
            orderBy: { createdAt: 'desc' },
            take: 3,
          },
          appointment: true,
        },
        orderBy: { startedAt: 'desc' },
        take: resultLimit,
      })) as Array<any>;
      const appointments = (await prisma.appointment.findMany({
        where: { orgId: this.orgId, OR: appointmentFilters },
        orderBy: { createdAt: 'desc' },
        take: resultLimit,
      })) as Array<any>;

      if (calls.length === 0 && appointments.length === 0) {
        return { success: false, message: 'No recent call or appointment history found' };
      }

      return {
        success: true,
        message: `Found ${calls.length} recent call${calls.length === 1 ? '' : 's'} and ${appointments.length} appointment${appointments.length === 1 ? '' : 's'}`,
        data: {
          calls: calls.map((call) => ({
            id: call.id,
            contactName: call.contactName,
            phone: call.phone,
            direction: call.direction,
            status: call.status,
            duration: call.duration,
            summary: call.summary,
            outcome: call.outcome,
            startedAt: call.startedAt,
            actions: call.actions.map((action: any) => ({
              type: action.type,
              description: action.description,
              createdAt: action.createdAt,
            })),
          })),
          appointments: appointments.map((appointment) => ({
            id: appointment.id,
            customerName: appointment.customerName,
            service: appointment.service,
            staffMember: appointment.staffMember,
            date: appointment.date,
            time: appointment.time,
            status: appointment.status,
            reason: appointment.reason,
          })),
        },
      };
    } catch (error) {
      console.error('[Tool] Error loading recent call history:', error);
      return { success: false, message: 'Error loading recent call history' };
    }
  }

  async lookupServiceDirectory(query: string): Promise<ToolResult> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return { success: false, message: 'A service or service query is required' };
    }

    try {
      const runtime = await getRuntimeSnapshot(this.orgId);
      const lowerQuery = trimmedQuery.toLowerCase();
      const matchingDocs = runtime.knowledgeDocs
        .map((doc) => ({
          name: doc.name,
          excerpt: buildExcerpt(doc.content || '', trimmedQuery),
          content: doc.content || '',
        }))
        .filter((doc) => doc.content.toLowerCase().includes(lowerQuery) || doc.name.toLowerCase().includes(lowerQuery))
        .slice(0, 5)
        .map(({ name, excerpt }) => ({ name, excerpt }));

      if (matchingDocs.length === 0) {
        return {
          success: false,
          message: 'No matching service or service details found in the saved directory',
          data: {
            businessName: runtime.config.businessName,
            receptionNumber: runtime.config.receptionNumber,
            urgentTransferNumber: runtime.config.urgentTransferNumber,
          },
        };
      }

      return {
        success: true,
        message: `Found ${matchingDocs.length} saved directory match${matchingDocs.length === 1 ? '' : 'es'} for ${trimmedQuery}`,
        data: {
          businessName: runtime.config.businessName,
          businessLocation: runtime.config.businessLocation,
          receptionNumber: runtime.config.receptionNumber,
          urgentTransferNumber: runtime.config.urgentTransferNumber,
          matches: matchingDocs,
        },
      };
    } catch (error) {
      console.error('[Tool] Error looking up service directory:', error);
      return { success: false, message: 'Error looking up service directory' };
    }
  }

  async collectCallbackRequest(params: {
    topic: string;
    phone?: string;
    customerName?: string;
    preferredDate?: string;
    preferredTime?: string;
    note?: string;
  }): Promise<ToolResult> {
    const topic = params.topic.trim();
    if (!topic) {
      return { success: false, message: 'A callback topic is required' };
    }

    try {
      const contact = params.phone
        ? await this.ensureContact({
            name: params.customerName,
            phone: params.phone,
            category: 'customer',
          })
        : null;

      const callbackSummary = [
        `Callback requested about ${topic}`,
        params.preferredDate ? `Preferred date: ${params.preferredDate}` : null,
        params.preferredTime ? `Preferred time: ${params.preferredTime}` : null,
        params.note ? `Note: ${params.note}` : null,
      ]
        .filter(Boolean)
        .join(' | ');

      if (contact) {
        await this.logContactMemory(contact.id, callbackSummary, 'callback');
      }

      await this.notify(
        'callback_request',
        `Callback requested${contact ? ` for ${contact.name}` : ''}`,
        [
          params.phone ? `Phone: ${normalizePhone(params.phone)}` : null,
          callbackSummary,
        ]
          .filter(Boolean)
          .join(' | '),
      );

      return {
        success: true,
        message: `Callback request captured${contact ? ` for ${contact.name}` : ''}`,
        data: {
          contactId: contact?.id,
          topic,
          preferredDate: params.preferredDate || null,
          preferredTime: params.preferredTime || null,
        },
      };
    } catch (error) {
      console.error('[Tool] Error collecting callback request:', error);
      return { success: false, message: 'Error collecting callback request' };
    }
  }

  async sendSMS(to: string, message: string): Promise<ToolResult> {
    const phone = normalizePhone(to);
    console.log('[Tool] Sending SMS', { to: redactPhone(phone), message: '[redacted]' });

    if (!this.smsClient || !config.twilio.phoneNumber) {
      return {
        success: true,
        message: 'SMS queued in simulation mode',
        data: { simulated: true, to: phone, message },
      };
    }

    try {
      const sms = await this.smsClient.messages.create({
        to: phone,
        from: config.twilio.phoneNumber,
        body: message,
      });

      return {
        success: true,
        message: `SMS sent successfully to ${phone}`,
        data: { sid: sms.sid },
      };
    } catch (error) {
      console.error('[Tool] Error sending SMS:', error);
      return { success: false, message: 'Error sending SMS' };
    }
  }

  async lookupContact(phone: string): Promise<ToolResult> {
    const normalizedPhone = normalizePhone(phone);
    console.log('[Tool] Looking up customer', { phone: redactPhone(normalizedPhone) });
    try {
      const contact = await prisma.contact.findUnique({
        where: { orgId_phone: { orgId: this.orgId, phone: normalizedPhone } },
        include: { memories: true },
      });

      if (!contact) {
        return { success: false, message: 'Customer not found' };
      }

      return {
        success: true,
        message: `Found customer: ${contact.name}`,
        data: contact,
      };
    } catch (error) {
      console.error('[Tool] Error looking up customer:', error);
      return { success: false, message: 'Error looking up customer' };
    }
  }

  async transferCall(callId: string, to: string): Promise<ToolResult> {
    console.log('[Tool] Transferring call', { callId, to: redactPhone(to) });
    await this.notify('transfer', 'Live call transfer requested', `Call ${callId} to ${to}`);
    return { success: true, message: `Call transferred to ${to}` };
  }

  async blockNumber(phone: string, reason: string): Promise<ToolResult> {
    const normalizedPhone = normalizePhone(phone);
    console.log('[Tool] Blocking number', { phone: redactPhone(normalizedPhone), reason: '[redacted]' });
    try {
      await prisma.blockedNumber.upsert({
        where: { orgId_phone: { orgId: this.orgId, phone: normalizedPhone } },
        update: { reason },
        create: { orgId: this.orgId, phone: normalizedPhone, reason },
      });
      return { success: true, message: `Number ${normalizedPhone} blocked: ${reason}` };
    } catch (error) {
      console.error('[Tool] Error blocking number:', error);
      return { success: false, message: 'Error blocking number' };
    }
  }

  async searchKnowledge(query: string): Promise<ToolResult> {
    console.log('[Tool] Searching knowledge base', { query: '[redacted]' });
    try {
      const docs = await prisma.knowledgeDoc.findMany({
        where: {
          orgId: this.orgId,
          OR: [
            { name: { contains: query } },
            { content: { contains: query } },
          ],
        },
        take: 5,
      });

      if (docs.length === 0) {
        return { success: false, message: 'No relevant information found' };
      }

      return {
        success: true,
        message: `Found ${docs.length} relevant document(s)`,
        data: docs.map((doc: { id: string; name: string; content: string | null }) => ({
          id: doc.id,
          name: doc.name,
          content: doc.content,
          excerpt: buildExcerpt(doc.content || '', query),
        })),
      };
    } catch (error) {
      console.error('[Tool] Error searching knowledge base:', error);
      return { success: false, message: 'Error searching knowledge base' };
    }
  }

  async searchExternalKnowledge(query: string): Promise<ToolResult> {
    console.log('[Tool] Searching external knowledge', { query: '[redacted]' });
    return runExternalKnowledgeSearch(query);
  }

  async scheduleFollowUp(contactIdOrPhone: string, date: string, note: string): Promise<ToolResult> {
    console.log('[Tool] Scheduling follow-up', {
      contact: redactPhone(contactIdOrPhone),
      date,
      note: '[redacted]',
    });
    try {
      let contactId = contactIdOrPhone;
      const looksLikePhone = /\+?\d[\d\s()-]{6,}/.test(contactIdOrPhone);
      if (looksLikePhone) {
        const contact = await this.ensureContact({ phone: contactIdOrPhone, category: 'customer' });
        contactId = contact.id;
      }

      await prisma.memory.create({
        data: {
          contactId,
          text: `Follow-up scheduled for ${date}: ${note}`,
          source: 'follow-up',
        },
      });
      await this.notify('follow-up', 'Follow-up scheduled', `${date}: ${note}`);
      return { success: true, message: 'Follow-up scheduled' };
    } catch (error) {
      console.error('[Tool] Error scheduling follow-up:', error);
      return { success: false, message: 'Error scheduling follow-up' };
    }
  }

  async logMarketingInterest(params: {
    phone: string;
    customerName?: string;
    campaign: string;
    interestLevel?: string;
    note?: string;
    doNotCall?: boolean;
  }): Promise<ToolResult> {
    const contact = await this.ensureContact({
      name: params.customerName,
      phone: params.phone,
      category: 'marketing',
    });

    if (params.doNotCall) {
      await prisma.contact.update({
        where: { id_orgId: { id: contact.id, orgId: this.orgId } },
        data: { doNotCall: true },
      });
    }

    await this.logContactMemory(
      contact.id,
      `Campaign: ${params.campaign} | Interest: ${params.interestLevel || 'unknown'}${params.note ? ` | Note: ${params.note}` : ''}${params.doNotCall ? ' | Do not call requested' : ''}`,
      'marketing',
    );

    return {
      success: true,
      message: params.doNotCall
        ? `Logged do-not-call request for ${contact.name}.`
        : `Logged ${params.interestLevel || 'interested'} response for ${params.campaign}.`,
      data: { contactId: contact.id },
    };
  }

  async checkBlocked(phone: string): Promise<boolean> {
    try {
      const blocked = await prisma.blockedNumber.findUnique({
        where: { orgId_phone: { orgId: this.orgId, phone: normalizePhone(phone) } },
      });
      return !!blocked;
    } catch {
      return false;
    }
  }

  getAvailableTools() {
    return [
      { id: 'book_appointment', name: 'Book Appointment', enabled: true },
      { id: 'reschedule_appointment', name: 'Reschedule Appointment', enabled: true },
      { id: 'cancel_appointment', name: 'Cancel Appointment', enabled: true },
      { id: 'search_people_memory', name: 'People Memory Search', enabled: true },
      { id: 'get_recent_call_history', name: 'Recent Call History', enabled: true },
      { id: 'lookup_service_directory', name: 'Service Directory', enabled: true },
      { id: 'collect_callback_request', name: 'Callback Capture', enabled: true },
      { id: 'search_external_knowledge', name: 'External Knowledge Search', enabled: !!config.externalSearch.provider },
      { id: 'send_sms', name: 'Send SMS', enabled: true },
      { id: 'lookup_contact', name: 'Contact Lookup', enabled: true },
      { id: 'transfer_call', name: 'Transfer Call', enabled: true },
      { id: 'block_number', name: 'Block Number', enabled: true },
      { id: 'search_knowledge', name: 'Knowledge Base', enabled: true },
      { id: 'schedule_followup', name: 'Schedule Follow-up', enabled: true },
      { id: 'log_marketing_interest', name: 'Log Marketing Interest', enabled: true },
    ];
  }
}
