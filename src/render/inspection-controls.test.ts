import { expect, it } from "vitest";
import {
  InspectionTransform,
  type InspectionFrame,
} from "./inspection-controls";
const frame: InspectionFrame = {
  width: 800,
  height: 600,
  pixelRatio: 2,
  sensorWidth: 4000,
  sensorHeight: 3000,
};

it("keeps the cursor's native pixel fixed during unconstrained zoom", () => {
  const view = new InspectionTransform();
  view.reset("native");
  const before = view.crop(frame),
    x = 500,
    y = 350;
  const nativeBefore = [
    before[0] + (x * before[2]) / frame.width,
    before[1] + (y * before[3]) / frame.height,
  ];
  view.zoomAt(frame, 2, x, y);
  const after = view.crop(frame);
  expect(after[0] + (x * after[2]) / frame.width).toBeCloseTo(
    nativeBefore[0],
    9,
  );
  expect(after[1] + (y * after[3]) / frame.height).toBeCloseTo(
    nativeBefore[1],
    9,
  );
  expect(view.state(frame).scale).toBe(2);
});

it("fits with letterboxing, resets native scale, and bounds extreme pan and zoom", () => {
  const view = new InspectionTransform();
  expect(view.state(frame).scale).toBe(0.4);
  expect(view.crop(frame)).toEqual([0, 0, 4000, 3000]);
  view.reset("native");
  expect(view.crop(frame)).toEqual([1200, 900, 1600, 1200]);
  view.pan(frame, 1e6, -1e6);
  expect(view.crop(frame)).toEqual([0, 1800, 1600, 1200]);
  view.zoomAt(frame, 1e6, 400, 300);
  expect(view.state(frame).scale).toBe(16);
  view.zoomAt(frame, 1e-9, 400, 300);
  expect(view.state(frame).scale).toBe(0.05);
  view.reset("fit");
  expect(view.crop({ ...frame, height: 800 })).toEqual([0, -500, 4000, 4000]);
});

it("uses actual framebuffer DPR without changing sensor dimensions", () => {
  const view = new InspectionTransform();
  view.reset("native");
  expect(view.crop({ ...frame, pixelRatio: 1 })).toEqual([
    1600, 1200, 800, 600,
  ]);
  expect(view.crop(frame)).toEqual([1200, 900, 1600, 1200]);
});
