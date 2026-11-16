/**
 * Tests for Visiting Volunteers & Currency Mismatch:
 *   - A Bengaluru employee visiting Oslo buys snacks in Oslo.
 *   - Oslo budget is charged in NOK (receipt currency).
 *   - Claim records employee ID and NOK amount.
 *   - Volunteer's payroll currency remains INR (for HR payout), but Oslo budget is untouched by INR fluctuations.
 */

import { Volunteer, fromMajor } from "../src/domain";
import { createTestSystem } from "./helpers";

describe("Visitor & Currency Mismatch Handling", () => {
  it("visiting Bengaluru employee refills Oslo counter: Oslo budget charged in NOK, claim created with employee ID", async () => {
    const visitor: Volunteer = {
      id: "blr-visitor-1",
      name: "Ravi Shankar",
      homeOfficeId: "bengaluru",
      visitingOfficeId: "oslo",
      visitingUntil: new Date("2026-11-25T00:00:00Z"),
      payrollCurrency: "INR", // Gets paid in INR by HR
    };

    const sys = createTestSystem({
      volunteers: [visitor],
      startDate: new Date("2026-11-15T10:00:00Z"),
    });

    const initialOsloBudget = sys.budget.remaining("oslo");
    const initialBlrBudget = sys.budget.remaining("bengaluru");

    // 1. Oslo box goes empty
    const refill = await sys.refillService.reportEmpty("oslo", "oslo-colleague");

    // Ravi is visiting Oslo, so he is offered the refill
    expect(refill.assigneeId).toBe("blr-visitor-1");

    // 2. Ravi accepts
    const accepted = await sys.refillService.acceptRefill(refill.id, visitor.id, refill.version);
    expect(accepted).toBe(true);

    // 3. Ravi buys snacks in Oslo using NOK (e.g. 900 NOK)
    const purchaseAmount = fromMajor(900, "NOK");
    await sys.refillService.recordPurchase(
      refill.id,
      visitor.id,
      purchaseAmount,
      ["chocolates", "sparkling water"],
      "receipt-oslo-store.png"
    );

    // 4. Verify claim submitted to HR
    const claims = sys.hr.getAllClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0].employeeId).toBe("blr-visitor-1");
    expect(claims[0].amount.currency).toBe("NOK"); // Claim is in NOK!
    expect(claims[0].amount.amount).toBe(90_000);

    // 5. Verify Oslo budget: charged 900 NOK
    const remainingOslo = sys.budget.remaining("oslo");
    expect(remainingOslo.amount).toBe(initialOsloBudget.amount - 90_000);
    expect(remainingOslo.currency).toBe("NOK");

    // 6. Verify Bengaluru budget is completely UNTOUCHED
    const remainingBlr = sys.budget.remaining("bengaluru");
    expect(remainingBlr.amount).toBe(initialBlrBudget.amount);
    expect(remainingBlr.currency).toBe("INR");

    // 7. Approve claim
    await sys.refillService.processClaimResolution(refill.id, true);

    const osloTotals = sys.budget.getMonthTotals("oslo");
    expect(osloTotals.spent.amount).toBe(90_000);
    expect(osloTotals.spent.currency).toBe("NOK");
  });
});
