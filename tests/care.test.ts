import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { directionsUrl, distanceKm, overpassQuery, parseCoords, placesText, toPlaces } from "../convex/lib/places";
import { markdownToTelegramHtml } from "../convex/lib/telegram";
import { cortexCalls, createAppUser, drain, geocodeCalls, mockApis, overpassCalls, setEnv, setup } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
  setEnv();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const BERKELEY = { lat: 37.8716, lon: -122.2727 };
const ELEMENTS: any[] = [
  { type: "way", id: 1, center: { lat: 37.8636, lon: -122.2567 }, tags: { name: "Alta Bates Medical Center", amenity: "hospital", emergency: "yes", phone: "+1 510-204-4444", "addr:housenumber": "2450", "addr:street": "Ashby Avenue", "addr:city": "Berkeley", opening_hours: "24/7" } },
  { type: "node", id: 2, lat: 37.8637, lon: -122.2568, tags: { name: "Alta Bates Medical Center", amenity: "hospital" } }, // same place again
  { type: "node", id: 3, lat: 37.9, lon: -122.3, tags: { name: "Far Hospital", amenity: "hospital" } },
  { type: "node", id: 4, lat: 37.88, lon: -122.27, tags: { amenity: "hospital" } }, // no name
];

describe("places helpers", () => {
  test("coordinates from a shared location skip geocoding", () => {
    expect(parseCoords("37.8716, -122.2727")).toEqual(BERKELEY);
    expect(parseCoords("Berkeley, CA")).toBeNull();
    expect(parseCoords("91,0")).toBeNull();
  });

  test("named places only, nearest first, duplicates merged, with hours and phone", () => {
    const places = toPlaces(ELEMENTS, BERKELEY);
    expect(places.map((p) => p.name)).toEqual(["Alta Bates Medical Center", "Far Hospital"]);
    expect(places[0]).toMatchObject({ km: 1.7, phone: "+1 510-204-4444", address: "2450 Ashby Avenue, Berkeley", open24: true });
    expect(Math.round(distanceKm(BERKELEY, { lat: 37.9, lon: -122.3 }))).toBe(4);
  });

  test("the Overpass query asks for the right tags and radius", () => {
    expect(overpassQuery("er", 1, 2)).toBe(
      '[out:json][timeout:20];(nwr["amenity"="hospital"]["emergency"!="no"](around:30000,1,2);nwr["healthcare"="hospital"]["emergency"!="no"](around:30000,1,2););out center tags 60;',
    );
    expect(overpassQuery("pharmacy", 1, 2)).toContain('nwr["amenity"="pharmacy"](around:8000,1,2)');
  });

  test("text for the model has call and directions links; Telegram keeps the number as text", () => {
    const text = placesText("er", toPlaces(ELEMENTS, BERKELEY), "Berkeley, CA");
    expect(text).toContain("- **Alta Bates Medical Center**, 1.7 km, 2450 Ashby Avenue, Berkeley · open 24/7 · [Call +1 510-204-4444](tel:+15102044444) · [Directions](https://www.google.com/maps/dir/?api=1&destination=37.8636,-122.2567)");
    expect(placesText("pharmacy", [], "Nowhere")).toMatch(/^No pharmacies found/);
    expect(directionsUrl(BERKELEY)).toBe("https://www.google.com/maps/dir/?api=1&destination=37.8716,-122.2727");
    expect(markdownToTelegramHtml("[Call +1 510](tel:+1510)")).toBe("Call +1 510");
  });
});

describe("care search", () => {
  test("needs sign-in; without a saved location it says so", async () => {
    const t = setup();
    mockApis();
    await expect(t.action(api.care.search, { kind: "er" })).rejects.toThrow(/Not signed in/);
    const { as } = await createAppUser(t);
    expect(await as.action(api.care.search, { kind: "er" })).toEqual({ error: expect.stringMatching(/No location yet/) });
  });

  test("geocodes the saved location once, then reuses the point until the location changes", async () => {
    const t = setup();
    const { calls } = mockApis({ overpass: ELEMENTS });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.setLocation, { location: "Berkeley, CA 94704" });
    const res = await as.action(api.care.search, { kind: "er" });
    expect(res).toMatchObject({ near: "Berkeley, CA 94704", places: [{ name: "Alta Bates Medical Center" }, { name: "Far Hospital" }] });
    await as.action(api.care.search, { kind: "pharmacy" });
    expect(geocodeCalls(calls)).toHaveLength(1);
    expect(decodeURIComponent(overpassCalls(calls)[1].body)).toContain('"amenity"="pharmacy"');
    await as.mutation(api.chat.setLocation, { location: "Oakland, CA" });
    await as.action(api.care.search, { kind: "er" });
    expect(geocodeCalls(calls)).toHaveLength(2);
  });

  test("the phone's location is used as is; map errors are friendly", async () => {
    const t = setup();
    const { calls } = mockApis({ overpass: new Error("timeout") });
    const { as } = await createAppUser(t);
    expect(await as.action(api.care.search, { kind: "urgent_care", lat: 37.87, lon: -122.27 })).toEqual({
      error: "The map service didn't answer. Please try again in a moment.",
    });
    expect(geocodeCalls(calls)).toHaveLength(0);
    expect(decodeURIComponent(overpassCalls(calls)[0].body)).toContain("around:15000,37.87,-122.27");
  });
});

describe("find_care in chat", () => {
  test("urgent messages are told to use find_care, and its result has the links", async () => {
    const t = setup();
    const { calls } = mockApis({
      jev: { urgent: 0.95 },
      overpass: ELEMENTS,
      core: [
        { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "find_care", arguments: '{"kind":"er"}' } }] },
        { content: "Call 911. The nearest ER is Alta Bates." },
      ],
    });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.setLocation, { location: "Berkeley, CA 94704" });
    await as.mutation(api.chat.send, { text: "crushing chest pain" });
    await drain(t);
    const first = cortexCalls(calls)[0].body;
    expect(first.messages[0].content).toContain('call find_care (kind "er"');
    expect(first.tools.map((x: any) => x.function.name)).toContain("find_care");
    const result = cortexCalls(calls)[1].body.messages.find((m: any) => m.tool_call_id === "c1").content;
    expect(result).toContain("[Call +1 510-204-4444](tel:+15102044444)");
  });
});
