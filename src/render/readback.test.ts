import { describe, it, expect } from "vitest";
import { unpackRgba8 } from "./readback";
describe("WebGPU RGBA8 readback row alignment", () => {
  for (const width of [720, 1080, 3840])
    it(`preserves pixels at width ${width}, including a short final row`, () => {
      const height = 3,
        rowBytes = width * 4,
        stride = Math.ceil(rowBytes / 256) * 256;
      const backing = new Uint8Array(
        19 + (height - 1) * stride + rowBytes + 7,
      ).fill(251);
      const view = new Uint8Array(
        backing.buffer,
        19,
        (height - 1) * stride + rowBytes,
      );
      for (let y = 0; y < height; y++)
        view.fill(y + 10, y * stride, y * stride + rowBytes);
      const result = unpackRgba8(view, width, height);
      expect(result.length).toBe(width * height * 4);
      for (let y = 0; y < height; y++) {
        expect(result[y * rowBytes]).toBe(y + 10);
        expect(result[(y + 1) * rowBytes - 1]).toBe(y + 10);
      }
      expect(result.includes(251)).toBe(false);
    });
  it("rejects incomplete rows", () =>
    expect(() => unpackRgba8(new Uint8Array(20), 720, 2)).toThrow(RangeError));
});
