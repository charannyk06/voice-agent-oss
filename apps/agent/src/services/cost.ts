import { prisma } from './prisma';
import { config } from '../config';
import type { CostEntry } from '@prisma/client';

/**
 * Cost recording service.
 * Tracks usage costs for Deepgram (STT), Telnyx (voice), and Gemini (LLM).
 *
 * Pricing estimates (update these with real pricing from your providers):
 *   - Deepgram: $0.0043 per minute (Nova-2), about 0.0043 cents/sec
 *   - Telnyx: ~$0.008 per minute for inbound voice
 *   - Gemini: gemini-2.0-flash is free tier, gemini-1.5-flash ~$0.075/million tokens
 */
export class CostService {
  private readonly orgId: string;

  constructor(orgId = config.deployment?.defaultOrgId ?? 'default') {
    this.orgId = orgId;
  }
  /**
   * Record STT (Deepgram) usage for a call.
   */
  async recordSttCost(callId: string, audioDurationSeconds: number): Promise<void> {
    try {
      // Deepgram Nova-2: $0.0043/min = $0.0043/60/sec
      const minutes = audioDurationSeconds / 60;
      const amountCents = Math.round(minutes * 0.43); // $0.0043/min in cents
      await this.upsertCost(callId, 'deepgram', amountCents, minutes);
    } catch (error) {
      console.error('[Cost] Failed to record STT cost:', error);
    }
  }

  /**
   * Record LLM (Gemini) usage for a call.
   */
  async recordLlmCost(callId: string, promptTokens: number, completionTokens: number): Promise<void> {
    try {
      // Gemini 2.0 Flash is free in tier; fall back to $0.075/million tokens
      const totalTokens = promptTokens + completionTokens;
      const amountCents = Math.round((totalTokens / 1_000_000) * 0.075 * 100);
      await this.upsertCost(callId, 'gemini', amountCents, 0);
    } catch (error) {
      console.error('[Cost] Failed to record LLM cost:', error);
    }
  }

  /**
   * Record TTS (ElevenLabs) usage for a call.
   */
  async recordTtsCost(callId: string, charactersUsed: number): Promise<void> {
    try {
      // ElevenLabs: $0.30 per 1000 chars = $0.0003/char = $0.03 per 100 chars
      const amountCents = Math.round((charactersUsed / 1000) * 30);
      await this.upsertCost(callId, 'elevenlabs', amountCents, 0);
    } catch (error) {
      console.error('[Cost] Failed to record TTS cost:', error);
    }
  }

  /**
   * Record Telnyx voice minutes for a call.
   */
  async recordTelnyxCost(callId: string, durationMinutes: number): Promise<void> {
    try {
      // Telnyx inbound: ~$0.008/min
      const amountCents = Math.round(durationMinutes * 0.8);
      await this.upsertCost(callId, 'telnyx', amountCents, durationMinutes);
    } catch (error) {
      console.error('[Cost] Failed to record Telnyx cost:', error);
    }
  }

  /**
   * Get total cost for a call.
   */
  async getCallCost(callId: string): Promise<number> {
    try {
      const entries = await prisma.costEntry.findMany({ where: { callId, orgId: this.orgId } });
      return entries.reduce((sum: number, e: CostEntry) => sum + e.amountCents, 0);
    } catch {
      return 0;
    }
  }

  private async upsertCost(
    callId: string,
    provider: string,
    amountCents: number,
    minutes: number
  ): Promise<void> {
    // Upsert the cost entry for this call+provider
    await prisma.costEntry.upsert({
      where: {
        id: `${callId}-${provider}`,
      },
      update: {
        amountCents,
        minutes,
      },
      create: {
        id: `${callId}-${provider}`,
        orgId: this.orgId,
        callId,
        provider,
        amountCents,
        minutes,
      },
    });
  }
}
