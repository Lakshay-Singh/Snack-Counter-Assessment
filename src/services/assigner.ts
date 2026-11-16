/**
 * Assigner — picks the next volunteer to refill the snack counter.
 *
 * Eligibility:
 *   - Belongs to the office OR is currently visiting it
 *   - Not marked as away
 *   - Has not already declined or timed out for this refill
 *
 * Sort order (deterministic, so tests can predict):
 *   1. No pending HR claim first (don't burden people waiting for money)
 *   2. Fewest refills completed in the last 90 days
 *   3. Longest time since their last refill (tie-breaker)
 */

import { OfficeId, Volunteer, Refill } from "../domain";
import { ClockPort } from "../ports";

/** Completed refill record used for fairness scoring. */
export interface RefillRecord {
  volunteerId: string;
  officeId: OfficeId;
  completedAt: Date;
}

export class Assigner {
  /** History of completed refills — append-only log. */
  private history: RefillRecord[] = [];
  /** Set of volunteer IDs with a pending (unresolved) HR claim. */
  private pendingClaimVolunteers = new Set<string>();

  constructor(private clock: ClockPort) {}

  /** Record that a volunteer completed a refill. */
  recordCompletion(volunteerId: string, officeId: OfficeId, completedAt: Date): void {
    this.history.push({ volunteerId, officeId, completedAt });
  }

  /** Mark a volunteer as having a pending claim. */
  markPendingClaim(volunteerId: string): void {
    this.pendingClaimVolunteers.add(volunteerId);
  }

  /** Clear the pending claim flag. */
  clearPendingClaim(volunteerId: string): void {
    this.pendingClaimVolunteers.delete(volunteerId);
  }

  /**
   * Pick the next volunteer to offer the refill to.
   * Returns null if nobody is eligible.
   */
  pickNext(
    officeId: OfficeId,
    volunteers: Volunteer[],
    refill: Refill
  ): Volunteer | null {
    const ranked = this.getRankedList(officeId, volunteers, refill);
    return ranked.length > 0 ? ranked[0] : null;
  }

  /** Get the ranked list of eligible volunteers (for testing / debugging / rotation). */
  getRankedList(
    officeId: OfficeId,
    volunteers: Volunteer[],
    refill: Refill
  ): Volunteer[] {
    const now = this.clock.now();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const eligible = volunteers.filter((v) => {
      const atOffice = v.homeOfficeId === officeId ||
        (v.visitingOfficeId === officeId && (!v.visitingUntil || v.visitingUntil > now));
      if (!atOffice) return false;
      if (v.awayUntil && v.awayUntil > now) return false;
      if (refill.declinedVolunteerIds.includes(v.id)) return false;
      return true;
    });

    const scored = eligible.map((v) => {
      const hasPending = this.pendingClaimVolunteers.has(v.id);
      const recentRefills = this.history.filter(
        (r) => r.volunteerId === v.id && r.completedAt >= ninetyDaysAgo
      ).length;
      const lastRefill = this.history
        .filter((r) => r.volunteerId === v.id)
        .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())[0];
      const msSinceLastRefill = lastRefill
        ? now.getTime() - lastRefill.completedAt.getTime()
        : Infinity;

      return { volunteer: v, hasPending, recentRefills, msSinceLastRefill };
    });

    scored.sort((a, b) => {
      if (a.hasPending !== b.hasPending) return a.hasPending ? 1 : -1;
      if (a.recentRefills !== b.recentRefills) return a.recentRefills - b.recentRefills;
      if (a.msSinceLastRefill !== b.msSinceLastRefill) return b.msSinceLastRefill - a.msSinceLastRefill;
      return a.volunteer.id.localeCompare(b.volunteer.id);
    });

    return scored.map((s) => s.volunteer);
  }
}
