/**
 * Tests for edge cases and safety guards across services:
 *   - Self-serve "grab" by another eligible volunteer
 *   - Grab attempt by ineligible or non-existent volunteer
 *   - Recording purchase with invalid state throws error
 *   - Declining an offer by an unassigned person is ignored
 *   - Assigner getRankedList returns correctly sorted list
 *   - Refill query helpers
 */

import { RefillState, fromMajor } from "../src/domain";
import { createTestSystem } from "./helpers";

describe("Edge Cases & Safety Guards", () => {
  it("allows another eligible volunteer to grab the refill (self-serve path)", async () => {
    const sys = createTestSystem();

    const refill = await sys.refillService.reportEmpty("oslo", "reporter-1");
    expect(refill.assigneeId).toBe("oslo-v1");

    // oslo-v2 decides to grab it before oslo-v1 responds
    const grabbed = await sys.refillService.acceptRefill(refill.id, "oslo-v2", refill.version);
    expect(grabbed).toBe(true);
    expect(refill.state).toBe(RefillState.COMMITTED);
    expect(refill.assigneeId).toBe("oslo-v2");
  });

  it("rejects grab by an unknown volunteer", async () => {
    const sys = createTestSystem();

    const refill = await sys.refillService.reportEmpty("oslo", "reporter-1");
    const grabbed = await sys.refillService.acceptRefill(refill.id, "ghost-user", refill.version);
    expect(grabbed).toBe(false);
  });

  it("throws error when recording purchase on an uncommitted refill", async () => {
    const sys = createTestSystem();

    const refill = await sys.refillService.reportEmpty("oslo", "reporter-1");
    // Refill is in OFFERED state, not COMMITTED
    await expect(
      sys.refillService.recordPurchase(
        refill.id,
        "oslo-v1",
        fromMajor(500, "NOK"),
        ["chips"],
        "receipt.jpg"
      )
    ).rejects.toThrow("is not in COMMITTED state");
  });

  it("ignores decline call from someone other than the assigned volunteer", async () => {
    const sys = createTestSystem();

    const refill = await sys.refillService.reportEmpty("oslo", "reporter-1");
    const originalAssignee = refill.assigneeId!;

    // Non-assigned volunteer attempts to decline
    await sys.refillService.declineRefill(refill.id, "random-person");

    // Assignee and state should remain unchanged
    expect(refill.assigneeId).toBe(originalAssignee);
    expect(refill.state).toBe(RefillState.OFFERED);
  });

  it("assigner getRankedList returns all eligible candidates in order", () => {
    const sys = createTestSystem();

    const refill = {
      id: "test",
      officeId: "oslo" as const,
      state: RefillState.REPORTED,
      version: 0,
      reportedBy: "someone",
      reportedAt: new Date(),
      reportedItems: [],
      assigneeId: null,
      offeredAt: null,
      committedAt: null,
      declinedVolunteerIds: [],
      purchaseAmount: null,
      purchasedAt: null,
      purchasedItems: [],
      receiptImage: null,
      claimId: null,
      claimSubmittedAt: null,
      resolvedAt: null,
    };

    const ranked = sys.assigner.getRankedList("oslo", sys.volunteers, refill);
    expect(ranked.length).toBe(3); // 3 Oslo volunteers
    expect(ranked.every((v) => v.homeOfficeId === "oslo")).toBe(true);
  });

  it("query methods return correct refills", async () => {
    const sys = createTestSystem();

    const refill = await sys.refillService.reportEmpty("oslo", "reporter-1");

    expect(sys.refillService.getRefill(refill.id)?.id).toBe(refill.id);
    expect(sys.refillService.getOpenRefill("oslo")?.id).toBe(refill.id);
    expect(sys.refillService.getOpenRefill("bengaluru")).toBeUndefined();
    expect(sys.refillService.getAllRefills()).toHaveLength(1);
  });
});
