import os from "node:os";
import { describe, expect, it } from "vitest";
import type { CaptureAdapter, CapturedImage, Session, SessionInfo } from "../adapters/types";
import { imageToJson, sessionImages, tailnetIp } from "./server";

type Ifaces = NodeJS.Dict<os.NetworkInterfaceInfo[]>;

function v4(address: string, internal = false): os.NetworkInterfaceInfo {
  return { address, netmask: "255.255.255.255", family: "IPv4", mac: "", internal } as os.NetworkInterfaceInfo;
}

describe("tailnetIp", () => {
  it("finds an IP in the 100.64.0.0/10 tailnet range", () => {
    const ifaces: Ifaces = { tailscale0: [v4("100.101.102.103")], eth0: [v4("10.0.0.5")] };
    expect(tailnetIp(ifaces)).toBe("100.101.102.103");
  });

  it("ignores public/private IPs outside the range (incl. 100.0-63 / 100.128+)", () => {
    const ifaces: Ifaces = {
      eth0: [v4("100.63.0.1")], // just below the range
      eth1: [v4("100.128.0.1")], // just above
      eth2: [v4("192.168.1.4")],
    };
    expect(tailnetIp(ifaces)).toBeNull();
  });

  it("skips internal/loopback interfaces", () => {
    const ifaces: Ifaces = { lo: [v4("127.0.0.1", true)] };
    expect(tailnetIp(ifaces)).toBeNull();
  });
});

describe("imageToJson", () => {
  it("exposes metadata + a content-addressed url, and never base64", () => {
    const json = imageToJson({
      label: 3,
      appearance: 2,
      uncertain: false,
      hash: "abc123",
      file: "/home/me/.pastels/images/abc123.png",
      width: 800,
      height: 600,
      bytes: 1234,
      mediaType: "image/png",
      ts: "2026-06-11T00:00:00.000Z",
      source: "claude-code:s",
    });
    expect(json.url).toBe("/img/abc123");
    expect(json.path).toBe("/home/me/.pastels/images/abc123.png");
    expect(json).not.toHaveProperty("data");
    expect(json.label).toBe(3);
  });
});

// Fake adapter returning canned captured images, to test the merge/dedupe.
function fakeAdapter(transcript: CapturedImage[], live: CapturedImage[]): CaptureAdapter {
  return {
    name: "fake",
    detect: () => true,
    listSessions: () => [],
    extractImages: () => transcript,
    summarize: (): SessionInfo => ({ title: "", imageCount: 0 }),
    liveImages: () => live,
  };
}

function cap(label: number, appearance: number, data: string): CapturedImage {
  return { label, appearance, uncertain: false, bytes: Buffer.from(data), mediaType: "image/png" };
}

const SESSION: Session = { id: "s", path: "/x", project: "p", mtime: 0 };

describe("sessionImages", () => {
  it("merges transcript + live images, sorted by label", () => {
    const a = fakeAdapter([cap(1, 1, "one")], [cap(2, 2, "two")]);
    expect(sessionImages(a, SESSION).map((i) => i.label)).toEqual([1, 2]);
  });

  it("dedupes the same paste appearing in both sources (same bytes + label)", () => {
    // identical bytes + label in transcript and live → one entry, not two
    const a = fakeAdapter([cap(1, 1, "same")], [cap(1, 1, "same")]);
    expect(sessionImages(a, SESSION)).toHaveLength(1);
  });

  it("keeps a live-only paste the transcript has not captured yet", () => {
    const a = fakeAdapter([], [cap(5, 1, "fresh")]);
    const imgs = sessionImages(a, SESSION);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.label).toBe(5);
  });
});
