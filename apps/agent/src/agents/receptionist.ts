import { VoiceAgent } from '../services/voice';
import { MemoryService } from '../services/memory';
import { ToolService } from '../services/tools';
import { ApprovalService } from '../services/approvals';
import type { CallActionRecord, CallSession, TranscriptLine } from '../types';

const SPAM_KEYWORDS = [
  'warranty',
  'debt relief',
  'final expense',
  'solicitation',
  'press 1',
];

export class ReceptionistAgent {
  private voice: VoiceAgent;
  private memory: MemoryService;
  private tools: ToolService;
  private approvals: ApprovalService;
  private session: CallSession;
  private onLiveTranscript?: (line: TranscriptLine) => void;
  private onLiveAction?: (action: CallActionRecord) => void;

  constructor(
    session: CallSession,
    callbacks?: {
      onTranscript?: (line: TranscriptLine) => void;
      onAction?: (action: CallActionRecord) => void;
    }
  ) {
    this.session = session;
    this.onLiveTranscript = callbacks?.onTranscript;
    this.onLiveAction = callbacks?.onAction;
    this.memory = new MemoryService(session.orgId);
    this.tools = new ToolService(session.orgId);
    this.approvals = new ApprovalService(session.orgId);

    this.voice = new VoiceAgent(session, {
      onTranscript: (line) => this.handleTranscript(line),
      onAction: (type, description) => this.handleAction(type, description),
      onRequestApproval: (type, title, description, risk) =>
        this.requestApproval(type, title, description, risk),
    });
  }

  async start(): Promise<string> {
    const contact = await this.memory.findContactByPhone(this.session.phone);
    if (contact) {
      this.session.contactName = contact.name;
    }

    const greeting = await this.voice.getGreeting();
    this.voice.recordAgentUtterance(greeting);
    return greeting;
  }

  async processMessage(userText: string): Promise<string> {
    this.voice.recordHumanUtterance(userText);

    const contact = await this.memory.findContactByPhone(this.session.phone);
    const context = this.memory.buildContext(contact);
    const response = await this.voice.generateResponse(userText, context);

    await this.detectAndExecuteActions(userText);
    this.voice.recordAgentUtterance(response);

    return response;
  }

  private handleTranscript(line: TranscriptLine): void {
    this.session.transcript.push(line);
    this.onLiveTranscript?.(line);
    console.log(`[${line.speaker}] [redacted transcript]`);
  }

  private handleAction(type: string, description: string): void {
    const action = {
      type,
      description,
      timestamp: new Date().toISOString(),
    };
    this.session.actions.push(action);
    this.onLiveAction?.(action);
    console.log(`[Action] ${type}: [redacted]`);
  }

  private async requestApproval(
    type: string,
    title: string,
    description: string,
    risk: string
  ): Promise<void> {
    // Pass amount for booking type. Appointment bookings have no customer-facing cost by default.
    const amountCents = type === 'booking' ? 0 : undefined;
    const autoApproved = await this.approvals.checkAutoApprove(type, amountCents);
    if (autoApproved) {
      this.handleAction(type, `Auto-approved: ${title}`);
      return;
    }

    await this.approvals.createApproval({
      callId: this.session.id,
      type,
      title,
      description,
      risk,
      contact: this.session.contactName,
      phone: this.session.phone,
      callContext: this.voice.getSummary(),
    });
    this.handleAction('approval_requested', title);
  }

  private async detectAndExecuteActions(userText: string): Promise<void> {
    const lower = userText.toLowerCase();

    // Urgent keywords
    if (
      lower.includes('urgent') ||
      lower.includes('emergency') ||
      lower.includes('unsafe') ||
      lower.includes('dying') ||
      lower.includes('not breathing') ||
      lower.includes('unconscious')
    ) {
      await this.requestApproval(
        'urgent',
        'Urgent transfer required',
        userText,
        'high'
      );
      return;
    }

    // Spam detection
    if (SPAM_KEYWORDS.some((kw) => lower.includes(kw))) {
      await this.tools.blockNumber(this.session.phone, 'Spam/solicitation call detected');
      this.session.status = 'blocked';
      this.handleAction('blocked', 'Spam call blocked');
      return;
    }

    // Appointment booking
    if (lower.includes('book') || lower.includes('appointment') || lower.includes('schedule')) {
      await this.requestApproval('booking', 'Schedule customer appointment', userText, 'low');
    }

    // Sensitive account or service information
    if (
      lower.includes('private') ||
      lower.includes('account details') ||
      lower.includes('personal information') ||
      lower.includes('report')
    ) {
      await this.requestApproval('info_release', 'Sensitive information request', userText, 'medium');
    }

    // Billing inquiries
    if (
      lower.includes('bill') ||
      lower.includes('payment') ||
      lower.includes('insurance') ||
      lower.includes('cost')
    ) {
      await this.requestApproval('billing', 'Billing information request', userText, 'low');
    }

    // Human staff consultation requests
    if (lower.includes('consult') || lower.includes('specialist') || lower.includes('advisor')) {
      await this.requestApproval('consultation', 'Human staff consultation request', userText, 'medium');
    }
  }

  async end(): Promise<string> {
    return this.voice.getSummary();
  }

  /**
   * Stop the agent when a human operator barges in to take over the call.
   */
  stop(): void {
    this.session.status = 'transferred';
    console.log(`[ReceptionistAgent] Stopped, call ${this.session.id} transferred to human`);
  }
}
