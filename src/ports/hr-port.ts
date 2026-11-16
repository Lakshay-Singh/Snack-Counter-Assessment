/**
 * Port for the external HR reimbursement system.
 * Production: HTTP adapter. Tests: FakeHR.
 */

import { ClaimStatus, Money } from "../domain";

export interface SubmitClaimRequest {
  /** Refill ID — used as idempotency key */
  idempotencyKey: string;
  employeeId: string;
  amount: Money;
  description: string;
  receiptImage: string;
}

export interface SubmitClaimResponse {
  claimId: string;
  status: ClaimStatus;
}

export interface HRPort {
  /**
   * Submit a reimbursement claim. If a claim with the same idempotency key
   * was already submitted, return the existing claim without creating a duplicate.
   */
  submitClaim(request: SubmitClaimRequest): Promise<SubmitClaimResponse>;

  /** Poll the status of an existing claim. */
  getClaimStatus(claimId: string): Promise<ClaimStatus>;
}
