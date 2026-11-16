/**
 * Tests for Timezone Handling:
 *   - Oslo (UTC+1 / Europe/Oslo) vs Bengaluru (UTC+5:30 / Asia/Kolkata)
 *   - Verifies that month bucketing uses the office's local calendar time,
 *     not server UTC.
 */

import { fromMajor } from "../src/domain";
import { createTestSystem } from "./helpers";

describe("Timezone & Month Boundaries", () => {
  it("correctly buckets spend according to office local timezone on month transition", async () => {
    // 2026-10-31T20:00:00Z:
    // Oslo local time (CET, UTC+1): 2026-10-31 21:00:00 (Still October)
    // Bengaluru local time (IST, UTC+5:30): 2026-11-01 01:30:00 (Already November!)
    const boundaryTime = new Date("2026-10-31T20:00:00Z");

    const sys = createTestSystem({ startDate: boundaryTime });

    // 1. Oslo purchase at boundary
    const osloRefill = await sys.refillService.reportEmpty("oslo", "oslo-user");
    await sys.refillService.acceptRefill(osloRefill.id, osloRefill.assigneeId!, osloRefill.version);
    await sys.refillService.recordPurchase(
      osloRefill.id,
      osloRefill.assigneeId!,
      fromMajor(500, "NOK"),
      ["cookies"],
      "receipt-oslo.jpg"
    );
    await sys.refillService.processClaimResolution(osloRefill.id, true);

    // 2. Bengaluru purchase at the exact same instant
    const blrRefill = await sys.refillService.reportEmpty("bengaluru", "blr-user");
    await sys.refillService.acceptRefill(blrRefill.id, blrRefill.assigneeId!, blrRefill.version);
    await sys.refillService.recordPurchase(
      blrRefill.id,
      blrRefill.assigneeId!,
      fromMajor(1500, "INR"),
      ["samosas"],
      "receipt-blr.jpg"
    );
    await sys.refillService.processClaimResolution(blrRefill.id, true);

    // Check October report
    const octoberReport = sys.reporter.generateReport(sys.refillService.getAllRefills(), "2026-10");
    const osloOct = octoberReport.offices.find((o) => o.officeId === "oslo")!;
    const blrOct = octoberReport.offices.find((o) => o.officeId === "bengaluru")!;

    expect(osloOct.spent.amount).toBe(50_000); // 500 NOK in October
    expect(blrOct.spent.amount).toBe(0);      // 0 in October because it's already November in Bengaluru

    // Check November report
    const novemberReport = sys.reporter.generateReport(sys.refillService.getAllRefills(), "2026-11");
    const osloNov = novemberReport.offices.find((o) => o.officeId === "oslo")!;
    const blrNov = novemberReport.offices.find((o) => o.officeId === "bengaluru")!;

    expect(osloNov.spent.amount).toBe(0);        // 0 in November for Oslo
    expect(blrNov.spent.amount).toBe(150_000);   // 1500 INR in November for Bengaluru
  });
});
