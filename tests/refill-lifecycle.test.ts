/**
 * Tests for the refill lifecycle — the core state machine.
 *
 * Covers:
 *   - Happy path: REPORTED → OFFERED → COMMITTED → PURCHASED → CLAIM_SUBMITTED → REIMBURSED
 *   - Decline → reassign
 *   - Timeout → reassign
 *   - All volunteers exhausted → ESCALATED
 *   - Duplicate reports merge into existing refill
 */

import { RefillState, fromMajor } from "../src/domain";
import { createTestSystem } from "./helpers";

describe("Refill Lifecycle", () => {
  it("happy path: empty → reimbursed", async () => {
    const sys = createTestSystem();

    // 1. Report empty
    const refill = await sys.refillService.reportEmpty("oslo", "reporter-1", ["chips", "cookies"]);
    expect(refill.state).toBe(RefillState.OFFERED);
    expect(refill.assigneeId).toBeTruthy();

    // 2. Accept
    const accepted = await sys.refillService.acceptRefill(refill.id, refill.assigneeId!, refill.version);
    expect(accepted).toBe(true);
    expect(refill.state).toBe(RefillState.COMMITTED);

    // 3. Purchase
    await sys.refillService.recordPurchase(
      refill.id,
      refill.assigneeId!,
      fromMajor(500, "NOK"),
      ["chips", "cookies", "juice"],
      "receipt-001.jpg"
    );
    // HR is auto-approve, so it should go straight to CLAIM_SUBMITTED
    expect(refill.state).toBe(RefillState.CLAIM_SUBMITTED);
    expect(refill.claimId).toBeTruthy();

    // 4. HR approves
    await sys.refillService.processClaimResolution(refill.id, true);
    expect(refill.state).toBe(RefillState.REIMBURSED);
  });

  it("decline → offered to next volunteer", async () => {
    const sys = createTestSystem();

    const refill = await sys.refillService.reportEmpty("oslo", "reporter-1", ["nuts"]);
    const firstAssignee = refill.assigneeId!;
    expect(refill.state).toBe(RefillState.OFFERED);

    // First person declines
    await sys.refillService.declineRefill(refill.id, firstAssignee);

    // Should be offered to someone else
    expect(refill.state).toBe(RefillState.OFFERED);
    expect(refill.assigneeId).not.toBe(firstAssignee);
    expect(refill.declinedVolunteerIds).toContain(firstAssignee);
  });

  it("offer timeout (4h) → reassigned to next volunteer", async () => {
    const sys = createTestSystem();

    const refill = await sys.refillService.reportEmpty("oslo", "reporter-1");
    const firstAssignee = refill.assigneeId!;

    // Advance 4 hours
    sys.clock.advanceHours(4);
    await sys.refillService.processTimeouts();

    expect(refill.assigneeId).not.toBe(firstAssignee);
    expect(refill.declinedVolunteerIds).toContain(firstAssignee);
  });

  it("purchase timeout (24h) → reassigned to next volunteer", async () => {
    const sys = createTestSystem();

    const refill = await sys.refillService.reportEmpty("oslo", "reporter-1");
    await sys.refillService.acceptRefill(refill.id, refill.assigneeId!, refill.version);
    const committedPerson = refill.assigneeId!;
    expect(refill.state).toBe(RefillState.COMMITTED);

    // Advance 24 hours without purchasing
    sys.clock.advanceHours(24);
    await sys.refillService.processTimeouts();

    expect(refill.assigneeId).not.toBe(committedPerson);
    expect(refill.declinedVolunteerIds).toContain(committedPerson);
  });

  it("all volunteers exhausted → ESCALATED", async () => {
    const sys = createTestSystem();
    // Only 3 Oslo volunteers by default

    const refill = await sys.refillService.reportEmpty("oslo", "reporter-1");

    // All three decline
    for (let i = 0; i < 3; i++) {
      if (refill.state === RefillState.OFFERED && refill.assigneeId) {
        await sys.refillService.declineRefill(refill.id, refill.assigneeId);
      }
    }

    expect(refill.state).toBe(RefillState.ESCALATED);
    // Coordinator should be notified via channel
    const channelMessages = sys.chat.channelMessages("oslo");
    expect(channelMessages.some((m) => m.message.includes("No volunteers available"))).toBe(true);
  });

  it("duplicate empty reports merge into existing refill", async () => {
    const sys = createTestSystem();

    const refill1 = await sys.refillService.reportEmpty("oslo", "person-A", ["chips"]);
    const refill2 = await sys.refillService.reportEmpty("oslo", "person-B", ["cookies"]);

    // Same refill object — merged
    expect(refill2.id).toBe(refill1.id);
    expect(refill2.reportedItems).toContain("chips");
    expect(refill2.reportedItems).toContain("cookies");
  });

  it("rejected claim sets state to REJECTED", async () => {
    const sys = createTestSystem();
    sys.hr.setBehavior("auto-approve"); // claim submission still succeeds

    const refill = await sys.refillService.reportEmpty("oslo", "reporter-1");
    await sys.refillService.acceptRefill(refill.id, refill.assigneeId!, refill.version);
    await sys.refillService.recordPurchase(
      refill.id, refill.assigneeId!, fromMajor(500, "NOK"), ["chips"], "receipt.jpg"
    );

    // HR rejects
    await sys.refillService.processClaimResolution(refill.id, false);
    expect(refill.state).toBe(RefillState.REJECTED);
  });
});
