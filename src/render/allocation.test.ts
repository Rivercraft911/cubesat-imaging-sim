import { describe, it, expect } from "vitest";
import {
  validateNativeAllocation,
  MAX_OPTICS_WORKING_BYTES,
} from "./allocation";
describe("native optics allocation limits", () => {
  it("accepts full 12.3MP IMX477 without scaling", () =>
    expect(validateNativeAllocation(4056, 3040, 8192)).toBe(4056 * 3040 * 16));
  it("rejects a 16k square before buffer allocation even on a large GPU", () =>
    expect(() => validateNativeAllocation(16384, 16384, 16384)).toThrow(
      "512 MiB",
    ));
  it("independently enforces the GPU dimension limit", () =>
    expect(() => validateNativeAllocation(10000, 1000, 8192)).toThrow(
      "8192-pixel",
    ));
  it("accepts the last whole row inside the exact working-set budget", () => {
    const height = Math.floor(MAX_OPTICS_WORKING_BYTES / (4096 * 16));
    expect(validateNativeAllocation(4096, height, 16384)).toBeLessThanOrEqual(
      MAX_OPTICS_WORKING_BYTES,
    );
    expect(() => validateNativeAllocation(4096, height + 1, 16384)).toThrow(
      "512 MiB",
    );
  });
});
