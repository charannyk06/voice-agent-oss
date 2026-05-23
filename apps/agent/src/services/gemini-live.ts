import {
  GoogleGenAI,
  Modality,
  type Blob,
  type FunctionCall,
  type FunctionResponse,
  type LiveServerMessage,
} from '@google/genai';
import { config } from '../config';
import type { CallActionRecord, CallSession, TranscriptLine } from '../types';
import { ToolService } from './tools';
import { decodeTwilioMulaw, encodeTwilioMulaw, parseSampleRate, resamplePcm16 } from './audio';
import { buildAgentSystemPrompt, getEnabledFunctionDeclarations, getRuntimeSnapshot } from './runtime-config';

interface GeminiLiveBridgeOptions {
  session: CallSession;
  toolService: ToolService;
  sendAudioToCaller: (mulawBase64: string) => void;
  clearCallerAudio: () => void;
  onTranscript: (line: TranscriptLine) => void;
  onAction: (action: CallActionRecord) => void;
}

export class GeminiLiveBridge {
  private readonly ai: GoogleGenAI;
  private readonly callSession: CallSession;
  private readonly toolService: ToolService;
  private readonly sendAudioToCaller: (mulawBase64: string) => void;
  private readonly clearCallerAudio: () => void;
  private readonly onTranscript: (line: TranscriptLine) => void;
  private readonly onAction: (action: CallActionRecord) => void;
  private liveSession: any = null;
  private humanTranscriptBuffer = '';
  private agentTranscriptBuffer = '';
  private lastAudioMimeType = `audio/pcm;rate=${config.gemini.outputSampleRate}`;

  constructor(options: GeminiLiveBridgeOptions) {
    this.ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    this.callSession = options.session;
    this.toolService = options.toolService;
    this.sendAudioToCaller = options.sendAudioToCaller;
    this.clearCallerAudio = options.clearCallerAudio;
    this.onTranscript = options.onTranscript;
    this.onAction = options.onAction;
  }

