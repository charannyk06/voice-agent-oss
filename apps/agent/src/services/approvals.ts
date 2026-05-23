import { prisma } from './prisma';
import { config } from '../config';

export class ApprovalService {
  private readonly orgId: string;

  constructor(orgId = config.deployment?.defaultOrgId ?? 'default') {
    this.orgId = orgId;
  }
  async createApproval(params: {
    callId?: string;
    type: string;
    title: string;
    description: string;
    risk?: string;
    contact?: string;
    phone?: string;
    callContext?: string;
  }): Promise<string> {
    try {
      console.log('[Approval] Creating approval: [redacted]');

      const approval = await prisma.approval.create({
        data: {
          orgId: this.orgId,
          type: params.type,
          title: params.title,
          description: params.description,
          risk: params.risk ?? 'medium',
          status: 'pending',
          contact: params.contact,
          phone: params.phone,
          callContext: params.callContext,
          callId: params.callId ?? null,
        },
      });

      return approval.id;
    } catch (error) {
      console.error('[Approval] Error creating approval:', error);
      return 'approval-error';
    }
  }

  /**
   * Check if an approval type should be auto-approved.
   * Falls back to DB rules in AutoApproveRule table.
   */
  async checkAutoApprove(type: string, amountCents?: number): Promise<boolean> {
    // Hardcoded rules (always applied)
    if (type === 'spam_block' || type === 'urgent') {
      return true;
    }

    // Booking amount threshold, read from DB config or fall back to $50 default
    if (type === 'booking' && amountCents !== undefined) {
      const rule = await prisma.autoApproveRule.findFirst({
        where: { orgId: this.orgId, name: 'booking_under_amount', enabled: true },
      });
      const threshold = rule
        ? parseInt(rule.condition, 10)
        : 5000; // Default: auto-approve bookings under $50
      if (amountCents < threshold) {
        return true;
      }
    }

    // Read dynamic rules from DB
    try {
      const rule = await prisma.autoApproveRule.findFirst({
        where: { orgId: this.orgId, name: type, enabled: true },
      });
      if (rule) {
        return true;
      }
    } catch {
      // DB not available, continue
    }

    return false;
  }

  async getApprovalStatus(approvalId: string): Promise<string> {
    try {
      const approval = await prisma.approval.findUnique({
        where: { id_orgId: { id: approvalId, orgId: this.orgId } },
      });
      return approval?.status ?? 'unknown';
    } catch (error) {
      console.error('[Approval] Error getting approval status:', error);
      return 'error';
    }
  }
}
