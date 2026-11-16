/**
 * Tests for HR claim submission:
 *   - Automatic claim creation upon purchase
 *   - Idempotency key (refill ID) prevents duplicate submissions on retry
 *   - Transient failure and recovery
 *   - HR approval and rejection flows
 */

import { RefillState, fromMajor } from "../src/domain";
import { createTestSystem } from "./helpers";

describe("Claim & HR Integration", () => {
  it("automatically submits claim to HR with refill ID as idempotency key", async () => {
    const sys = createTestSystem();

    const refill = await sys.refillService.reportEmpty("oslo", "reporter-1");
    await sys.refillService.acceptRefill(refill.id, refill.assigneeId!, refill.version);

    await sys.refillService.recordPurchase(
      refill.id,
      refill.assigneeId!,
      fromMajor(750, "NOK"),
      ["soda", "nuts"],
      "receipt-123.png"
    );

    expect(refill.state).toBe(RefillState.CLAIM_SUBMITTED);
    expect(refill.claimId).toBe("CLM-1");

    const claims = sys.hr.getAllClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0].idempotencyKey).toBe(refill.id);
    expect(claims[0].employeeId).toBe(refill.assigneeId);
    expect(claims[0].amount.amount).toBe(75_000);
    expect(claims[0].amount.currency).toBe("NOK");
  });

  it("retrying claim submission does not produce duplicate claims in HR (idempotency)", async () => {
    const sys = createTestSystem();

    // Make HR fail on first call
    sys.hr.failNextSubmissions(1);

    const refill = await sys.refillService.reportEmpty("oslo", "reporter-1");
    await sys.refillService.acceptRefill(refill.id, refill.assigneeId!, refill.version);

    // Purchase attempt 1: HR fails, refill stays in PURCHASED state
    await sys.refillService.recordPurchase(
      refill.id,
      refill.assigneeId!,
      fromMajor(600, "NOK"),
      ["chips"],
      "receipt-abc.png"
    );

    expect(refill.state).toBe(RefillState.PURCHASED);
    expect(sys.hr.claimCount).toBe(0);

    // Retry succeeds
    const success = await sys.refillService.retryClaimSubmission(refill.id);
    expect(success).toBe(true);
    expect(refill.state).toBe(RefillState.CLAIM_SUBMITTED);
    expect(sys.hr.claimCount).toBe(1);

    const firstClaimId = refill.claimId;

    // Redundant retry to simulate re-delivery: idempotency key returns existing claim without incrementing count
    await sys.hr.submitClaim({
      idempotencyKey: refill.id,
      employeeId: refill.assigneeId!,
      amount: fromMajor(600, "NOK"),
      description: "redundant retry",
      receiptImage: "receipt-abc.png",
    });

    expect(sys.hr.claimCount).toBe(1);
    expect(refill.claimId).toBe(firstClaimId);
  });

  it("handles HR claim rejection and releases volunteer pending flag", async () => {
    const sys = createTestSystem();

    const refill = await sys.refillService.reportEmpty("oslo", "reporter-1");
    const buyerId = refill.assigneeId!;
    await sys.refillService.acceptRefill(refill.id, buyerId, refill.version);

    await sys.refillService.recordPurchase(
      refill.id,
      buyerId,
      fromMajor(400, "NOK"),
      ["apples"],
      "receipt-reject.png"
    );

    expect(refill.state).toBe(RefillState.CLAIM_SUBMITTED);

    // Process HR rejection
    await sys.refillService.processClaimResolution(refill.id, false);

    expect(refill.state).toBe(RefillState.REJECTED);

    // Budget ledger pending amount should be released
    const totals = sys.budget.getMonthTotals("oslo");
    expect(totals.pending.amount).toBe(0);
    expect(totals.spent.amount).toBe(0);

    // Volunteer should be cleared from pending claims and able to be assigned again
    const nextRefill = await sys.refillService.reportEmpty("oslo", "reporter-2");
    // Buyer is available
    expect(nextRefill.assigneeId).toBeTruthy();
  });
});
