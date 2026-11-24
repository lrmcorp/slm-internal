import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const created = vi.hoisted(() => ({ audit: [] as any[], detections: [] as any[] }));
const notify = vi.hoisted(() => ({ calls: [] as any[] }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    auditLog: { create: vi.fn(async (args: any) => { created.audit.push(args.data); return args.data; }) },
    cctvDetectionLog: { create: vi.fn(async (args: any) => { created.detections.push(args.data); return args.data; }) },
  },
}));
vi.mock("@/lib/push/notify", () => ({ notifyCctvAlert: vi.fn(async (alert: any) => { notify.calls.push(alert); }) }));

const TOKEN = "test-restricted-token";

async function post(body: unknown) {
  process.env.SLM_API_TOKEN = TOKEN;
  vi.resetModules();
  const { POST } = await import("@/app/api/cctv/events/route");
  return POST(new Request("http://localhost/api/cctv/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CCTV-Token": TOKEN },
    body: JSON.stringify(body),
  }));
}

describe("Kejadian CCTV area terlarang", () => {
  beforeEach(() => {
    created.audit = [];
    created.detections = [];
    notify.calls = [];
  });

  it("records the event as an alert and notifies the owner once", async () => {
    const res = await post({
      event_id: "cctv_inc_42_1795000000", event_type: "restricted_entry", severity: "critical",
      title: "Ada Orang di Area Terlarang (Camera 14)", message: "Orang terlihat di area terlarang saat jam jaga. Kamera Camera 14, 13:05 WIB.",
      occurred_at: "2026-11-24T06:05:00Z", camera: { id: 1, name: "Camera 14", location: "Meja Packing 1" },
      data: { incident_id: 42, evidence_url: "https://cctv.lrmslm.com/api/v1/slm/evidence/incident-snapshot/42" },
    });
    expect(res.status).toBe(200);
    expect(created.audit[0].action).toBe("cctv_restricted_entry");
    expect(created.detections[0]).toMatchObject({ eventType: "restricted_entry", packingStatus: "restricted_entry", matchStatus: "review", cameraName: "Camera 14" });
    expect(notify.calls).toEqual([{ eventId: "cctv_inc_42_1795000000", title: "Ada Orang di Area Terlarang (Camera 14)", message: "Orang terlihat di area terlarang saat jam jaga. Kamera Camera 14, 13:05 WIB.", cameraName: "Camera 14" }]);
  });

  it("also notifies for packing-desk anomalies, but not for routine events", async () => {
    await post({ event_id: "a1", event_type: "anomaly", title: "Dugaan Anomali", camera: { id: 2, name: "Camera 13" } });
    expect(notify.calls).toHaveLength(1);
    expect(created.detections[0].eventType).toBe("anomaly");
    await post({ event_id: "x1", event_type: "custom_heartbeat", title: "Info" });
    expect(notify.calls).toHaveLength(1);
  });

  it("rejects events without the CCTV token", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/cctv/events/route");
    const res = await POST(new Request("http://localhost/api/cctv/events", { method: "POST", body: JSON.stringify({ event_type: "restricted_entry" }) }));
    expect(res.status).toBe(401);
    expect(notify.calls).toHaveLength(0);
  });
});
