/**
 * Tests for BudgetLedger — budget tracking with reservations.
 *
 * Covers:
 *   - Remaining budget calculation
 *   - Reservations reduce available budget
 *   - Pending claims reduce available budget
 *   - Two purchases close together cannot overshoot budget
 *   - Budget is per-office, per-month
 */

import { fromMajor } from "../src/domain";
import { createTestSystem } from "./helpers";

describe("BudgetLedger", () => {
  it("starts with full monthly budget", () => {
    const sys = createTestSystem();
    const remaining = sys.budget.remaining("oslo");
    expect(remaining.amount).toBe(600_000); // 6000 NOK in øre
    expect(remaining.currency).toBe("NOK");
  });

  it("reservation reduces available budget", () => {
    const sys = createTestSystem();

    sys.budget.reserve("oslo", fromMajor(1000, "NOK"));
    const remaining = sys.budget.remaining("oslo");
    expect(remaining.amount).toBe(500_000); // 5000 NOK
  });

  it("recording a purchase moves from reserved to pending", () => {
    const sys = createTestSystem();

    // Reserve 1200 NOK (max purchase)
    const reserved = fromMajor(1200, "NOK");
    sys.budget.reserve("oslo", reserved);
    expect(sys.budget.remaining("oslo").amount).toBe(480_000); // 4800 NOK

    // Actual purchase was 800 NOK
    const actual = fromMajor(800, "NOK");
    sys.budget.recordPurchase("oslo", reserved, actual);

    // Remaining = 6000 - 800 pending = 5200
    expect(sys.budget.remaining("oslo").amount).toBe(520_000);
  });

  it("confirming spend moves from pending to spent", () => {
    const sys = createTestSystem();

    const amount = fromMajor(500, "NOK");
    sys.budget.reserve("oslo", amount);
    sys.budget.recordPurchase("oslo", amount, amount);
    sys.budget.confirmSpend("oslo", amount);

    const totals = sys.budget.getMonthTotals("oslo");
    expect(totals.spent.amount).toBe(50_000);
    expect(totals.pending.amount).toBe(0);
    expect(totals.reserved.amount).toBe(0);
  });

  it("rejected spend releases pending back to available", () => {
    const sys = createTestSystem();

    const amount = fromMajor(500, "NOK");
    sys.budget.reserve("oslo", amount);
    sys.budget.recordPurchase("oslo", amount, amount);
    sys.budget.rejectSpend("oslo", amount);

    // Budget should be fully available again
    expect(sys.budget.remaining("oslo").amount).toBe(600_000);
  });

  it("canAffordRefill returns false when budget too low", () => {
    const sys = createTestSystem();

    // Use up almost all budget (5800 NOK spent, 200 remaining < 300 min)
    sys.budget.reserve("oslo", fromMajor(5800, "NOK"));
    sys.budget.recordPurchase("oslo", fromMajor(5800, "NOK"), fromMajor(5800, "NOK"));
    sys.budget.confirmSpend("oslo", fromMajor(5800, "NOK"));

    expect(sys.budget.canAffordRefill("oslo")).toBe(false);
  });

  it("spend cap is capped at maxPurchase", () => {
    const sys = createTestSystem();
    // Full budget: 6000 NOK, max purchase: 1200 NOK
    const cap = sys.budget.getSpendCap("oslo");
    expect(cap.amount).toBe(120_000); // 1200 NOK
  });

  it("spend cap shrinks when budget is partially used", () => {
    const sys = createTestSystem();

    // Spend 5500 NOK → remaining 500 NOK (< 1200 max)
    sys.budget.reserve("oslo", fromMajor(5500, "NOK"));
    sys.budget.recordPurchase("oslo", fromMajor(5500, "NOK"), fromMajor(5500, "NOK"));
    sys.budget.confirmSpend("oslo", fromMajor(5500, "NOK"));

    const cap = sys.budget.getSpendCap("oslo");
    expect(cap.amount).toBe(50_000); // 500 NOK
  });

  it("two purchases cannot overshoot budget due to reservations", () => {
    const sys = createTestSystem();

    // Remaining budget: 6000 NOK
    // Reserve for first purchase (max 1200 NOK)
    sys.budget.reserve("oslo", fromMajor(1200, "NOK"));
    // Remaining now: 4800

    // Reserve for second purchase
    sys.budget.reserve("oslo", fromMajor(1200, "NOK"));
    // Remaining now: 3600

    // Total reserved: 2400, which is within budget
    expect(sys.budget.remaining("oslo").amount).toBe(360_000);

    // After 4 purchases at max, budget is 1200. 5th reservation still fits
    sys.budget.reserve("oslo", fromMajor(1200, "NOK"));
    sys.budget.reserve("oslo", fromMajor(1200, "NOK"));
    // Now 4800 reserved out of 6000 = 1200 remaining
    expect(sys.budget.remaining("oslo").amount).toBe(120_000);

    // 5th reservation at max would leave 0
    sys.budget.reserve("oslo", fromMajor(1200, "NOK"));
    expect(sys.budget.remaining("oslo").amount).toBe(0);
    expect(sys.budget.canAffordRefill("oslo")).toBe(false);
  });

  it("offices have independent budgets", () => {
    const sys = createTestSystem();

    sys.budget.reserve("oslo", fromMajor(5000, "NOK"));
    // Oslo budget reduced, but Bengaluru is untouched
    expect(sys.budget.remaining("bengaluru").amount).toBe(1_500_000); // 15000 INR
  });
});
