/**
 * Controllable fake clock for tests.
 * Allows advancing time without real delays.
 */

import { ClockPort } from "../ports/clock-port";

export class FakeClock implements ClockPort {
  private current: Date;

  constructor(initial: Date = new Date("2026-11-01T09:00:00Z")) {
    this.current = new Date(initial.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  /** Advance by the given number of milliseconds */
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  /** Advance by hours */
  advanceHours(hours: number): void {
    this.advance(hours * 60 * 60 * 1000);
  }

  /** Advance by days */
  advanceDays(days: number): void {
    this.advance(days * 24 * 60 * 60 * 1000);
  }

  /** Set to a specific time */
  set(date: Date): void {
    this.current = new Date(date.getTime());
  }
}
