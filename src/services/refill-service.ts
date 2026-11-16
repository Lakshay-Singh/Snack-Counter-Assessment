/**
 * RefillService — orchestrates the entire refill lifecycle.
 *
 * Responsibilities:
 *   - Creating refills (with deduplication: one open refill per office)
 *   - Offering refills to volunteers (via Assigner)
 *   - Handling accept / decline / timeout
 *   - Recording purchases and submitting claims
 *   - Processing timeouts (4h for offer, 24h for purchase)
 *
 * Concurrency control:
 *   - Accepting a refill uses compare-and-set on the version counter.
 *   - Only one refill can be open per office at any time.
 */

import {
  OfficeId, OfficeConfig, Volunteer, Refill, RefillState, Money, fromMajor,
} from "../domain";
import { ChatPort, ClockPort, HRPort } from "../ports";
import { Assigner } from "./assigner";
import { BudgetLedger } from "./budget-ledger";

const OFFER_TIMEOUT_MS = 4 * 60 * 60 * 1000;    // 4 hours
const PURCHASE_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface RefillServiceDeps {
  offices: Map<OfficeId, OfficeConfig>;
  volunteers: Volunteer[];
  chat: ChatPort;
  hr: HRPort;
  clock: ClockPort;
  assigner: Assigner;
  budget: BudgetLedger;
}

export class RefillService {
  private refills = new Map<string, Refill>();
  /** Track the currently open refill per office (at most one). */
  private openRefillByOffice = new Map<OfficeId, string>();
  private nextId = 1;

  private offices: Map<OfficeId, OfficeConfig>;
  private volunteers: Volunteer[];
  private chat: ChatPort;
  private hr: HRPort;
  private clock: ClockPort;
  private assigner: Assigner;
  private budget: BudgetLedger;

  constructor(deps: RefillServiceDeps) {
    this.offices = deps.offices;
    this.volunteers = deps.volunteers;
    this.chat = deps.chat;
    this.hr = deps.hr;
    this.clock = deps.clock;
    this.assigner = deps.assigner;
    this.budget = deps.budget;
  }

  /** Update the volunteer list (for tests that add visitors, etc.) */
  setVolunteers(volunteers: Volunteer[]): void {
    this.volunteers = volunteers;
  }

  // ─── Report empty ─────────────────────────────────────────────────

  /**
   * Someone reports the snack box is empty.
   * If there's already an open refill for this office, merge (return existing).
   * Otherwise, create a new refill and start offering.
   */
  async reportEmpty(
    officeId: OfficeId,
    reportedBy: string,
    items: string[] = []
  ): Promise<Refill> {
    // Deduplication: merge into existing open refill
    const existingId = this.openRefillByOffice.get(officeId);
    if (existingId) {
      const existing = this.refills.get(existingId)!;
      // Merge reported items (add any new ones)
      for (const item of items) {
        if (!existing.reportedItems.includes(item)) {
          existing.reportedItems.push(item);
        }
      }
      return existing;
    }

    // Create new refill
    const now = this.clock.now();
    const refill: Refill = {
      id: `REFILL-${this.nextId++}`,
      officeId,
      state: RefillState.REPORTED,
      version: 0,
      reportedBy,
      reportedAt: now,
      reportedItems: [...items],
      assigneeId: null,
      offeredAt: null,
      committedAt: null,
      declinedVolunteerIds: [],
      reservedAmount: null,
      purchaseAmount: null,
      purchasedAt: null,
      purchasedItems: [],
      receiptImage: null,
      claimId: null,
      claimSubmittedAt: null,
      resolvedAt: null,
    };

    this.refills.set(refill.id, refill);
    this.openRefillByOffice.set(officeId, refill.id);

    await this.chat.postToOfficeChannel(
      officeId,
      `🔔 Snack box reported empty by ${reportedBy}. Items: ${items.join(", ") || "not specified"}. Finding a volunteer...`
    );

    // Check budget and start offering
    if (!this.budget.canAffordRefill(officeId)) {
      await this.chat.postToOfficeChannel(
        officeId,
        `⚠️ Monthly budget is low. Coordinator approval needed before proceeding.`
      );
      // In a full system, we'd wait for coordinator approval here.
      // For now, we still proceed but flag it.
    }

    await this.offerToNext(refill);
    return refill;
  }

  // ─── Offer to next volunteer ──────────────────────────────────────

