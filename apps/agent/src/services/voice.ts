import { config } from '../config';
import { CostService } from './cost';
import type { CallSession, TranscriptLine } from '../types';
import { buildAgentSystemPrompt, getRuntimeSnapshot } from './runtime-config';

const DEFAULT_SYSTEM_PROMPT = `You are a voice assistant for ${config.business.name}. You handle incoming and outgoing calls for the business's reception desk.

Your role:
- Greet callers on behalf of ${config.business.name}
- Schedule and manage customer appointments
- Provide information about team members, services, and business policies
- Handle customer inquiries and direct them appropriately
- Transfer calls to the appropriate service line or human staff
- Collect and update customer information

Key behaviors:
- Always identify yourself as speaking on behalf of ${config.business.name}
- Be polite, professional, and empathetic, especially with customers
- Protect customer privacy and confidentiality
- For urgent safety issues, immediately transfer to ${config.business.urgentTransferNumber}
- Get information needed to help customers effectively
- Never provide regulated professional advice unless approved business knowledge explicitly covers it
- Always transfer uncertain or high-risk questions to human staff

When booking appointments:
- Confirm customer name, phone number, requested service, and reason for the appointment
- Check saved availability and suggest appropriate times only when confirmed
- Confirm date, time, service, and staff member name
- Remind customers of configured preparation notes only if saved business knowledge contains them
- Explain cancellation policies only if saved business knowledge contains them

When handling inquiries:
- Provide general information about business services
- Direct to the appropriate service line, callback workflow, or human staff member
- Share business hours and policies only if they are configured
- For emergencies or urgent safety issues, always transfer to ${config.business.urgentTransferNumber}

When you need approval:
- For appointments requiring special authorization
- For information requests that may violate privacy
- For any situation you are uncertain about`;

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>
    }
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  }>
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

/** Intent rules map for fallback routing, keyed by keyword; higher index = lower priority */
type IntentRule = {
  keywords: readonly string[];
  response: string;
  actionType?: string;
  actionDesc?: string;
};

const INTENT_RULES: IntentRule[] = [
  {
    keywords: ['urgent', 'emergency', 'unsafe', 'danger', 'dying', 'unconscious', 'not breathing'],
    response: `If this is an emergency or urgent safety issue, please hang up and call your local emergency number immediately. Otherwise, please hold while I transfer you to ${config.business.urgentTransferNumber}.`,
    actionType: 'urgent_detected',
    actionDesc: 'Urgent keywords detected, transfer required',
  },
  {
    keywords: ['book', 'appointment', 'schedule'],
    response: 'I can help you schedule an appointment. Could you please provide your name, phone number, requested service, and preferred time?',
  },
  {
    keywords: ['representative', 'human', 'manager', 'staff'],
    response: 'I can connect you with a team member. Please hold while I transfer or capture the best callback details.',
    actionType: 'transfer',
    actionDesc: 'Transfer to human staff',
  },
  {
    keywords: ['team member', 'specialist', 'advisor', 'representative'],
    response: 'I can help route you to the right team member. What service or topic do you need help with?',
  },
  {
    keywords: ['service', 'pricing', 'price', 'availability'],
    response: 'I can look up saved service details or collect your question for a staff callback. Which service are you asking about?',
  },
  {
    keywords: ['refund', 'invoice', 'receipt'],
    response: 'For billing or account questions, I can collect the details and route them to the right team. What is the best phone number for follow-up?',
  },
  {
    keywords: ['hours', 'open', 'closed', 'location'],
    response: 'I can help with business hours and location details if they are saved in the dashboard. What would you like to confirm?',
  },
  {
    keywords: ['bill', 'insurance', 'payment', 'cost'],
    response: 'For billing and insurance inquiries, I can transfer you to our billing service. Would you like me to do that, or do you have a specific question about your account?',
  },
];

export class VoiceAgent {
  private session: CallSession;
  private onTranscript: (line: TranscriptLine) => void;
  private onAction: (type: string, description: string) => void;
  private onRequestApproval: (
    type: string,
    title: string,
    description: string,
    risk: string
  ) => void;
  private elevenlabsApiKey: string;
  private elevenlabsVoiceId: string;
  private cost: CostService;

  constructor(
    session: CallSession,
    callbacks: {
      onTranscript: (line: TranscriptLine) => void;
      onAction: (type: string, description: string) => void;
      onRequestApproval: (
        type: string,
        title: string,
        description: string,
        risk: string
      ) => void;
    }
  ) {
    this.session = session;
    this.onTranscript = callbacks.onTranscript;
    this.onAction = callbacks.onAction;
    this.onRequestApproval = callbacks.onRequestApproval;
    this.elevenlabsApiKey = config.elevenlabs.apiKey;
    this.elevenlabsVoiceId = config.elevenlabs.voiceId || 'EXAVITQt4OGUENzbCF';
    this.cost = new CostService(session.orgId);
  }

