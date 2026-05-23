import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalService } from './approvals';

// Mock the prisma module
vi.mock('./prisma', () => ({
  prisma: {
    approval: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    autoApproveRule: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from './prisma';

describe('ApprovalService', () => {
  let service: ApprovalService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ApprovalService();
  });

  describe('createApproval', () => {
    it('should create an approval with correct fields', async () => {
      vi.mocked(prisma.approval.create).mockResolvedValue({
        id: 'approval-1',
        orgId: 'default',
        type: 'booking',
        title: 'Book appointment',
        description: 'Book for Rahul Sharma',
        risk: 'low',
        status: 'pending',
        contact: 'Rahul Sharma',
        phone: '+1551234567',
        callContext: null,
        callId: 'call-1',
        resolvedAt: null,
        createdAt: new Date(),
      });

      const id = await service.createApproval({
        type: 'booking',
        title: 'Book appointment',
        description: 'Book for Rahul Sharma',
        risk: 'low',
        contact: 'Rahul Sharma',
        phone: '+1551234567',
        callId: 'call-1',
      });

      expect(id).toBe('approval-1');
      expect(prisma.approval.create).toHaveBeenCalledOnce();
      expect(prisma.approval.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'booking',
          title: 'Book appointment',
          status: 'pending',
          risk: 'low',
          contact: 'Rahul Sharma',
          phone: '+1551234567',
        }),
      });
    });

    it('should default risk to medium when not provided', async () => {
      vi.mocked(prisma.approval.create).mockResolvedValue({
        id: 'approval-2',
        orgId: 'default',
        type: 'info',
        title: 'Info request',
        description: 'Customer asked about hours',
        risk: 'medium',
        status: 'pending',
        contact: null,
        phone: null,
        callContext: null,
        callId: null,
        resolvedAt: null,
        createdAt: new Date(),
      });

      await service.createApproval({
        type: 'info',
        title: 'Info request',
        description: 'Customer asked about hours',
      });

      expect(prisma.approval.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          risk: 'medium',
        }),
      });
    });

    it('should return error string when DB fails', async () => {
      vi.mocked(prisma.approval.create).mockRejectedValue(new Error('DB error'));

      const id = await service.createApproval({
        type: 'booking',
        title: 'Test',
        description: 'Test',
      });

      expect(id).toBe('approval-error');
    });
  });

  describe('checkAutoApprove', () => {
    it('should auto-approve spam_block type', async () => {
      const result = await service.checkAutoApprove('spam_block');
      expect(result).toBe(true);
    });

    it('should auto-approve urgent type', async () => {
      const result = await service.checkAutoApprove('urgent');
      expect(result).toBe(true);
    });

    it('should not auto-approve generic types by default', async () => {
      vi.mocked(prisma.autoApproveRule.findFirst).mockResolvedValue(null);
      const result = await service.checkAutoApprove('info_request');
      expect(result).toBe(false);
    });

    it('should auto-approve booking under default threshold of 5000 cents', async () => {
      vi.mocked(prisma.autoApproveRule.findFirst).mockResolvedValue(null);
      const result = await service.checkAutoApprove('booking', 3000);
      expect(result).toBe(true);
    });

    it('should not auto-approve booking over default threshold', async () => {
      vi.mocked(prisma.autoApproveRule.findFirst).mockResolvedValue(null);
      const result = await service.checkAutoApprove('booking', 10000);
      expect(result).toBe(false);
    });

    it('should respect DB rule threshold', async () => {
      vi.mocked(prisma.autoApproveRule.findFirst).mockResolvedValue({
        id: 'rule-1',
        orgId: 'default',
        name: 'booking_under_amount',
        condition: '3000',
        enabled: true,
        createdAt: new Date(),
      });
      const result = await service.checkAutoApprove('booking', 2500);
      expect(result).toBe(true);
    });

    it('should ignore disabled rules', async () => {
      vi.mocked(prisma.autoApproveRule.findFirst).mockResolvedValue(null);
      const result = await service.checkAutoApprove('booking', 3000);
      expect(result).toBe(true); // falls back to default threshold
    });
  });

  describe('getApprovalStatus', () => {
    it('should return status from DB', async () => {
      vi.mocked(prisma.approval.findUnique).mockResolvedValue({
        id: 'approval-1',
        orgId: 'default',
        type: 'booking',
        title: 'Book',
        description: '',
        risk: 'low',
        status: 'approved',
        contact: null,
        phone: null,
        callContext: null,
        callId: null,
        resolvedAt: null,
        createdAt: new Date(),
      });

      const status = await service.getApprovalStatus('approval-1');
      expect(status).toBe('approved');
    });

    it('should return unknown for non-existent approval', async () => {
      vi.mocked(prisma.approval.findUnique).mockResolvedValue(null);
      const status = await service.getApprovalStatus('does-not-exist');
      expect(status).toBe('unknown');
    });

    it('should return error when DB fails', async () => {
      vi.mocked(prisma.approval.findUnique).mockRejectedValue(new Error('DB error'));
      const status = await service.getApprovalStatus('approval-1');
      expect(status).toBe('error');
    });
  });
});
