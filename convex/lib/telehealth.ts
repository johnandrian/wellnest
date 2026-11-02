// Telehealth providers behind one small interface, so a real one plugs in without touching the booking flow
// (convex/telehealth.ts). TELEHEALTH_PROVIDER picks it:
// - "test" (default): made-up slots and bookings, for development. Nothing real is booked.
// - "http": any service that speaks the small REST contract below (a provider's partner API, or a thin proxy in
//   front of one). Needs TELEHEALTH_API_URL and TELEHEALTH_API_KEY; TELEHEALTH_PROVIDER_NAME names it in the app.
//     GET    {url}/slots?reason=&urgency=&language=   -> { slots: Slot[] }
//     POST   {url}/bookings  { slotId, reason, summary, language, patient: { email?, name? } }
//                                                      -> { bookingId, joinUrl, startsAt }
//     DELETE {url}/bookings/{bookingId}               -> 2xx
import { v } from "convex/values";
import { env } from "./env";

export const slot = v.object({
  id: v.string(),
  startsAt: v.number(), // ms since epoch
  clinician: v.string(),
  specialty: v.optional(v.string()),
  priceCents: v.optional(v.number()),
});
export type Slot = { id: string; startsAt: number; clinician: string; specialty?: string; priceCents?: number };
export const urgency = v.union(v.literal("today"), v.literal("soon"));
export type Urgency = "today" | "soon";

export type Booking = { bookingId: string; joinUrl: string; startsAt: number };
export type BookingRequest = {
  slotId: string;
  reason: string;
  summary: string;
  language: string;
  patient: { email?: string; name?: string };
};

export interface Provider {
  id: string;
  name: string;
  findSlots(q: { reason: string; urgency: Urgency; language: string; now: number }): Promise<Slot[]>;
  book(req: BookingRequest): Promise<Booking>;
  cancel(bookingId: string): Promise<void>;
}

const MAX_SLOTS = 3;

// Deterministic fake availability: the next three half-hour slots at least 20 minutes out ("today"), or tomorrow
// morning ("soon").
export const testProvider: Provider = {
  id: "test",
  name: "Test clinic (not real)",
  async findSlots({ urgency, now }) {
    const half = 30 * 60_000;
    const first = urgency === "today" ? Math.ceil((now + 20 * 60_000) / half) * half : Math.ceil((now + 16 * 3_600_000) / half) * half;
    const clinicians = ["Dr. Rivera (test)", "Dr. Chen (test)", "Dr. Okafor (test)"];
    return clinicians.map((clinician, i) => ({
      id: `test-${first + i * half}`,
      startsAt: first + i * half,
      clinician,
      specialty: "Family medicine",
      priceCents: 0,
    }));
  },
  async book({ slotId }) {
    const startsAt = Number(slotId.replace(/^test-/, ""));
    if (!Number.isFinite(startsAt)) throw new Error("That time isn't available any more.");
    return { bookingId: `bk-${slotId}`, joinUrl: `https://example.com/wellnest-test-visit/${slotId}`, startsAt };
  },
  async cancel() {},
};

function httpProvider(): Provider {
  const base = env("TELEHEALTH_API_URL").replace(/\/$/, "");
  const headers = () => ({ Authorization: `Bearer ${env("TELEHEALTH_API_KEY")}`, "Content-Type": "application/json" });
  const check = async (res: Response, what: string) => {
    if (!res.ok) throw new Error(`${what} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return res;
  };
  return {
    id: "http",
    name: process.env.TELEHEALTH_PROVIDER_NAME || "Telehealth partner",
    async findSlots({ reason, urgency, language }) {
      const q = new URLSearchParams({ reason: reason.slice(0, 300), urgency, language });
      const res = await check(await fetch(`${base}/slots?${q}`, { headers: headers() }), "Finding times");
      const slots = ((await res.json()).slots ?? []) as Slot[];
      return slots
        .filter((s) => typeof s.id === "string" && Number.isFinite(s.startsAt) && typeof s.clinician === "string")
        .slice(0, MAX_SLOTS);
    },
    async book(req) {
      const res = await check(await fetch(`${base}/bookings`, { method: "POST", headers: headers(), body: JSON.stringify(req) }), "Booking");
      const b = (await res.json()) as Booking;
      if (!b.bookingId || !b.joinUrl || !Number.isFinite(b.startsAt)) throw new Error("The provider's booking reply was incomplete.");
      return b;
    },
    async cancel(bookingId) {
      await check(await fetch(`${base}/bookings/${encodeURIComponent(bookingId)}`, { method: "DELETE", headers: headers() }), "Cancelling");
    },
  };
}

export function provider(): Provider {
  return process.env.TELEHEALTH_PROVIDER === "http" ? httpProvider() : testProvider;
}