  private async offerToNext(refill: Refill): Promise<void> {
    const volunteer = this.assigner.pickNext(
      refill.officeId,
      this.volunteers,
      refill
    );

    if (!volunteer) {
      // Nobody left — escalate and clear the open slot so a new refill can be created later
      refill.state = RefillState.ESCALATED;
      refill.version++;
      this.openRefillByOffice.delete(refill.officeId);
      await this.chat.postToOfficeChannel(
        refill.officeId,
        `🚨 No volunteers available for refill ${refill.id}. Coordinator: please assign someone or purchase directly.`
      );
      return;
    }

    refill.state = RefillState.OFFERED;
    refill.assigneeId = volunteer.id;
    refill.offeredAt = this.clock.now();
    refill.version++;

    const cap = this.budget.getSpendCap(refill.officeId);
    const office = this.offices.get(refill.officeId)!;

    await this.chat.sendDM(
      volunteer.id,
      `🛒 Hi ${volunteer.name}! The ${refill.officeId} snack box needs refilling. ` +
      `Budget cap: ${cap.amount / 100} ${cap.currency}. ` +
      `Items needed: ${refill.reportedItems.join(", ") || "general snacks"}. ` +
      `Reply to accept (you have 4 hours) or decline.`
    );
  }

  // ─── Accept / Decline / Grab ──────────────────────────────────────

  /**
   * Volunteer accepts the refill offer.
   * Uses compare-and-set: only succeeds if the version matches.
   * Returns true if accepted, false if someone else already got it.
   */
  async acceptRefill(
    refillId: string,
    volunteerId: string,
    expectedVersion: number
  ): Promise<boolean> {
    const refill = this.refills.get(refillId);
    if (!refill) throw new Error(`Refill ${refillId} not found`);

    // CAS check: version must match and state must be OFFERED
    if (refill.version !== expectedVersion || refill.state !== RefillState.OFFERED) {
      return false;
    }

    // The person accepting must be the one who was offered (or grabbing)
    // For a "grab", we allow any eligible volunteer
    if (refill.assigneeId !== volunteerId) {
      // This is a "grab" — check eligibility
      const volunteer = this.volunteers.find((v) => v.id === volunteerId);
      if (!volunteer) return false;
      const eligible = this.assigner.pickNext(refill.officeId, [volunteer], refill);
      if (!eligible) return false;
    }

    // CAS succeeds — commit
    refill.state = RefillState.COMMITTED;
    refill.assigneeId = volunteerId;
    refill.committedAt = this.clock.now();
    refill.version++;

    // Reserve budget — store the exact amount so we can release it later
    const cap = this.budget.getSpendCap(refill.officeId);
    refill.reservedAmount = cap;
    this.budget.reserve(refill.officeId, cap);

    this.assigner.markPendingClaim(volunteerId);

    await this.chat.sendDM(
      volunteerId,
      `✅ You've committed to refill ${refillId}. Please buy snacks and upload the receipt within 24 hours. Budget cap: ${cap.amount / 100} ${cap.currency}.`
    );

    return true;
  }

  /**
   * Volunteer declines the refill offer.
   */
  async declineRefill(refillId: string, volunteerId: string): Promise<void> {
    const refill = this.refills.get(refillId);
    if (!refill) throw new Error(`Refill ${refillId} not found`);
    if (refill.state !== RefillState.OFFERED || refill.assigneeId !== volunteerId) {
      return; // Not their offer to decline
    }

    refill.declinedVolunteerIds.push(volunteerId);
    refill.assigneeId = null;
    refill.offeredAt = null;
    refill.version++;

    // Offer to the next person
    await this.offerToNext(refill);
  }

  // ─── Record purchase ──────────────────────────────────────────────

  /**
   * Volunteer records their purchase (uploads receipt + amount).
   * This immediately submits the claim to HR.
   */
  async recordPurchase(
    refillId: string,
    volunteerId: string,
    amount: Money,
    items: string[],
    receiptImage: string
  ): Promise<void> {
    const refill = this.refills.get(refillId);
    if (!refill) throw new Error(`Refill ${refillId} not found`);
    if (refill.state !== RefillState.COMMITTED || refill.assigneeId !== volunteerId) {
      throw new Error(`Refill ${refillId} is not in COMMITTED state for ${volunteerId}`);
    }

    const now = this.clock.now();
    refill.purchaseAmount = amount;
    refill.purchasedAt = now;
    refill.purchasedItems = items;
    refill.receiptImage = receiptImage;
    refill.state = RefillState.PURCHASED;
    refill.version++;

    // Update budget: release the exact reservation we stored at commit time
    this.budget.recordPurchase(refill.officeId, refill.reservedAmount!, amount);

    // Auto-submit claim to HR (idempotency key = refill ID)
    await this.submitClaimToHR(refill);
  }

