/**
 * In-memory fake HR system.
 * - Respects idempotency keys (duplicate submissions return the same claim).
 * - Configurable: auto-approve, auto-reject, or stay pending.
 * - Can simulate failures for retry testing.
 */

import { ClaimStatus, Money } from "../domain";
import { HRPort, SubmitClaimRequest, SubmitClaimResponse } from "../ports/hr-port";

export type FakeHRBehavior = "auto-approve" | "auto-reject" | "stay-pending";

interface StoredClaim {
  claimId: string;
  idempotencyKey: string;
  employeeId: string;
  amount: Money;
  description: string;
  receiptImage: string;
  status: ClaimStatus;
}

export class FakeHR implements HRPort {
  private claims = new Map<string, StoredClaim>();
  /** idempotency key → claim ID */
  private idempotencyIndex = new Map<string, string>();
  private nextId = 1;
  private failCount = 0;

  constructor(private behavior: FakeHRBehavior = "auto-approve") {}

  /** Make the next N submissions throw an error (for retry testing) */
  failNextSubmissions(count: number): void {
    this.failCount = count;
  }

  /** Change behavior for subsequent claims */
  setBehavior(behavior: FakeHRBehavior): void {
    this.behavior = behavior;
  }

  /** Manually approve or reject a specific claim (for controlled tests) */
  resolveClaim(claimId: string, status: ClaimStatus.APPROVED | ClaimStatus.REJECTED): void {
    const claim = this.claims.get(claimId);
    if (!claim) throw new Error(`Claim ${claimId} not found`);
    claim.status = status === ClaimStatus.APPROVED ? ClaimStatus.APPROVED : ClaimStatus.REJECTED;
  }

  async submitClaim(request: SubmitClaimRequest): Promise<SubmitClaimResponse> {
    // Simulate transient failure
    if (this.failCount > 0) {
      this.failCount--;
      throw new Error("HR system temporarily unavailable");
    }

    // Idempotency: return existing claim if same key was already submitted
    const existingClaimId = this.idempotencyIndex.get(request.idempotencyKey);
    if (existingClaimId) {
      const existing = this.claims.get(existingClaimId)!;
      return { claimId: existing.claimId, status: existing.status };
    }

    const claimId = `CLM-${this.nextId++}`;
    const status =
      this.behavior === "auto-approve"
        ? ClaimStatus.APPROVED
        : this.behavior === "auto-reject"
          ? ClaimStatus.REJECTED
          : ClaimStatus.PENDING;

    const stored: StoredClaim = {
      claimId,
      idempotencyKey: request.idempotencyKey,
      employeeId: request.employeeId,
      amount: request.amount,
      description: request.receiptImage,
      receiptImage: request.receiptImage,
      status,
    };

    this.claims.set(claimId, stored);
    this.idempotencyIndex.set(request.idempotencyKey, claimId);

    return { claimId, status };
  }

  async getClaimStatus(claimId: string): Promise<ClaimStatus> {
    const claim = this.claims.get(claimId);
    if (!claim) throw new Error(`Claim ${claimId} not found`);
    return claim.status;
  }

  /** Test helper: get all submitted claims */
  getAllClaims(): StoredClaim[] {
    return Array.from(this.claims.values());
  }

  /** Test helper: number of unique claims created (not counting idempotent retries) */
  get claimCount(): number {
    return this.claims.size;
  }
}
