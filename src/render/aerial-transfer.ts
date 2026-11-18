import {
  getIndirectLuminance,
  getIndirectLuminanceToPoint,
  getSolarLuminance,
  type AtmosphereContext,
} from "@takram/three-atmosphere/webgpu";
import { context as nodeContext, vec2, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
type RGBNode = Node<"vec3">;
type Transfer = { get(name: "transmittance" | "luminance"): RGBNode };
/** Atmospheric transport for pass-lit views. Both endpoints use the same
 * ellipsoid-to-atmosphere correction before conversion from meters to kilometers. */
export function createAerialTransfer(context: AtmosphereContext) {
  context.raymarchScattering = false;
  const correction = context.altitudeCorrectionECEF as unknown as RGBNode;
  const bind = (node: RGBNode) =>
    nodeContext(node, { getAtmosphere: () => context }) as unknown as RGBNode;
  return {
    initializeParameters() {
      // Material branches share Takram's parameter struct. Emit its complete
      // initializer in the parent shader scope so ground, sky and cloud rays
      // all see the same physical constants.
      (context.parametersNode as unknown as Node).toStack();
    },
    toPoint(color: RGBNode, originM: RGBNode, pointM: RGBNode, sun: RGBNode) {
      const transfer = getIndirectLuminanceToPoint(
        originM.add(correction).mul(0.001),
        pointM.add(correction).mul(0.001),
        vec2(0),
        sun,
      ) as unknown as Transfer;
      return bind(
        color.mul(transfer.get("transmittance")).add(transfer.get("luminance")),
      );
    },
    sky(originM: RGBNode, ray: RGBNode, sun: RGBNode) {
      const transfer = getIndirectLuminance(
        originM.add(correction).mul(0.001),
        ray,
        vec2(0),
        sun,
      ) as unknown as Transfer;
      const solar = vec3(getSolarLuminance() as unknown as RGBNode);
      const disk = ray
        .dot(sun)
        .greaterThan(Math.cos((0.2666 * Math.PI) / 180))
        .select(1, 0);
      return bind(
        transfer
          .get("luminance")
          .add(solar.mul(transfer.get("transmittance")).mul(disk)),
      );
    },
  };
}
export type AerialTransfer = ReturnType<typeof createAerialTransfer>;