  private async submitClaimToHR(refill: Refill): Promise<void> {
    try {
      const response = await this.hr.submitClaim({
        idempotencyKey: refill.id,
        employeeId: refill.assigneeId!,
        amount: refill.purchaseAmount!,
        description: `Snack refill for ${refill.officeId} office. Items: ${refill.purchasedItems.join(", ")}`,
        receiptImage: refill.receiptImage!,
      });

      refill.claimId = response.claimId;
      refill.claimSubmittedAt = this.clock.now();
      refill.state = RefillState.CLAIM_SUBMITTED;
      refill.version++;

      // Clear open refill — the counter is stocked
      this.openRefillByOffice.delete(refill.officeId);

      await this.chat.sendDM(
        refill.assigneeId!,
        `📋 Claim ${response.claimId} submitted to HR for ${refill.purchaseAmount!.amount / 100} ${refill.purchaseAmount!.currency}. You'll be notified when it's processed.`
      );
    } catch (error) {
      // HR submission failed — will retry. Refill stays in PURCHASED state.
      await this.chat.sendDM(
        refill.assigneeId!,
        `⚠️ HR system is temporarily unavailable. Your claim will be retried automatically.`
      );
    }
  }

  /**
   * Retry submitting a claim that previously failed.
   * Uses the same idempotency key, so duplicates are impossible.
   */
  async retryClaimSubmission(refillId: string): Promise<boolean> {
    const refill = this.refills.get(refillId);
    if (!refill || refill.state !== RefillState.PURCHASED) return false;

    await this.submitClaimToHR(refill);
    // After submitClaimToHR, state may have been mutated to CLAIM_SUBMITTED
    return (refill.state as RefillState) === RefillState.CLAIM_SUBMITTED;
  }

  // ─── HR status updates ────────────────────────────────────────────

  /**
   * Process an HR status update (from polling or callback).
   */
  async processClaimResolution(
    refillId: string,
    approved: boolean
  ): Promise<void> {
    const refill = this.refills.get(refillId);
    if (!refill || refill.state !== RefillState.CLAIM_SUBMITTED) return;

    const now = this.clock.now();
    refill.resolvedAt = now;
    refill.version++;

    if (approved) {
      refill.state = RefillState.REIMBURSED;
      this.budget.confirmSpend(refill.officeId, refill.purchaseAmount!, refill.purchasedAt ?? undefined);
      this.assigner.clearPendingClaim(refill.assigneeId!);

      await this.chat.sendDM(
        refill.assigneeId!,
        `💰 Your claim for ${refill.purchaseAmount!.amount / 100} ${refill.purchaseAmount!.currency} has been approved! Reimbursement will appear in your payroll.`
      );
    } else {
      refill.state = RefillState.REJECTED;
      this.budget.rejectSpend(refill.officeId, refill.purchaseAmount!, refill.purchasedAt ?? undefined);
      this.assigner.clearPendingClaim(refill.assigneeId!);

      await this.chat.sendDM(
        refill.assigneeId!,
        `❌ Your claim was rejected by HR. Please contact the coordinator for resolution.`
      );
    }

    // Record completion for fairness tracking
    this.assigner.recordCompletion(refill.assigneeId!, refill.officeId, now);
  }

  // ─── Timeouts ─────────────────────────────────────────────────────

  /**
   * Process all pending timeouts. Call this periodically (or in tests, after advancing the clock).
   */
  async processTimeouts(): Promise<void> {
    const now = this.clock.now();

    for (const refill of this.refills.values()) {
      // Offer timeout: 4 hours
      if (
        refill.state === RefillState.OFFERED &&
        refill.offeredAt &&
        now.getTime() - refill.offeredAt.getTime() >= OFFER_TIMEOUT_MS
      ) {
        refill.declinedVolunteerIds.push(refill.assigneeId!);
        refill.assigneeId = null;
        refill.offeredAt = null;
        refill.version++;

        await this.offerToNext(refill);
      }

      // Purchase timeout: 24 hours
      if (
        refill.state === RefillState.COMMITTED &&
        refill.committedAt &&
        now.getTime() - refill.committedAt.getTime() >= PURCHASE_TIMEOUT_MS
      ) {
        // Release the exact reservation we stored at commit time
        this.budget.releaseReservation(refill.officeId, refill.reservedAmount!);
        this.assigner.clearPendingClaim(refill.assigneeId!);

        refill.declinedVolunteerIds.push(refill.assigneeId!);

        await this.chat.sendDM(
          refill.assigneeId!,
          `⏰ Your 24-hour window to purchase snacks for ${refill.officeId} has expired. The task will be reassigned.`
        );

        refill.assigneeId = null;
        refill.committedAt = null;
        refill.reservedAmount = null;
        refill.version++;

        await this.offerToNext(refill);
      }
    }
  }

  // ─── Queries ──────────────────────────────────────────────────────

  getRefill(id: string): Refill | undefined {
    return this.refills.get(id);
  }

  getOpenRefill(officeId: OfficeId): Refill | undefined {
    const id = this.openRefillByOffice.get(officeId);
    return id ? this.refills.get(id) : undefined;
  }

  getAllRefills(): Refill[] {
    return Array.from(this.refills.values());
  }
}
