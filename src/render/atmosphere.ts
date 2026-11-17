import {
  AtmosphereContext,
  AtmosphereLUTNode,
  AtmosphereParameters,
  skyBackground,
} from "@takram/three-atmosphere/webgpu";
import { context as nodeContext } from "three/tsl";
import { Matrix4, Vector3 } from "three";
import type { Camera, WebGPURenderer, Node, Scene } from "three/webgpu";

/** One LUT allocation per device; contexts retain independent camera state.
 * Meter world coordinates are rebased at spacecraft ECEF, never scaled into kilometers. */
class ManagedLUT extends AtmosphereLUTNode {
  // The adapter serializes computation before rendering; avoid the library's
  // asynchronous automatic update racing a capture on this same renderer.
  override updateBefore(): void {}
}
export class AtmosphereAdapter {
  readonly parameters = new AtmosphereParameters();
  readonly lut = new ManagedLUT(this.parameters);
  private contexts = new Map<string, AtmosphereContext>();
  async initialize(renderer: WebGPURenderer, scene: Scene, camera: Camera) {
    // LUT storage is allocated lazily by node setup during compilation.
    await renderer.compileAsync(scene, camera);
    await this.lut.updateTextures(renderer);
  }
  context(id: string, camera: Camera, origin: Vector3, sun: Vector3) {
    let ctx = this.contexts.get(id);
    if (!ctx) {
      ctx = new AtmosphereContext(this.parameters, this.lut);
      // Takram 0.19.1 names this shared Struct VarNode with toConst(). Three
      // r184 emits that let declaration again for separate context branches,
      // causing WGSL redeclarations in a multi-surface sensor shader. Keep the
      // same immutable parameter values in a builder-owned mutable local: its
      // declaration is hoisted once and repeated evaluations are assignments.
      // This adapter change does not patch the package or alter the LUT model.
      const parameterVariable = ctx.parametersNode as unknown as {
        name: string | null;
        readOnly: boolean;
      };
      parameterVariable.name = null;
      parameterVariable.readOnly = false;
      this.contexts.set(id, ctx);
    }
    ctx.camera = camera;
    (ctx.matrixWorldToECEF.value as Matrix4).copy(
      new Matrix4().makeTranslation(origin.x, origin.y, origin.z),
    );
    (ctx.sunDirectionECEF.value as Vector3).copy(sun);
    return ctx;
  }
  sky(context: AtmosphereContext) {
    const node = skyBackground();
    node.showStars = false;
    node.showMoon = false;
    return nodeContext(node as unknown as Node, {
      getAtmosphere: () => context,
    });
  }
  dispose() {
    this.contexts.clear();
    this.lut.dispose();
  }
}
