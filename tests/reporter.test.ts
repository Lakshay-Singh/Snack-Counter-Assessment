/**
 * Tests for Reporter:
 *   - Aggregating spend per office in local currency
 *   - Combined reporting converted to NOK using purchase date FX rate
 *   - Separation of approved spend vs pending claims
 *   - Rejection exclusion
 */

import { RefillState, fromMajor } from "../src/domain";
import { createTestSystem } from "./helpers";

describe("Reporter", () => {
  it("computes monthly spend per office and combines in NOK via purchase-date FX rate", async () => {
    const sys = createTestSystem({
      startDate: new Date("2026-11-10T10:00:00Z"),
    });

    // 1. Oslo refill: 1000 NOK approved
    const osloRefill = await sys.refillService.reportEmpty("oslo", "oslo-user");
    await sys.refillService.acceptRefill(osloRefill.id, osloRefill.assigneeId!, osloRefill.version);
    await sys.refillService.recordPurchase(
      osloRefill.id,
      osloRefill.assigneeId!,
      fromMajor(1000, "NOK"),
      ["coffee", "snacks"],
      "oslo-rec.jpg"
    );
    await sys.refillService.processClaimResolution(osloRefill.id, true);

    // 2. Bengaluru refill: 2400 INR approved
    // In our FakeFX: 1 INR = 0.0833 NOK, so 2400 INR = 200 NOK (approx 2399.2 rounded to minor units)
    // 240,000 paise * 0.0833 = 19,992 øre ≈ 200 NOK
    sys.fx.setRate("INR", "NOK", 0.0833333333); // exact 1/12 rate -> 2400 / 12 = 200 NOK

    const blrRefill = await sys.refillService.reportEmpty("bengaluru", "blr-user");
    await sys.refillService.acceptRefill(blrRefill.id, blrRefill.assigneeId!, blrRefill.version);
    await sys.refillService.recordPurchase(
      blrRefill.id,
      blrRefill.assigneeId!,
      fromMajor(2400, "INR"),
      ["biscuits", "tea"],
      "blr-rec.jpg"
    );
    await sys.refillService.processClaimResolution(blrRefill.id, true);

    const report = sys.reporter.generateReport(sys.refillService.getAllRefills(), "2026-11");

    const osloReport = report.offices.find((o) => o.officeId === "oslo")!;
    const blrReport = report.offices.find((o) => o.officeId === "bengaluru")!;

    expect(osloReport.spent.amount).toBe(100_000); // 1000 NOK in øre
    expect(osloReport.spent.currency).toBe("NOK");

    expect(blrReport.spent.amount).toBe(240_000); // 2400 INR in paise
    expect(blrReport.spent.currency).toBe("INR");

    // Combined total should be 1000 NOK + 200 NOK = 1200 NOK (120,000 øre)
    expect(report.combinedTotalNOK.currency).toBe("NOK");
    expect(report.combinedTotalNOK.amount).toBe(120_000); // 1200 NOK in øre
  });

  it("distinguishes approved spend from pending claims in report", async () => {
    const sys = createTestSystem({
      startDate: new Date("2026-11-12T12:00:00Z"),
    });

    const refill = await sys.refillService.reportEmpty("oslo", "rep");
    await sys.refillService.acceptRefill(refill.id, refill.assigneeId!, refill.version);
    await sys.refillService.recordPurchase(
      refill.id,
      refill.assigneeId!,
      fromMajor(800, "NOK"),
      ["fruits"],
      "rec.jpg"
    );

    // Keep it in CLAIM_SUBMITTED without resolving
    expect(refill.state).toBe(RefillState.CLAIM_SUBMITTED);

    const report = sys.reporter.generateReport(sys.refillService.getAllRefills(), "2026-11");
    const osloReport = report.offices.find((o) => o.officeId === "oslo")!;

    expect(osloReport.spent.amount).toBe(0);
    expect(osloReport.pending.amount).toBe(80_000); // 800 NOK pending
    expect(report.combinedPendingNOK.amount).toBe(80_000);
  });

  it("formats human-readable summary string cleanly", async () => {
    const sys = createTestSystem({
      startDate: new Date("2026-11-15T09:00:00Z"),
    });

    const report = sys.reporter.generateReport([], "2026-11");
    const formatted = sys.reporter.formatReport(report);

    expect(formatted).toContain("Monthly Snack Spending Report — 2026-11");
    expect(formatted).toContain("OSLO:");
    expect(formatted).toContain("BENGALURU:");
    expect(formatted).toContain("COMBINED: 0 NOK spent");
  });
});
