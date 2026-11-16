import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ user: { id: "u1", role: "OWNER" } as { id: string; role: string } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/features", () => ({ cctvEnabled: () => true, requestHost: () => "mkr.lrmslm.com" }));
vi.mock("@/lib/cctv/client", () => ({
  CCTV_BASE_URL: "http://cctv.internal",
  CCTV_TOKEN: "rahasia",
  matchesToken: (value: string | null) => value === "rahasia",
}));

import { GET } from "@/app/api/cctv/stream/[cameraId]/hls/[file]/route";

const call = (cameraId: string, file: string) =>
  GET(new NextRequest(`https://mkr.lrmslm.com/api/cctv/stream/${cameraId}/hls/${file}`), {
    params: Promise.resolve({ cameraId, file }),
  });

describe("relay live HLS CCTV", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    mocks.user = { id: "u1", role: "OWNER" };
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("meneruskan playlist dari server CCTV dengan token, tanpa cache", async () => {
    fetchMock.mockResolvedValue(new Response("#EXTM3U\nsegment000001.ts\n", { status: 200 }));
    const response = await call("cam-1", "stream.m3u8");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toContain("segment000001.ts");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://cctv.internal/cameras/1/live/stream.m3u8");
    expect(init.headers.Authorization).toBe("Bearer rahasia");
  });

  it("encoder baru menyala: 503 diteruskan dengan Retry-After supaya pemutar mencoba lagi", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 503, headers: { "Retry-After": "2" } }));
    const response = await call("1", "stream.m3u8");
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
  });

  it("menolak nama file lain dan selain Super Admin", async () => {
    expect((await call("1", "../../.env")).status).toBe(404);
    expect((await call("1", "stream.mp4")).status).toBe(404);
    mocks.user = { id: "u2", role: "ADMIN" };
    expect((await call("1", "stream.m3u8")).status).toBe(403);
    mocks.user = { id: "unauthenticated", role: "VIEWER" };
    expect((await call("1", "segment000002.ts")).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
