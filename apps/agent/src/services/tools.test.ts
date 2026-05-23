import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    contact: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    memory: {
      create: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    call: {
      findMany: vi.fn(),
    },
    appointment: {
      findMany: vi.fn(),
    },
    knowledgeDoc: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('./prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    messages: { create: vi.fn() },
  })),
}));

vi.mock('../config', () => ({
  config: {
    twilio: {
      accountSid: '',
      authToken: '',
      phoneNumber: '',
    },
    business: {
      name: 'Example Business',
      location: 'Example City',
      receptionNumber: '+15551234567',
      urgentTransferNumber: '+15551234567',
    },
  },
}));

vi.mock('./runtime-config', () => ({
  getRuntimeSnapshot: vi.fn(async () => ({
    config: {
      businessName: 'Example Business',
      businessLocation: 'Example City',
      receptionNumber: '+15551234567',
      urgentTransferNumber: '+15551234567',
    },
    tools: [],
    knowledgeDocs: [
      {
        id: 'doc-1',
        name: 'Services.md',
        content: 'Customer Support\nBilling Support\nUrgent transfer: +15551234567',
      },
    ],
  })),
}));

import { ToolService } from './tools';

describe('ToolService smart routing tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('searches people memory across contacts and stored notes', async () => {
    prismaMock.contact.findMany.mockResolvedValue([
      {
        id: 'contact-1',
        name: 'Asha',
        phone: '+15550109999',
        category: 'customer',
        notes: 'Prefers morning calls',
        starred: false,
        doNotCall: false,
        memories: [
          {
            id: 'memory-1',
            text: 'Asked about customer support',
            source: 'voice-agent',
            createdAt: new Date('2026-04-10T10:00:00Z'),
          },
        ],
        appointments: [],
        calls: [],
      },
    ]);

    const result = await new ToolService().searchPeopleMemory('support');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      contacts: [
        expect.objectContaining({
          name: 'Asha',
          phone: '+15550109999',
        }),
      ],
    });
  });

  it('summarizes recent call history and appointments for a caller', async () => {
    prismaMock.call.findMany.mockResolvedValue([
      {
        id: 'call-1',
        contactName: 'Asha',
        phone: '+15550109999',
        direction: 'inbound',
        status: 'completed',
        duration: 180,
        summary: 'Asked for support appointment',
        outcome: 'callback needed',
        startedAt: new Date('2026-04-11T09:00:00Z'),
        actions: [
          {
            id: 'action-1',
            type: 'callback_requested',
            description: 'Asked staff to call back with slot options',
            createdAt: new Date('2026-04-11T09:05:00Z'),
          },
        ],
        appointment: null,
      },
    ]);
    prismaMock.appointment.findMany.mockResolvedValue([
      {
        id: 'appt-1',
        customerName: 'Asha',
        phone: '+15550109999',
        service: 'Customer Support',
        staffMember: null,
        date: '2026-04-15',
        time: '09:30',
        status: 'confirmed',
        reason: 'Consultation',
      },
    ]);

    const result = await new ToolService().getRecentCallHistory({ phone: '+15550109999' });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      calls: [expect.objectContaining({ id: 'call-1' })],
      appointments: [expect.objectContaining({ id: 'appt-1' })],
    });
  });

  it('captures callback requests in memory and notifications', async () => {
    prismaMock.contact.findUnique.mockResolvedValue(null);
    prismaMock.contact.create.mockResolvedValue({
      id: 'contact-1',
      name: 'Asha',
      phone: '+15550109999',
      category: 'customer',
    });

    const result = await new ToolService().collectCallbackRequest({
      customerName: 'Asha',
      phone: '+15550109999',
      topic: 'Staff Member availability for customer support',
      preferredDate: '2026-04-16',
      preferredTime: '11:00',
      note: "Asked for a callback from a staff member who speaks the caller's preferred language",
    });

    expect(result.success).toBe(true);
    expect(prismaMock.memory.create).toHaveBeenCalled();
    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'callback_request',
        }),
      }),
    );
    expect(result.data).toMatchObject({ contactId: 'contact-1' });
  });
});
