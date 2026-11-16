/**
 * Tests for Money Value Object:
 *   - Ensures integer minor units (no float precision issues)
 *   - Forbids cross-currency arithmetic without explicit conversion
 *   - Major unit conversion and formatting
 */

import { money, fromMajor, toMajor, addMoney, subtractMoney, convertMoney } from "../src/domain";

describe("Money Value Object", () => {
  it("rejects non-integer minor unit amounts", () => {
    expect(() => money(12.34, "NOK")).toThrow("Money amount must be an integer");
    expect(() => money(NaN, "INR")).toThrow("Money amount must be an integer");
  });

  it("converts from and to major units accurately", () => {
    const nok = fromMajor(350.5, "NOK");
    expect(nok.amount).toBe(35050); // 35,050 øre
    expect(toMajor(nok)).toBe(350.5);

    const inr = fromMajor(1299.99, "INR");
    expect(inr.amount).toBe(129999); // 129,999 paise
    expect(toMajor(inr)).toBe(1299.99);
  });

  it("adds and subtracts money in the same currency", () => {
    const m1 = money(50000, "NOK");
    const m2 = money(25000, "NOK");

    const sum = addMoney(m1, m2);
    expect(sum.amount).toBe(75000);
    expect(sum.currency).toBe("NOK");

    const diff = subtractMoney(m1, m2);
    expect(diff.amount).toBe(25000);
    expect(diff.currency).toBe("NOK");
  });

  it("throws when adding or subtracting across different currencies", () => {
    const nok = money(50000, "NOK");
    const inr = money(50000, "INR");

    expect(() => addMoney(nok, inr)).toThrow("Cannot add NOK and INR");
    expect(() => subtractMoney(nok, inr)).toThrow("Cannot subtract NOK and INR");
  });

  it("converts currency with exchange rate rounding to nearest integer minor unit", () => {
    const inr = money(240000, "INR"); // 2400 INR
    // Rate 0.0833333333 -> 20,000 øre = 200 NOK
    const nok = convertMoney(inr, "NOK", 0.0833333333);
    expect(nok.amount).toBe(20000);
    expect(nok.currency).toBe("NOK");
  });
});
