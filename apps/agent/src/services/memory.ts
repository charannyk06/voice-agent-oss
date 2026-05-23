import { prisma } from './prisma';
import { config } from '../config';
import type { Contact, ContactMemory } from '../types';
import type { Memory } from '@prisma/client';

// Re-export for convenience
export { prisma };

export class MemoryService {
  private readonly orgId: string;

  constructor(orgId = config.deployment.defaultOrgId) {
    this.orgId = orgId;
  }

  async findContactByPhone(phone: string): Promise<Contact | null> {
    try {
      const contact = await prisma.contact.findUnique({
        where: { orgId_phone: { orgId: this.orgId, phone } },
        include: { memories: true },
      });

      if (!contact) {
        return null;
      }

      return {
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        category: contact.category,
        starred: contact.starred,
        doNotCall: contact.doNotCall,
        memories: contact.memories.map((m: Memory) => ({
          id: m.id,
          contactId: m.contactId,
          text: m.text,
          source: m.source,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    } catch (error) {
      console.error('[Memory] Error finding contact:', error);
      return null;
    }
  }

  async getContactMemories(contactId: string): Promise<ContactMemory[]> {
    try {
      const memories = await prisma.memory.findMany({
        where: { contactId, contact: { orgId: this.orgId } },
        orderBy: { createdAt: 'desc' },
      });

      return memories.map((m: Memory) => ({
        id: m.id,
        contactId: m.contactId,
        text: m.text,
        source: m.source,
        createdAt: m.createdAt.toISOString(),
      }));
    } catch (error) {
      console.error('[Memory] Error getting memories:', error);
      return [];
    }
  }

  async addMemory(contactId: string, text: string, source: string): Promise<void> {
    try {
      await prisma.memory.create({
        data: {
          contactId,
          text,
          source,
        },
      });
      console.log(`[Memory] Adding memory for ${contactId}: [redacted]`);
    } catch (error) {
      console.error('[Memory] Error adding memory:', error);
    }
  }

  async updateMemory(memoryId: string, text: string): Promise<void> {
    try {
      await prisma.memory.update({
        where: { id: memoryId },
        data: { text },
      });
    } catch (error) {
      console.error('[Memory] Error updating memory:', error);
    }
  }

  async deleteMemory(memoryId: string): Promise<void> {
    try {
      await prisma.memory.delete({
        where: { id: memoryId },
      });
    } catch (error) {
      console.error('[Memory] Error deleting memory:', error);
    }
  }

  async searchMemories(query: string): Promise<ContactMemory[]> {
    try {
      const memories = await prisma.memory.findMany({
        where: {
          contact: { orgId: this.orgId },
          text: {
            contains: query,
          },
        },
      });

      return memories.map((m: Memory) => ({
        id: m.id,
        contactId: m.contactId,
        text: m.text,
        source: m.source,
        createdAt: m.createdAt.toISOString(),
      }));
    } catch (error) {
      console.error('[Memory] Error searching memories:', error);
      return [];
    }
  }

  buildContext(contact: Contact | null): string {
    if (!contact) {
      return 'Unknown caller. Be prepared to ask for their name, phone number, and reason for calling.';
    }

    const notes = contact.memories.map((memory) => `- ${memory.text}`).join('\n');
    return `Customer: ${contact.name} (${contact.phone})
Category: ${contact.category}
Previous interaction notes:
${notes || 'No previous notes.'}
${contact.starred ? 'This is a VIP customer or preferred contact.' : ''}
${contact.doNotCall ? 'WARNING: This number is on the do-not-call list.' : ''}`;
  }
}