  async connect(): Promise<void> {
    if (!config.gemini.apiKey) {
      throw new Error('GEMINI_API_KEY is required for live voice mode');
    }

    const [systemPrompt, functionDeclarations] = await Promise.all([
      buildAgentSystemPrompt(this.callSession.orgId),
      getEnabledFunctionDeclarations(this.callSession.orgId),
    ]);

    this.liveSession = await this.ai.live.connect({
      model: config.gemini.liveModel,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: [{ text: systemPrompt }],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        speechConfig: {
          languageCode: config.gemini.languageCode,
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: config.gemini.voiceName,
            },
          },
        },
        tools: [{ functionDeclarations }],
      },
      callbacks: {
        onopen: () => {
          this.recordAction('gemini_live_connected', `Connected to ${config.gemini.liveModel}`);
        },
        onmessage: async (message: LiveServerMessage) => {
          await this.handleServerMessage(message);
        },
        onerror: (error) => {
          this.recordAction('gemini_live_error', error.message || 'Unknown Gemini Live error');
        },
        onclose: () => {
          this.recordAction('gemini_live_closed', 'Gemini Live session closed');
        },
      },
    });
  }

  sendMulawAudio(base64Payload: string): void {
    if (!this.liveSession) {
      return;
    }

    const pcm8k = decodeTwilioMulaw(base64Payload);
    const pcm16k = resamplePcm16(pcm8k, 8000, config.gemini.inputSampleRate);
    const audioBlob: Blob = {
      data: pcm16k.toString('base64'),
      mimeType: `audio/pcm;rate=${config.gemini.inputSampleRate}`,
    };

    this.liveSession.sendRealtimeInput({ audio: audioBlob });
  }

  sendTwilioAudio(base64Payload: string): void {
    this.sendMulawAudio(base64Payload);
  }

  sendTextInstruction(text: string): void {
    this.liveSession?.sendRealtimeInput({ text });
  }

  endInputAudio(): void {
    this.liveSession?.sendRealtimeInput({ audioStreamEnd: true });
  }

  close(): void {
    // Flush any remaining buffered transcript before closing
    if (this.humanTranscriptBuffer.trim()) {
      this.recordTranscript('human', this.humanTranscriptBuffer);
      this.humanTranscriptBuffer = '';
    }
    if (this.agentTranscriptBuffer.trim()) {
      this.recordTranscript('agent', this.agentTranscriptBuffer);
      this.agentTranscriptBuffer = '';
    }
    this.liveSession?.close();
    this.liveSession = null;
  }

  private async handleServerMessage(message: LiveServerMessage): Promise<void> {
    const serverContent = message.serverContent;

    if (serverContent?.interrupted) {
      this.recordAction('gemini_interrupted', 'Model generation interrupted by caller activity');
      this.clearCallerAudio();
    }

    const inputText = serverContent?.inputTranscription?.text?.trim();
    if (inputText) {
      this.humanTranscriptBuffer = inputText;
      if (serverContent?.inputTranscription?.finished) {
        this.recordTranscript('human', this.humanTranscriptBuffer);
        this.humanTranscriptBuffer = '';
      }
    }

    const outputText = serverContent?.outputTranscription?.text?.trim() || message.text?.trim();
    if (outputText) {
      this.agentTranscriptBuffer = outputText;
      if (serverContent?.outputTranscription?.finished || serverContent?.turnComplete) {
        this.recordTranscript('agent', this.agentTranscriptBuffer);
        this.agentTranscriptBuffer = '';
      }
    }

    const inlineAudio = message.data;
    if (inlineAudio) {
      const mimeType = serverContent?.modelTurn?.parts?.find((part) => 'inlineData' in part && part.inlineData)?.inlineData?.mimeType;
      this.lastAudioMimeType = mimeType || this.lastAudioMimeType;
      const pcm = Buffer.from(inlineAudio, 'base64');
      const geminiRate = parseSampleRate(this.lastAudioMimeType, config.gemini.outputSampleRate);
      const pcm8k = resamplePcm16(pcm, geminiRate, 8000);
      this.sendAudioToCaller(encodeTwilioMulaw(pcm8k));
    }

    if (message.toolCall?.functionCalls?.length) {
      const functionResponses = await Promise.all(
        message.toolCall.functionCalls.map((call) => this.executeToolCall(call)),
      );
      this.liveSession?.sendToolResponse({ functionResponses });
    }
  }

  private async executeToolCall(functionCall: FunctionCall): Promise<FunctionResponse> {
    const name = functionCall.name || 'unknown_tool';
    const args = functionCall.args || {};

    this.recordAction('tool_requested', `${name}(${JSON.stringify(args)})`);

    try {
      let result;
      switch (name) {
        case 'lookup_contact':
          result = await this.toolService.lookupContact(String(args.phone || this.callSession.phone));
          break;
        case 'search_people_memory':
          result = await this.toolService.searchPeopleMemory(
            String(args.query || this.callSession.contactName || this.callSession.phone),
            args.phone ? String(args.phone) : this.callSession.phone,
            typeof args.limit === 'number' ? args.limit : undefined,
          );
          break;
        case 'get_recent_call_history':
          result = await this.toolService.getRecentCallHistory({
            phone: args.phone ? String(args.phone) : this.callSession.phone,
            customerName: args.customerName ? String(args.customerName) : this.callSession.contactName,
            limit: typeof args.limit === 'number' ? args.limit : undefined,
          });
          break;
        case 'lookup_service_directory':
          result = await this.toolService.lookupServiceDirectory(
            String(args.query || args.reason || 'front desk'),
          );
          break;
        case 'collect_callback_request':
          result = await this.toolService.collectCallbackRequest({
            customerName: args.customerName ? String(args.customerName) : this.callSession.contactName,
            phone: args.phone ? String(args.phone) : this.callSession.phone,
            topic: String(args.topic || 'General callback request'),
            preferredDate: args.preferredDate ? String(args.preferredDate) : undefined,
            preferredTime: args.preferredTime ? String(args.preferredTime) : undefined,
            note: args.note ? String(args.note) : undefined,
          });
          break;
        case 'book_appointment':
          result = await this.toolService.bookAppointment({
            customerName: String(args.customerName || this.callSession.contactName || 'Unknown Customer'),
            phone: String(args.phone || this.callSession.phone),
            service: String(args.service || 'General Service'),
            staffMember: args.staffMember ? String(args.staffMember) : undefined,
            date: String(args.date || 'today'),
            time: String(args.time || '10:00'),
            reason: String(args.reason || 'General consultation'),
            language: args.language ? String(args.language) : undefined,
            callId: this.callSession.id,
          });
          break;
        case 'reschedule_appointment':
          result = await this.toolService.rescheduleAppointment({
            phone: String(args.phone || this.callSession.phone),
            customerName: args.customerName ? String(args.customerName) : this.callSession.contactName,
            currentDate: args.currentDate ? String(args.currentDate) : undefined,
            newDate: String(args.newDate || 'tomorrow'),
            newTime: String(args.newTime || '10:00'),
            service: args.service ? String(args.service) : undefined,
            reason: args.reason ? String(args.reason) : undefined,
          });
          break;
        case 'cancel_appointment':
          result = await this.toolService.cancelAppointment({
            phone: String(args.phone || this.callSession.phone),
            customerName: args.customerName ? String(args.customerName) : this.callSession.contactName,
            date: args.date ? String(args.date) : undefined,
            reason: args.reason ? String(args.reason) : undefined,
          });
          break;
        case 'schedule_follow_up':
          result = await this.toolService.scheduleFollowUp(
            String(args.phone || this.callSession.phone),
            String(args.date || 'tomorrow'),
            String(args.note || 'Follow-up requested during live call'),
          );
          break;
        case 'log_marketing_interest':
          result = await this.toolService.logMarketingInterest({
            phone: String(args.phone || this.callSession.phone),
            customerName: args.customerName ? String(args.customerName) : this.callSession.contactName,
            campaign: String(args.campaign || 'business outreach'),
            interestLevel: args.interestLevel ? String(args.interestLevel) : undefined,
            note: args.note ? String(args.note) : undefined,
            doNotCall: Boolean(args.doNotCall),
          });
          break;
        case 'search_business_knowledge':
          result = await this.toolService.searchKnowledge(String(args.query || 'business information'));
          break;
        case 'search_external_knowledge':
          result = await this.toolService.searchExternalKnowledge(
            String(args.query || 'public business information'),
          );
          break;
        case 'send_sms':
          result = await this.toolService.sendSMS(
            String(args.to || this.callSession.phone),
            String(args.message || ''),
          );
          break;
        case 'transfer_to_frontdesk': {
          const runtime = await getRuntimeSnapshot(this.callSession.orgId).catch(() => null);
          result = await this.toolService.transferCall(
            this.callSession.id,
            String(args.target || runtime?.config.receptionNumber || config.business.receptionNumber),
          );
          break;
        }
        default:
          result = {
            success: false,
            message: `Unsupported tool call: ${name}`,
          };
      }

      this.recordAction('tool_completed', `${name}: ${result.message}`);
      return {
        id: functionCall.id,
        name,
        response: { output: result },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown tool error';
      this.recordAction('tool_failed', `${name}: ${message}`);
      return {
        id: functionCall.id,
        name,
        response: {
          error: {
            message,
          },
        },
      };
    }
  }

  private recordTranscript(speaker: 'agent' | 'human', text: string): void {
    const clean = text.trim();
    if (!clean) {
      return;
    }

    this.onTranscript({
      speaker,
      text: clean,
      timestamp: new Date().toISOString(),
    });
  }

  private recordAction(type: string, description: string): void {
    this.onAction({
      type,
      description,
      timestamp: new Date().toISOString(),
    });
  }
}
