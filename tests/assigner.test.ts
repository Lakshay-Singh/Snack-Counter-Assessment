/**
 * Tests for the Assigner — fair volunteer rotation.
 *
 * Covers:
 *   - Volunteers sorted by fewest recent refills
 *   - Volunteers with pending claims are deprioritized
 *   - Away volunteers are skipped
 *   - Visitors to another office are eligible there
 *   - Declined volunteers are excluded from re-offers
 */

import { Volunteer, OfficeId, Refill, RefillState } from "../src/domain";
import { Assigner } from "../src/services/assigner";
import { FakeClock } from "../src/adapters/fake-clock";

function makeVolunteer(id: string, office: OfficeId, overrides?: Partial<Volunteer>): Volunteer {
  return {
    id,
    name: id,
    homeOfficeId: office,
    payrollCurrency: office === "oslo" ? "NOK" : "INR",
    ...overrides,
  };
}

function makeRefill(officeId: OfficeId, declined: string[] = []): Refill {
  return {
    id: "test-refill",
    officeId,
    state: RefillState.REPORTED,
    version: 0,
    reportedBy: "someone",
    reportedAt: new Date(),
    reportedItems: [],
    assigneeId: null,
    offeredAt: null,
    committedAt: null,
    declinedVolunteerIds: [...declined],
    reservedAmount: null,
    purchaseAmount: null,
    purchasedAt: null,
    purchasedItems: [],
    receiptImage: null,
    claimId: null,
    claimSubmittedAt: null,
    resolvedAt: null,
  };
}

describe("Assigner", () => {
  let clock: FakeClock;
  let assigner: Assigner;

  beforeEach(() => {
    clock = new FakeClock(new Date("2026-11-15T10:00:00Z"));
    assigner = new Assigner(clock);
  });

  it("picks the volunteer with fewest recent refills", () => {
    const vols = [
      makeVolunteer("alice", "oslo"),
      makeVolunteer("bob", "oslo"),
      makeVolunteer("carol", "oslo"),
    ];

    // Alice did 2 refills, Bob did 1, Carol did 0
    assigner.recordCompletion("alice", "oslo", new Date("2026-10-20T10:00:00Z"));
    assigner.recordCompletion("alice", "oslo", new Date("2026-11-01T10:00:00Z"));
    assigner.recordCompletion("bob", "oslo", new Date("2026-11-05T10:00:00Z"));

    const picked = assigner.pickNext("oslo", vols, makeRefill("oslo"));
    expect(picked?.id).toBe("carol"); // 0 refills
  });

  it("deprioritizes volunteers with pending claims", () => {
    const vols = [
      makeVolunteer("alice", "oslo"),
      makeVolunteer("bob", "oslo"),
    ];

    // Both have 0 refills, but Alice has a pending claim
    assigner.markPendingClaim("alice");

    const picked = assigner.pickNext("oslo", vols, makeRefill("oslo"));
    expect(picked?.id).toBe("bob");
  });

  it("skips away volunteers", () => {
    const vols = [
      makeVolunteer("alice", "oslo", { awayUntil: new Date("2026-12-01T00:00:00Z") }),
      makeVolunteer("bob", "oslo"),
    ];

    const picked = assigner.pickNext("oslo", vols, makeRefill("oslo"));
    expect(picked?.id).toBe("bob");
  });

  it("includes visitors at the office", () => {
    const visitor = makeVolunteer("ravi", "bengaluru", {
      visitingOfficeId: "oslo",
      visitingUntil: new Date("2026-11-20T00:00:00Z"),
    });
    const vols = [visitor];

    const picked = assigner.pickNext("oslo", vols, makeRefill("oslo"));
    expect(picked?.id).toBe("ravi");
  });

  it("excludes volunteers who already declined this refill", () => {
    const vols = [
      makeVolunteer("alice", "oslo"),
      makeVolunteer("bob", "oslo"),
    ];

    const refill = makeRefill("oslo", ["alice"]); // Alice already declined
    const picked = assigner.pickNext("oslo", vols, refill);
    expect(picked?.id).toBe("bob");
  });

  it("returns null when nobody is eligible", () => {
    const vols = [
      makeVolunteer("alice", "oslo", { awayUntil: new Date("2026-12-01T00:00:00Z") }),
    ];

    const refill = makeRefill("oslo");
    const picked = assigner.pickNext("oslo", vols, refill);
    expect(picked).toBeNull();
  });

  it("breaks ties by longest since last refill", () => {
    const vols = [
      makeVolunteer("alice", "oslo"),
      makeVolunteer("bob", "oslo"),
    ];

    // Both did 1 refill, but Alice's was more recent
    assigner.recordCompletion("alice", "oslo", new Date("2026-11-10T10:00:00Z"));
    assigner.recordCompletion("bob", "oslo", new Date("2026-10-01T10:00:00Z"));

    const picked = assigner.pickNext("oslo", vols, makeRefill("oslo"));
    expect(picked?.id).toBe("bob"); // Longer since last refill
  });

  it("ignores refills older than 90 days for fairness count", () => {
    const vols = [
      makeVolunteer("alice", "oslo"),
      makeVolunteer("bob", "oslo"),
    ];

    // Alice did 5 refills, but all more than 90 days ago
    for (let i = 0; i < 5; i++) {
      assigner.recordCompletion("alice", "oslo", new Date("2026-07-01T10:00:00Z"));
    }
    // Bob did 1 refill recently
    assigner.recordCompletion("bob", "oslo", new Date("2026-11-10T10:00:00Z"));

    const picked = assigner.pickNext("oslo", vols, makeRefill("oslo"));
    expect(picked?.id).toBe("alice"); // 0 recent refills vs Bob's 1
  });
});
