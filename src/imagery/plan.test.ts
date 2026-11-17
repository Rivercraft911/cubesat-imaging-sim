import { expect, it } from "vitest";
import { contains } from "./bounds";
import { planShot } from "./plan";

it("reuses exact tile keys and bounds across overlapping footprint changes", () => {
  const first = planShot([-13607000, 4494000, -13597000, 4502000], 2, 37.4);
  const second = planShot([-13606000, 4494500, -13596000, 4502500], 2, 37.4);
  const shared = second.tiles.filter((tile) =>
    first.tiles.some((old) => old.key === tile.key),
  );
  expect(shared.length).toBeGreaterThan(0);
  for (const tile of shared)
    expect(tile.bounds).toEqual(
      first.tiles.find((old) => old.key === tile.key)!.bounds,
    );
});
it("covers the entire requested footprint with a bounded source mosaic", () => {
  const bounds: [number, number, number, number] = [
    -13650000, 4470000, -13540000, 4550000,
  ];
  const plan = planShot(bounds, 0.6, 37.4);
  expect(contains(plan.bounds, bounds)).toBe(true);
  expect(plan.width).toBeLessThanOrEqual(6144);
  expect(plan.height).toBeLessThanOrEqual(6144);
  expect(plan.tiles.length).toBeLessThanOrEqual(16);
  expect(plan.sourceResolutionM).toBeGreaterThan(0.6);
  expect(() => planShot([0, 0, Infinity, 1], 1, 37)).toThrow();
});
