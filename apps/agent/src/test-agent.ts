import { ReceptionistAgent } from './agents/receptionist';
import type { CallSession } from './types';

async function testCall(): Promise<void> {
  const session: CallSession = {
    id: 'test-1',
    contactName: 'Unknown',
    phone: '+15551234567',
    direction: 'inbound',
    status: 'active',
    startedAt: new Date(),
    duration: 0,
    transcript: [],
    actions: [],
  };

  const agent = new ReceptionistAgent(session);
  const greeting = await agent.start();
  console.log('Agent:', greeting);

  const responses = [
    "Hi, I'd like to book an appointment with a general physician",
    'Yes, Thursday afternoon would work best',
    'Any time between 2 and 4pm',
    "My name is Rahul Sharma, phone number is the one I'm calling from",
    'Headache and fever for the past two days',
    'That sounds great, thank you',
  ];

  for (const response of responses) {
    console.log('Caller:', response);
    const agentReply = await agent.processMessage(response);
    console.log('Agent:', agentReply);
    console.log('---');
  }

  console.log('Call ended. Actions:', session.actions);
}

testCall().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
