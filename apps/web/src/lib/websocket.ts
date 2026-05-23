// WebSocket client for real-time updates from the voice agent

import {
  normalizeTranscriptLine,
  normalizeWsCallAction,
  normalizeWsCallSession,
} from "./normalize";

export interface WSMessage {
  type: 'state' | 'call_started' | 'call_ended' | 'call_transcript' | 'call_action' | 'approval_created' | 'cost_update' | 'error';
  error?: string;
  activeCalls?: CallSession[];
  call?: CallSession;
  callId?: string;
  line?: TranscriptLine;
  action?: CallActionRecord;
  approval?: unknown;
  cost?: unknown;
}

export interface CallSession {
  id: string;
  providerCallId?: string;
  contactName: string;
  phone: string;
  direction: 'inbound' | 'outbound';
  status: 'active' | 'completed' | 'missed' | 'blocked' | 'transferred';
  startedAt: string;
  endedAt?: string;
  duration: number;
  transcript: TranscriptLine[];
  actions: CallActionRecord[];
  summary?: string;
  outcome?: string;
}

export interface TranscriptLine {
  speaker: 'agent' | 'human';
  text: string;
  timestamp: string;
}

export interface CallActionRecord {
  type: string;
  description: string;
  timestamp: string;
}

type MessageHandler = (message: WSMessage) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Set<MessageHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // base delay in ms
  private maxReconnectDelay = 30000; // ceiling: never wait more than 30s between retries
  private isConnecting = false;

  constructor(url: string) {
    this.url = url;
  }

  private async fetchDashboardToken(): Promise<string> {
    const response = await fetch('/api/agent/token', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof data.error === 'string'
        ? data.error
        : 'Unable to authenticate dashboard websocket';
      throw new Error(message);
    }
    if (typeof data.token !== 'string' || !data.token) {
      throw new Error('Dashboard websocket token missing');
    }
    return data.token;
  }

  private buildProtocolToken(token: string): string {
    return `dashboard-token.${token}`;
  }

  connect(): Promise<void> {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return Promise.resolve();
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      this.fetchDashboardToken()
        .then((token) => {
          try {
            const socketUrl = this.url;
            const safeUrl = new URL(this.url);
            safeUrl.search = '';
            console.log('[WS] Connecting to', safeUrl.toString());
            this.ws = new WebSocket(socketUrl, [this.buildProtocolToken(token)]);

            this.ws.onopen = () => {
              console.log('[WS] Connected');
              this.isConnecting = false;
              this.reconnectAttempts = 0;
              resolve();
            };

            this.ws.onmessage = (event) => {
              try {
                const message = JSON.parse(event.data) as WSMessage;
                if (message.type === 'error') {
                  console.warn('[WS] Server rejected action:', message.error);
                }
                this.handlers.forEach((handler) => handler(message));
              } catch (error) {
                console.error('[WS] Error parsing message:', error);
              }
            };

            this.ws.onerror = (error) => {
              console.error('[WS] Error:', error);
              this.isConnecting = false;
              reject(error);
            };

            this.ws.onclose = (event) => {
              console.log('[WS] Disconnected:', event.code, event.reason);
              this.isConnecting = false;
              this.ws = null;
              this.attemptReconnect();
            };
          } catch (error) {
            this.isConnecting = false;
            reject(error);
          }
        })
        .catch((error) => {
          this.isConnecting = false;
          this.handlers.forEach((handler) => handler({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unable to authenticate dashboard websocket',
          }));
          reject(error);
        });
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[WS] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );
    console.log(`[WS] Attempting reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(() => {
        // Will trigger another reconnect attempt via onclose
      });
    }, delay);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnection
  }

  send(message: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('[WS] Cannot send - not connected');
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

function resolveWebSocketUrl(): string {
  const explicitWsUrl = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (explicitWsUrl) {
    return explicitWsUrl;
  }

  const agentUrl = process.env.NEXT_PUBLIC_AGENT_URL?.trim();
  if (agentUrl) {
    try {
      const url = new URL(agentUrl);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.pathname = '/ws';
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch (error) {
      console.warn('[WS] Invalid NEXT_PUBLIC_AGENT_URL, falling back to localhost:', error);
    }
  }

  return 'ws://localhost:3012/ws';
}

// Create singleton instance
const wsUrl = resolveWebSocketUrl();
export const wsClient = new WebSocketClient(wsUrl);

// React hook for WebSocket
import { useEffect, useState, useCallback } from 'react';

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [activeCalls, setActiveCalls] = useState<CallSession[]>([]);

  useEffect(() => {
    let mounted = true;

    const handleMessage = (message: WSMessage) => {
      if (!mounted) return;

      switch (message.type) {
        case 'state':
          setActiveCalls(Array.isArray(message.activeCalls) ? message.activeCalls.map(normalizeWsCallSession) : []);
          break;
        case 'call_started':
          if (message.call) {
            const nextCall = normalizeWsCallSession(message.call);
            setActiveCalls((prev) => {
              if (prev.find((c) => c.id === nextCall.id)) return prev;
              return [...prev, nextCall];
            });
          }
          break;
        case 'call_transcript':
          if (message.callId && message.line) {
            const nextLine = normalizeTranscriptLine(message.line);
            setActiveCalls((prev) => prev.map((call) => (
              call.id === message.callId
                ? { ...call, transcript: [...(Array.isArray(call.transcript) ? call.transcript : []), nextLine] }
                : call
            )));
          }
          break;
        case 'call_action':
          if (message.callId && message.action) {
            const nextAction = normalizeWsCallAction(message.action);
            setActiveCalls((prev) => prev.map((call) => (
              call.id === message.callId
                ? { ...call, actions: [...(Array.isArray(call.actions) ? call.actions : []), nextAction] }
                : call
            )));
          }
          break;
        case 'call_ended':
          if (message.call) {
            const endedCall = normalizeWsCallSession(message.call);
            setActiveCalls((prev) => prev.filter((c) => c.id !== endedCall.id));
          }
          break;
      }
    };

    const unsubscribe = wsClient.onMessage(handleMessage);

    wsClient.connect()
      .then(() => { if (mounted) setIsConnected(true); })
      .catch(() => { if (mounted) setIsConnected(false); });

    const connectionTimer = setInterval(() => {
      if (mounted) {
        setIsConnected(wsClient.isConnected);
      }
    }, 1000);

    return () => {
      mounted = false;
      clearInterval(connectionTimer);
      unsubscribe();
    };
  }, []);

  const makeCall = useCallback((phone: string, purpose: string) => {
    wsClient.send({ type: 'make_call', phone, purpose });
  }, []);

  const bargeIn = useCallback((callId: string) => {
    wsClient.send({ type: 'barge_in', callId });
  }, []);

  return {
    isConnected,
    activeCalls,
    makeCall,
    bargeIn,
    disconnect: () => wsClient.disconnect(),
  };
}
