/**
 * Port for time — allows tests to control the clock.
 */
export interface ClockPort {
  /** Current time */
  now(): Date;
}
