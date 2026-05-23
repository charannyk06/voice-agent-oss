import type { FunctionDeclaration } from '@google/genai';
import { config } from '../config';

const DEFAULT_SERVICE_SLOTS: Record<string, string[]> = {};

export type AgentToolDefinition = {
  key: string;
  name: string;
  description: string;
  functionNames: string[];
};

export const DEFAULT_AGENT_TOOL_CATALOG: AgentToolDefinition[] = [
  {
    key: 'appointment-booking',
    name: 'Appointment Booking',
    description: 'Book and confirm appointments or service slots.',
    functionNames: ['book_appointment'],
  },
  {
    key: 'appointment-rescheduling',
    name: 'Appointment Changes',
    description: 'Reschedule or cancel existing appointments.',
    functionNames: ['reschedule_appointment', 'cancel_appointment'],
  },
  {
    key: 'follow-up-workflows',
    name: 'Follow-up Workflows',
    description: 'Schedule callbacks and follow-up tasks.',
    functionNames: ['schedule_follow_up'],
  },
  {
    key: 'contact-lookup',
    name: 'Contact Lookup',
    description: 'Look up known contacts by phone and caller history.',
    functionNames: ['lookup_contact'],
  },
  {
    key: 'people-memory-search',
    name: 'People Memory Search',
    description: 'Search caller notes, memories, and known contacts by name, phone, or topic.',
    functionNames: ['search_people_memory'],
  },
  {
    key: 'recent-call-history',
    name: 'Recent Call History',
    description: 'Summarize recent calls, outcomes, and appointments for a caller.',
    functionNames: ['get_recent_call_history'],
  },
  {
    key: 'service-directory',
    name: 'Service Directory',
    description: 'Look up services, policies, escalation paths, and front-desk details.',
    functionNames: ['lookup_service_directory'],
  },
  {
    key: 'callback-capture',
    name: 'Callback Capture',
    description: 'Capture unresolved questions for staff callback with preferred timing.',
    functionNames: ['collect_callback_request'],
  },
  {
    key: 'business-knowledge',
    name: 'Business Knowledge',
    description: 'Answer service and policy questions using saved business knowledge.',
    functionNames: ['search_business_knowledge'],
  },
  {
    key: 'external-knowledge-search',
    name: 'External Knowledge Search',
    description: 'Search public external information when an external search provider is configured.',
    functionNames: ['search_external_knowledge'],
  },
  {
    key: 'sms-notifications',
    name: 'SMS Notifications',
    description: 'Send confirmations, reminders, and callback texts.',
    functionNames: ['send_sms'],
  },
  {
    key: 'human-transfer',
    name: 'Human Transfer',
    description: 'Escalate urgent or unresolved cases to a human team member.',
    functionNames: ['transfer_to_frontdesk'],
  },
  {
    key: 'marketing-outreach',
    name: 'Marketing Outreach',
    description: 'Track campaign interest and do-not-call preferences.',
    functionNames: ['log_marketing_interest'],
  },
];

export const DEFAULT_AGENT_KNOWLEDGE_DOCS = [
  {
    name: 'Business Overview.md',
    content: `Business overview
- Business: Example Business
- Location: 123 Main Street, Springfield
- Main contact line: +15551234567
- Services: Customer Support, Billing Support, Scheduling Support, General Support
- If exact staff availability, pricing, or slot availability is not confirmed, collect details and offer a callback or transfer`,
  },
  {
    name: 'Services.md',
    content: `Publicly listed services
- Customer Support
- Billing Support
- Scheduling Support
- General Support

If a caller asks about a service outside these confirmed items, do not guess. Offer a transfer or callback request.`,
  },
  {
    name: 'Appointments and Escalation.md',
    content: `Appointments and escalation
- Use the reception line for urgent transfer or immediate staff handoff
- If exact staff timing, fees, or appointment availability are not confirmed in saved data, do not invent them
- Collect caller name, phone number, requested service, and preferred callback time, then offer a transfer or callback request`,
  },
  {
    name: 'Safe Answering Rules.md',
    content: `Safe answering rules
- Never provide regulated professional advice unless your business has explicitly configured approved content for it
- Never invent schedules, room availability, fees, policies, or preparation details
- For urgent safety issues, distress, or emergency situations, transfer immediately to a human team member
- For unclear or high-risk questions, collect details and escalate`,
  },
  {
    name: 'Contact Channels.md',
    content: `Contact channels
- Main phone: +15551234567
- Location: 123 Main Street, Springfield
- Website contact page: https://example.com/contact
- Use human transfer when a caller needs confirmed billing, policy, or scheduling details that are not already saved in the dashboard`,
  },
];

