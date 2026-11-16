/**
 * Tests verifying the bug fixes and edge case resolutions:
 *   1. Reserved budget is released using the stored amount on Refill, not dynamic cap
 *   2. Cross-month HR approval updates the purchase month's ledger entry
 *   3. Escalated refill clears openRefillByOffice so subsequent refills are not blocked
 */

import { RefillState, fromMajor } from "../src/domain";
import { createTestSystem } from "./helpers";

describe("Bug Fix Verifications & Resilience", () => {
  it("releases exact stored reservation even if budget cap changed after commit", async () => {
    const sys = createTestSystem();

    // 1. Oslo counter reported empty
    const refill = await sys.refillService.reportEmpty("oslo", "user-1");
    // Initial cap is 1200 NOK (120_000 øre)
    await sys.refillService.acceptRefill(refill.id, refill.assigneeId!, refill.version);

    expect(refill.reservedAmount?.amount).toBe(120_000);
    expect(sys.budget.remaining("oslo").amount).toBe(480_000); // 6000 - 1200 = 4800 NOK

    // 2. Simulate another transaction altering the budget ledger directly
    sys.budget.reserve("oslo", fromMajor(4000, "NOK"));
    // Available budget now is 800 NOK (< maxPurchase 1200 NOK)
    expect(sys.budget.getSpendCap("oslo").amount).toBe(80_000); // 800 NOK

    // 3. Original refill purchases 500 NOK
    // If it used dynamic getSpendCap(), it would release 800 NOK and record 500 NOK pending (leaving 4000 + 400 + 500 = 4900 used -> wrong!)
    // With stored reservedAmount, it cleanly releases 1200 NOK and records 500 NOK pending
    await sys.refillService.recordPurchase(
      refill.id,
      refill.assigneeId!,
      fromMajor(500, "NOK"),
      ["nuts"],
      "receipt.jpg"
    );

    // Remaining = 6000 - 4000 (manual) - 500 (actual pending) = 1500 NOK (150_000 øre)
    expect(sys.budget.remaining("oslo").amount).toBe(150_000);
  });

  it("updates purchase month ledger when HR approves in the subsequent month", async () => {
    // Start on Nov 25
    const sys = createTestSystem({ startDate: new Date("2026-11-25T10:00:00Z") });

    const refill = await sys.refillService.reportEmpty("oslo", "user-1");
    await sys.refillService.acceptRefill(refill.id, refill.assigneeId!, refill.version);
    await sys.refillService.recordPurchase(
      refill.id,
      refill.assigneeId!,
      fromMajor(600, "NOK"),
      ["fruit"],
      "receipt.jpg"
    );

    // November ledger has 600 NOK pending
    const novBefore = sys.budget.getMonthTotals("oslo", "2026-11");
    expect(novBefore.pending.amount).toBe(60_000);
    expect(novBefore.spent.amount).toBe(0);

    // Advance clock 10 days into December (approval takes 1-10 days)
    sys.clock.advanceDays(10); // Now Dec 5, 2026

    // December ledger starts at 0
    const decBefore = sys.budget.getMonthTotals("oslo", "2026-12");
    expect(decBefore.pending.amount).toBe(0);
    expect(decBefore.spent.amount).toBe(0);

    // HR approves claim in December
    await sys.refillService.processClaimResolution(refill.id, true);

    // November ledger should have moved pending -> spent
    const novAfter = sys.budget.getMonthTotals("oslo", "2026-11");
    expect(novAfter.pending.amount).toBe(0);
    expect(novAfter.spent.amount).toBe(60_000);

    // December ledger remains clean (0 spent, 0 pending)
    const decAfter = sys.budget.getMonthTotals("oslo", "2026-12");
    expect(decAfter.pending.amount).toBe(0);
    expect(decAfter.spent.amount).toBe(0);
  });

  it("escalation clears openRefill slot so subsequent refills can be created", async () => {
    const sys = createTestSystem();

    // 1. Report empty
    const refill1 = await sys.refillService.reportEmpty("oslo", "user-1");

    // All volunteers decline -> state becomes ESCALATED
    for (let i = 0; i < 3; i++) {
      if (refill1.state === RefillState.OFFERED && refill1.assigneeId) {
        await sys.refillService.declineRefill(refill1.id, refill1.assigneeId);
      }
    }

    expect(refill1.state).toBe(RefillState.ESCALATED);
    expect(sys.refillService.getOpenRefill("oslo")).toBeUndefined();

    // 2. Later, when a coordinator adds more volunteers or resets, someone reports empty again
    const refill2 = await sys.refillService.reportEmpty("oslo", "user-2");

    // Should create a brand new refill rather than merging into the dead ESCALATED one
    expect(refill2.id).not.toBe(refill1.id);
  });
});