  /**
   * Sanitize user text before inserting into the LLM prompt.
   * Blocks common prompt injection patterns.
   */
  sanitizeInput(text: string): string {
    const injectionPatterns = [
      /ignore\s+(previous|all\s+)?\s*(instructions?|directives?|orders?|rules?)/i,
      /disregard\s+(previous|all\s+)?\s*(instructions?|directives?)/i,
      /forget\s+(previous|all\s+)?\s*(instructions?|directives?)/i,
      /you\s+are\s+now\s+/i,
      /pretend\s+you\s+are/i,
      /act\s+as\s+/i,
      /system\s*:/i,
      /<system>/i,
      /\[INST\]\s*\[/i,
      /\$\{.*\}/,
    ];

    for (const pattern of injectionPatterns) {
      if (pattern.test(text)) {
        this.onAction('prompt_injection_detected', `Blocked injection attempt: ${text.slice(0, 80)}`);
        return '[REDACTED, potential prompt injection]';
      }
    }

    // Truncate to a reasonable length to prevent token overflow / memory abuse
    const MAX_INPUT = 2000;
    return text.length > MAX_INPUT ? text.slice(0, MAX_INPUT) + '...' : text;
  }

  async processAudio(_audioChunk: Buffer): Promise<string> {
    return '';
  }

  async generateResponse(userText: string, context: string): Promise<string> {
    if (!config.gemini.apiKey) {
      return this.buildFallbackResponse(userText);
    }

    try {
      const history = this.session.transcript
        .map((line) => `${line.speaker}: ${line.text}`)
        .join('\n');

      const cleanText = this.sanitizeInput(userText);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: `${await buildAgentSystemPrompt(this.session.orgId).catch(() => DEFAULT_SYSTEM_PROMPT)}

Known context:
${context}

Conversation so far:
${history}

Caller just said: ${cleanText}

Respond naturally as the assistant in 1-3 sentences.`,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 200,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.onAction('llm_error', `Gemini request failed: ${errorText}`);
        return this.buildFallbackResponse(userText);
      }

      const data = (await response.json()) as GeminiResponse;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (!text) {
        return this.buildFallbackResponse(userText);
      }

      // Record LLM cost
      const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
      const completionTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
      if (promptTokens > 0 || completionTokens > 0) {
        await this.cost.recordLlmCost(this.session.id, promptTokens, completionTokens);
      }

      return text;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown LLM error';
      this.onAction('llm_error', message);
      return this.buildFallbackResponse(userText);
    }
  }

  /**
   * Synthesize speech using ElevenLabs Streaming TTS API.
   * Returns raw audio bytes (MP3) suitable for a telephony media stream.
   */
  async synthesizeSpeech(text: string): Promise<Buffer> {
    if (!this.elevenlabsApiKey) {
      this.onAction('tts_fallback', 'ElevenLabs API key not configured, skipping TTS');
      return Buffer.alloc(0);
    }

    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/stream/${this.elevenlabsVoiceId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': this.elevenlabsApiKey,
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_turbo_v2',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.0,
              use_speaker_boost: true,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.onAction('tts_error', `ElevenLabs request failed: ${errorText}`);
        return Buffer.alloc(0);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Record TTS character cost
      await this.cost.recordTtsCost(this.session.id, text.length);

      return buffer;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown TTS error';
      this.onAction('tts_error', message);
      return Buffer.alloc(0);
    }
  }

  recordHumanUtterance(text: string): void {
    this.onTranscript({
      speaker: 'human',
      text,
      timestamp: new Date().toISOString(),
    });
  }

  recordAgentUtterance(text: string): void {
    this.onTranscript({
      speaker: 'agent',
      text,
      timestamp: new Date().toISOString(),
    });
  }

  async getGreeting(): Promise<string> {
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    const runtime = await getRuntimeSnapshot(this.session.orgId).catch(() => null);
    const businessName = runtime?.config.businessName || config.business.name;
    const agentName = runtime?.config.name || config.agent.name;
    return `Good ${timeOfDay}. Thank you for calling ${businessName}. I'm ${agentName}, your virtual reception assistant. How may I help you today?`;
  }

  getSummary(): string {
    return this.session.transcript.map((line) => `${line.speaker}: ${line.text}`).join('\n');
  }

  buildFallbackResponse(userText: string): string {
    const lower = userText.toLowerCase();

    for (const rule of INTENT_RULES) {
      if (rule.keywords.some((kw) => lower.includes(kw))) {
        if (rule.actionType) {
          this.onAction(rule.actionType, rule.actionDesc ?? rule.response.slice(0, 60));
        }
        return rule.response;
      }
    }

    return 'I understand. Could you please provide more details about your inquiry so I can assist you better? For specific or high-risk questions, I can transfer you to a team member.';
  }
}
