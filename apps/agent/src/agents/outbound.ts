import { VoiceAgent } from '../services/voice';
import { MemoryService } from '../services/memory';
import { ToolService } from '../services/tools';
import type { CallActionRecord, CallSession, TranscriptLine } from '../types';
import { config } from '../config';
import { getRuntimeSnapshot } from '../services/runtime-config';

export class OutboundAgent {
  private voice: VoiceAgent;
  private memory: MemoryService;
  private tools: ToolService;
  private session: CallSession;
  private purpose: string;
  private onLiveTranscript?: (line: TranscriptLine) => void;
  private onLiveAction?: (action: CallActionRecord) => void;

  constructor(
    session: CallSession,
    purpose: string,
    callbacks?: {
      onTranscript?: (line: TranscriptLine) => void;
      onAction?: (action: CallActionRecord) => void;
    }
  ) {
    this.session = session;
    this.purpose = purpose;
    this.onLiveTranscript = callbacks?.onTranscript;
    this.onLiveAction = callbacks?.onAction;
    this.memory = new MemoryService(session.orgId);
    this.tools = new ToolService(session.orgId);

    this.voice = new VoiceAgent(session, {
      onTranscript: (line) => {
        this.session.transcript.push(line);
        this.onLiveTranscript?.(line);
      },
      onAction: (type, description) => {
        const action = {
          type,
          description,
          timestamp: new Date().toISOString(),
        };
        this.session.actions.push(action);
        this.onLiveAction?.(action);
      },
      onRequestApproval: () => {},
    });
  }

  private async getGreetingForPurpose(): Promise<string> {
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    const runtime = await getRuntimeSnapshot(this.session.orgId).catch(() => null);
    const agentName = runtime?.config.name || config.agent.name;
    const businessName = runtime?.config.businessName || config.business.name;
    const base = `Good ${timeOfDay}. This is ${agentName}, calling from ${businessName}.`;

    if (this.purpose.includes('appointment') || this.purpose.includes('book')) {
      return `${base} I'm calling to confirm your appointment and answer any questions you may have. Is this a good time to talk?`;
    }
    if (this.purpose.includes('reminder')) {
      return `${base} I'm calling with a reminder about your upcoming appointment. Is this a good time to talk?`;
    }
    if (this.purpose.includes('follow') || this.purpose.includes('check')) {
      return `${base} I'm calling for a follow-up on your recent interaction. Is this a good time to talk?`;
    }
    if (this.purpose.includes('service') || this.purpose.includes('update')) {
      return `${base} I'm calling with an update about your service request. Is this a good time to talk?`;
    }
    if (this.purpose.includes('account') || this.purpose.includes('billing')) {
      return `${base} I'm calling about your account request. Is this a good time to talk?`;
    }

    return `${base} I'm calling regarding your recent inquiry. Is this a good time to talk?`;
  }

  async getOpeningLine(): Promise<string> {
    const opening = await this.getGreetingForPurpose();
    this.voice.recordAgentUtterance(opening);
    return opening;
  }

  async processResponse(response: string): Promise<string> {
    this.voice.recordHumanUtterance(response);
    const contact = await this.memory.findContactByPhone(this.session.phone);
    const context = this.memory.buildContext(contact);
    const reply = await this.voice.generateResponse(response, context);
    this.voice.recordAgentUtterance(reply);
    return reply;
  }

  getSummary(): string {
    return this.voice.getSummary();
  }
}
