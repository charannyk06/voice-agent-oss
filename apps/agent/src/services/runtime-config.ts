import type { FunctionDeclaration } from '@google/genai';
import { config } from '../config';
import { prisma } from './prisma';
import {
  DEFAULT_AGENT_TOOL_CATALOG,
  DEFAULT_AGENT_KNOWLEDGE_DOCS,
  getAgentFunctionDeclarations,
  getAgentSystemPrompt,
} from './agent-profile';

type RuntimeToolSnapshot = {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
};

type RuntimeKnowledgeDocSnapshot = {
  id: string;
  name: string;
  content: string;
};

type RuntimeSnapshot = {
  config: {
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
  tools: RuntimeToolSnapshot[];
  knowledgeDocs: RuntimeKnowledgeDocSnapshot[];
};

const CACHE_TTL_MS = 10_000;
const cachedSnapshots = new Map<string, { snapshot: RuntimeSnapshot; cachedAt: number }>();

function defaultConfig() {
  return {
    name: config.agent.name,
    voice: 'v1',
    instructions: getAgentSystemPrompt(),
    languageCode: config.gemini.languageCode,
    businessName: config.business.name,
    businessLocation: config.business.location,
    receptionNumber: config.business.receptionNumber,
    urgentTransferNumber: config.business.urgentTransferNumber,
    businessHoursStart: config.agent.businessHoursStart,
    businessHoursEnd: config.agent.businessHoursEnd,
    maxCallDurationMin: config.agent.maxCallDurationMin,
    budgetMonthlyCents: config.agent.budgetMonthlyCents,
    budgetDailyAlertCents: config.agent.budgetDailyAlertCents,
    autoApproveBookingsUnderCents: config.agent.autoApproveBookingsUnderCents,
  };
}

export function invalidateRuntimeSnapshot(): void {
  cachedSnapshots.clear();
}

export async function ensureRuntimeDefaults(): Promise<void> {
  const orgId = config.deployment?.defaultOrgId ?? 'default';
  const defaults = defaultConfig();
  const existingConfig = await prisma.agentConfig.findUnique({ where: { id: orgId } });

  if (!existingConfig) {
    await prisma.agentConfig.create({
      data: {
        id: orgId,
        ...defaults,
      },
    });
  } else {
    const shouldUpgradeInstructions =
      !existingConfig.instructions ||
      existingConfig.instructions.startsWith('You are a personal calling assistant.');

    await prisma.agentConfig.update({
      where: { id: orgId },
      data: {
        instructions: shouldUpgradeInstructions ? defaults.instructions : undefined,
        languageCode: existingConfig.languageCode || defaults.languageCode,
        businessName: existingConfig.businessName || defaults.businessName,
        businessLocation: existingConfig.businessLocation || defaults.businessLocation,
        receptionNumber: existingConfig.receptionNumber || defaults.receptionNumber,
        urgentTransferNumber:
          existingConfig.urgentTransferNumber || defaults.urgentTransferNumber,
      },
    });
  }

  for (const tool of DEFAULT_AGENT_TOOL_CATALOG) {
    await prisma.agentToolConfig.upsert({
      where: { orgId_key: { orgId, key: tool.key } },
      update: {
        name: tool.name,
        description: tool.description,
      },
      create: {
        orgId,
        key: tool.key,
        name: tool.name,
        description: tool.description,
        enabled: true,
      },
    });
  }

  const docCount = await prisma.knowledgeDoc.count({ where: { orgId } });
  if (docCount === 0) {
    for (const doc of DEFAULT_AGENT_KNOWLEDGE_DOCS) {
      await prisma.knowledgeDoc.create({
        data: {
          orgId,
          name: doc.name,
          content: doc.content,
          size: Buffer.byteLength(doc.content, 'utf8'),
          mimeType: 'text/markdown',
        },
      });
    }
  }

  invalidateRuntimeSnapshot();
}

export async function getRuntimeSnapshot(
  orgId = config.deployment?.defaultOrgId ?? 'default',
  forceFresh = false,
): Promise<RuntimeSnapshot> {
  const cached = cachedSnapshots.get(orgId);
  if (!forceFresh && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.snapshot;
  }

  const [agentConfig, tools, docs] = await Promise.all([
    prisma.agentConfig.findUnique({ where: { id: orgId } }),
    prisma.agentToolConfig.findMany({ where: { orgId }, orderBy: { name: 'asc' } }),
    prisma.knowledgeDoc.findMany({ where: { orgId }, orderBy: { name: 'asc' } }),
  ]);

  const defaults = defaultConfig();
  const snapshot: RuntimeSnapshot = {
    config: {
      name: agentConfig?.name ?? defaults.name,
      voice: agentConfig?.voice ?? defaults.voice,
      instructions: agentConfig?.instructions ?? defaults.instructions,
      languageCode: agentConfig?.languageCode ?? defaults.languageCode,
      businessName: agentConfig?.businessName ?? defaults.businessName,
      businessLocation: agentConfig?.businessLocation ?? defaults.businessLocation,
      receptionNumber: agentConfig?.receptionNumber ?? defaults.receptionNumber,
      urgentTransferNumber:
        agentConfig?.urgentTransferNumber ?? defaults.urgentTransferNumber,
      businessHoursStart: agentConfig?.businessHoursStart ?? defaults.businessHoursStart,
      businessHoursEnd: agentConfig?.businessHoursEnd ?? defaults.businessHoursEnd,
      maxCallDurationMin: agentConfig?.maxCallDurationMin ?? defaults.maxCallDurationMin,
      budgetMonthlyCents: agentConfig?.budgetMonthlyCents ?? defaults.budgetMonthlyCents,
      budgetDailyAlertCents:
        agentConfig?.budgetDailyAlertCents ?? defaults.budgetDailyAlertCents,
      autoApproveBookingsUnderCents:
        agentConfig?.autoApproveBookingsUnderCents ?? defaults.autoApproveBookingsUnderCents,
    },
    tools: tools.map((tool): RuntimeToolSnapshot => ({
      key: tool.key,
      name: tool.name,
      description: tool.description,
      enabled: tool.enabled,
    })),
    knowledgeDocs: docs.map((doc): RuntimeKnowledgeDocSnapshot => ({
      id: doc.id,
      name: doc.name,
      content: doc.content ?? '',
    })),
  };

  cachedSnapshots.set(orgId, { snapshot, cachedAt: Date.now() });
  return snapshot;
}

export async function buildAgentSystemPrompt(orgId?: string): Promise<string> {
  const snapshot = await getRuntimeSnapshot(orgId);
  const enabledTools = snapshot.tools.filter((tool) => tool.enabled).map((tool) => tool.name);
  const knowledgeText = snapshot.knowledgeDocs
    .map((doc) => `## ${doc.name}\n${doc.content.trim()}`)
    .join('\n\n')
    .trim()
    .slice(0, 12_000);

  return [
    snapshot.config.instructions.trim(),
    'Current live configuration:',
    `- Business name: ${snapshot.config.businessName}`,
    `- Location: ${snapshot.config.businessLocation}`,
    `- Reception number: ${snapshot.config.receptionNumber}`,
    `- Urgent transfer number: ${snapshot.config.urgentTransferNumber}`,
    `- Business hours: ${snapshot.config.businessHoursStart} to ${snapshot.config.businessHoursEnd}`,
    `- Preferred language code: ${snapshot.config.languageCode}`,
    enabledTools.length ? `- Enabled tools: ${enabledTools.join(', ')}` : '- Enabled tools: none',
    knowledgeText ? `Business knowledge base:\n${knowledgeText}` : 'Business knowledge base: none uploaded yet.',
  ].join('\n\n');
}

export async function getEnabledFunctionDeclarations(orgId?: string): Promise<FunctionDeclaration[]> {
  const snapshot = await getRuntimeSnapshot(orgId);
  const allowedNames = new Set(
    DEFAULT_AGENT_TOOL_CATALOG
      .filter((tool) => snapshot.tools.find((row) => row.key === tool.key)?.enabled !== false)
      .flatMap((tool) => tool.functionNames),
  );

  return getAgentFunctionDeclarations().filter((declaration) =>
    allowedNames.has(declaration.name ?? ''),
  );
}
