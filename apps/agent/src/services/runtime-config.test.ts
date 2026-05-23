import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentConfig: { findUnique: vi.fn() },
    agentToolConfig: { findMany: vi.fn() },
    knowledgeDoc: { findMany: vi.fn() },
  },
}));

vi.mock('./prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('../config', () => ({
  config: {
    agent: {
      name: 'Demo Agent',
      businessHoursStart: '08:00',
      businessHoursEnd: '21:00',
      maxCallDurationMin: 15,
      budgetMonthlyCents: 70000,
      budgetDailyAlertCents: 3000,
      autoApproveBookingsUnderCents: 5000,
    },
    gemini: {
      languageCode: 'en-US',
    },
    business: {
      name: 'Example Business',
      location: 'Example City',
      receptionNumber: '+15551234567',
      urgentTransferNumber: '+15551234567',
    },
  },
}));

import { getEnabledFunctionDeclarations, invalidateRuntimeSnapshot } from './runtime-config';

describe('runtime-config routed function filtering', () => {
  beforeEach(() => {
    invalidateRuntimeSnapshot();
    prismaMock.agentConfig.findUnique.mockResolvedValue(null);
    prismaMock.knowledgeDoc.findMany.mockResolvedValue([]);
  });

  it('exposes enabled smart routing tools to Gemini Live', async () => {
    prismaMock.agentToolConfig.findMany.mockResolvedValue([
      {
        key: 'people-memory-search',
        name: 'People Memory Search',
        description: 'Search caller memory and people records.',
        enabled: true,
      },
      {
        key: 'external-knowledge-search',
        name: 'External Knowledge Search',
        description: 'Search public information when enabled.',
        enabled: false,
      },
    ]);

    const declarations = await getEnabledFunctionDeclarations();
    const names = declarations.map((item) => item.name);

    expect(names).toContain('search_people_memory');
    expect(names).not.toContain('search_external_knowledge');
  });
});