export function getAgentSystemPrompt(): string {
  return `You are the live voice receptionist for ${config.business.name}.

Business context:
- Business: ${config.business.name}
- Location: ${config.business.location}
- Main contact line: ${config.business.receptionNumber}

You handle:
- appointment and service booking requests
- reschedules and callbacks
- front-desk routing
- basic service questions using only saved business knowledge
- escalation to a human team member when the answer is not confirmed

Language behavior:
- Start in clear spoken English unless the configured greeting or caller language says otherwise.
- Default greeting: "Hello, this is ${config.agent.name} at ${config.business.name}. How can I help you today?"
- If the caller speaks another language and you can answer safely in that language, follow the caller's preference.

Safety rules:
- Never give regulated professional advice unless approved business knowledge explicitly covers it.
- Never invent staff schedules, fees, slot availability, policies, preparation steps, or service details.
- If the caller sounds urgent, distressed, or unsafe, immediately transfer to ${config.business.urgentTransferNumber}.
- For uncertain, high-risk, billing, legal, health, safety, or compliance questions, collect details and escalate.
- Protect privacy. Only confirm details needed to help the caller.

Workflow rules:
- For booking or callback requests, collect customer name, phone number, requested service, preferred date or time, and any short note.
- For facts about a known caller, prior conversations, callbacks, or appointments, prefer the relevant tool instead of guessing.
- For service, policy, escalation, or front-desk questions, check saved knowledge or directory tools before answering.
- If the exact answer is not confirmed in saved knowledge or tools, say that staff will confirm and offer a callback or transfer.
- Do not promise a booking is complete unless the tool confirms it.
- When you use a tool, explain the result simply.
- If a required detail is missing, ask one focused question.

Style:
- Sound warm, fast, and confident.
- Keep replies short, phone-friendly, and natural.
- Avoid long paragraphs.
- Never mention AI, model names, or internal tooling.`;
}

export function getAgentFunctionDeclarations(): FunctionDeclaration[] {
  return [
    {
      name: 'lookup_contact',
      description: 'Look up an existing customer or caller by phone number.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Customer phone number in E.164 or local format.' },
        },
        required: ['phone'],
      },
    },
    {
      name: 'search_people_memory',
      description: 'Search known people, notes, and caller memories by topic, name, or phone.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name, phone, service, or topic to search for.' },
          phone: { type: 'string', description: 'Optional caller phone to narrow the search.' },
          limit: { type: 'number', description: 'Optional max results to return.' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_recent_call_history',
      description: 'Summarize recent calls, outcomes, and appointments for a caller.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Caller phone number.' },
          customerName: { type: 'string', description: 'Optional customer or caller name.' },
          limit: { type: 'number', description: 'Optional max number of calls to include.' },
        },
      },
    },
    {
      name: 'lookup_service_directory',
      description: 'Look up services, policies, escalation numbers, and front-desk details from saved knowledge.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Service, policy, or topic to look up.' },
        },
        required: ['query'],
      },
    },
    {
      name: 'collect_callback_request',
      description: 'Capture an unresolved question for a staff callback with preferred timing.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          customerName: { type: 'string' },
          phone: { type: 'string' },
          topic: { type: 'string', description: 'What staff should call back about.' },
          preferredDate: { type: 'string', description: 'Preferred callback date.' },
          preferredTime: { type: 'string', description: 'Preferred callback time.' },
          note: { type: 'string', description: 'Extra context for staff.' },
        },
        required: ['topic'],
      },
    },
    {
      name: 'book_appointment',
      description: 'Book a new appointment for a customer.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          customerName: { type: 'string' },
          phone: { type: 'string' },
          service: { type: 'string' },
          staffMember: { type: 'string' },
          date: { type: 'string', description: 'Appointment date in YYYY-MM-DD or natural form.' },
          time: { type: 'string', description: 'Preferred appointment time.' },
          reason: { type: 'string' },
          language: { type: 'string', description: 'Preferred language, such as en or es.' },
        },
        required: ['customerName', 'phone', 'service', 'date', 'time', 'reason'],
      },
    },
    {
      name: 'reschedule_appointment',
      description: 'Reschedule an existing appointment.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          phone: { type: 'string' },
          customerName: { type: 'string' },
          currentDate: { type: 'string' },
          newDate: { type: 'string' },
          newTime: { type: 'string' },
          service: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['phone', 'newDate', 'newTime'],
      },
    },
    {
      name: 'cancel_appointment',
      description: 'Cancel a customer appointment and log the reason.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          phone: { type: 'string' },
          customerName: { type: 'string' },
          date: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['phone'],
      },
    },
    {
      name: 'schedule_follow_up',
      description: 'Schedule a follow-up task or callback for a customer.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          phone: { type: 'string' },
          customerName: { type: 'string' },
          date: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['phone', 'date', 'note'],
      },
    },
    {
      name: 'log_marketing_interest',
      description: 'Log interest in a campaign, service, or outreach program.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          phone: { type: 'string' },
          customerName: { type: 'string' },
          campaign: { type: 'string' },
          interestLevel: { type: 'string' },
          note: { type: 'string' },
          doNotCall: { type: 'boolean' },
        },
        required: ['phone', 'campaign'],
      },
    },
    {
      name: 'search_business_knowledge',
      description: 'Search business knowledge documents for service hours, services, or policies.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
    },
    {
      name: 'search_external_knowledge',
      description: 'Search public external information when an external search provider is configured.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
    },
    {
      name: 'send_sms',
      description: 'Send a short SMS confirmation or reminder to the customer.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          to: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['to', 'message'],
      },
    },
    {
      name: 'transfer_to_frontdesk',
      description: 'Transfer the call to a human front desk or escalation number.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          target: { type: 'string', description: 'Service or phone number to transfer to.' },
        },
        required: ['reason'],
      },
    },
  ];
}

export function getServiceSuggestions(service: string): string[] {
  return DEFAULT_SERVICE_SLOTS[service.toLowerCase()] ?? [];
}
