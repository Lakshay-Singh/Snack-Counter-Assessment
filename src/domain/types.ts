/**
 * Core domain types for the Snack Counter system.
 */

import { Currency, Money } from "./money";

// ─── Office ──────────────────────────────────────────────────────────

export type OfficeId = "oslo" | "bengaluru";

export interface OfficeConfig {
  readonly id: OfficeId;
  readonly currency: Currency;
  /** Monthly budget in minor units */
  readonly monthlyBudget: Money;
  /** Minimum single purchase in minor units */
  readonly minPurchase: Money;
  /** Maximum single purchase in minor units */
  readonly maxPurchase: Money;
  /** IANA timezone identifier */
  readonly timezone: string;
}

// ─── Volunteer ───────────────────────────────────────────────────────

export interface Volunteer {
  readonly id: string;
  readonly name: string;
  /** The office this volunteer belongs to */
  readonly homeOfficeId: OfficeId;
  /** If visiting another office, which one and until when */
  readonly visitingOfficeId?: OfficeId;
  readonly visitingUntil?: Date;
  /** Self-declared away-until date (holiday, WFH) */
  readonly awayUntil?: Date;
  /** The currency HR pays this person in (their payroll currency) */
  readonly payrollCurrency: Currency;
}

// ─── Refill ──────────────────────────────────────────────────────────

export enum RefillState {
  /** Someone reported the box empty */
  REPORTED = "REPORTED",
  /** An offer has been sent to a specific volunteer */
  OFFERED = "OFFERED",
  /** A volunteer accepted — they have 24h to buy */
  COMMITTED = "COMMITTED",
  /** Volunteer purchased and uploaded receipt */
  PURCHASED = "PURCHASED",
  /** Claim auto-submitted to HR */
  CLAIM_SUBMITTED = "CLAIM_SUBMITTED",
  /** HR approved and reimbursed */
  REIMBURSED = "REIMBURSED",
  /** HR rejected the claim */
  REJECTED = "REJECTED",
  /** All volunteers exhausted — needs coordinator action */
  ESCALATED = "ESCALATED",
}

export interface Refill {
  readonly id: string;
  readonly officeId: OfficeId;
  state: RefillState;
  /** CAS version counter — incremented on every state change */
  version: number;
  /** Who reported the empty box */
  readonly reportedBy: string;
  readonly reportedAt: Date;
  /** What items were reported empty */
  readonly reportedItems: string[];
  /** Currently offered/committed volunteer */
  assigneeId: string | null;
  /** When the current offer was sent */
  offeredAt: Date | null;
  /** When the volunteer accepted */
  committedAt: Date | null;
  /** Volunteers who have already declined or timed out for this refill */
  declinedVolunteerIds: string[];
  /** Budget amount reserved when this refill was committed */
  reservedAmount: Money | null;
  /** Purchase details — filled when volunteer uploads receipt */
  purchaseAmount: Money | null;
  purchasedAt: Date | null;
  purchasedItems: string[];
  /** Receipt image reference (just a path/URL string) */
  receiptImage: string | null;
  /** HR claim ID returned by the external system */
  claimId: string | null;
  claimSubmittedAt: Date | null;
  resolvedAt: Date | null;
}

// ─── Claim ───────────────────────────────────────────────────────────

export enum ClaimStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}

export interface Claim {
  readonly id: string;
  /** Refill ID doubles as the idempotency key */
  readonly refillId: string;
  readonly employeeId: string;
  readonly amount: Money;
  readonly description: string;
  readonly receiptImage: string;
  status: ClaimStatus;
  submittedAt: Date;
  resolvedAt: Date | null;
}
