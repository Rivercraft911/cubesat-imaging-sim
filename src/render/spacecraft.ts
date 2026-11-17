import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { cameraBodyRotation } from '../sim/camera';
import type { CameraId, Scenario, Vec3 } from '../sim/types';

const EDITOR_LAYER = 1;
const CAMERA_OUTLINE = 'Camera selection outline';

function standard(color: THREE.ColorRepresentation, metalness: number, roughness: number) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

function spacecraftMaterials() {
  // Linear RGB appearance from the Yapling v03 exterior (spacecraft-v03-v45.glb).
  return {
    aluminium: standard(new THREE.Color(0.57, 0.60, 0.63), 0.83, 0.31),
    chassis: standard(0xbebcb1, 0.32, 0.51),
    pcb: standard(new THREE.Color(0.72, 0.75, 0.76), 0, 0.42),
    black: standard(new THREE.Color(0.012, 0.015, 0.018), 0.08, 0.38),
    patch: standard(new THREE.Color(0.61, 0.42, 0.115), 0.78, 0.26),
    grid: standard(new THREE.Color(0.045, 0.050, 0.060), 0.50, 0.40),
    cell: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0.0035, 0.004, 0.008), metalness: 0.03, roughness: 0.27,
      specularIntensity: 0.32, clearcoat: 0.20, clearcoatRoughness: 0.17,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0.003, 0.007, 0.014), metalness: 0.35, roughness: 0.055,
      clearcoat: 0.90, clearcoatRoughness: 0.08,
    }),
    fisheyeGlass: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0.006, 0.014, 0.020), metalness: 0.18, roughness: 0.08,
      ior: 1.54, clearcoat: 1, clearcoatRoughness: 0.055,
    }),
    selection: new THREE.MeshBasicMaterial({
      color: 0x7bff3d, side: THREE.BackSide, depthWrite: false, toneMapped: false,
    }),
  };
}

type Materials = ReturnType<typeof spacecraftMaterials>;

function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, center: Vec3) {
  const part = new THREE.Mesh(geometry, material);
  part.position.fromArray(center);
  parent.add(part);
  return part;
}

function box(parent: THREE.Object3D, material: THREE.Material, center: Vec3, size: Vec3, bevel = 0) {
  const geometry = bevel > 0
    ? new RoundedBoxGeometry(...size, 2, Math.min(bevel, ...size.map(length => length / 4)))
    : new THREE.BoxGeometry(...size);
  return mesh(parent, geometry, material, center);
}

function planarBoardOutline(cx: number, cz: number, width: number, length: number, radius: number) {
  const left = cx - width / 2;
  const right = cx + width / 2;
  const bottom = -cz - length / 2;
  const top = -cz + length / 2;
  const shape = new THREE.Shape();
  shape.moveTo(left + radius, bottom);
  shape.lineTo(right - radius, bottom);
  shape.quadraticCurveTo(right, bottom, right, bottom + radius);
  shape.lineTo(right, top - radius);
  shape.quadraticCurveTo(right, top, right - radius, top);
  shape.lineTo(left + radius, top);
  shape.quadraticCurveTo(left, top, left, top - radius);
  shape.lineTo(left, bottom + radius);
  shape.quadraticCurveTo(left, bottom, left + radius, bottom);
  shape.closePath();
  return shape;
}

function pcbLayer(root: THREE.Group, material: THREE.Material, profile: THREE.Shape, y: number, thickness: number) {
  const geometry = new THREE.ExtrudeGeometry(profile, { depth: thickness, bevelEnabled: false, curveSegments: 4 });
  mesh(root, geometry, material, [0, y, 0]).rotation.x = -Math.PI / 2;
}

/** Illustrative III–V assembly with cropped corners, dense fingers, and two busbars.
 * Shape references: Spectrolab XTJ Prime (2018), Standard Cell Sizes;
 * AZUR 3G30-Advanced 4x8, DB 00010891-01, p. 1. */
function solarCell(parent: THREE.Object3D, m: Materials, center: Vec3, scale: number, rotation: number) {
  const assembly = new THREE.Group();
  assembly.position.fromArray(center);
  assembly.rotation.y = rotation;
  parent.add(assembly);

  const width = scale * 0.080;
  const length = scale * 0.040;
  const x = width / 2;
  const z = length / 2;
  const crop = scale * 0.0135;
  const thickness = Math.min(0.00032, Math.min(width, length) * 0.009);
  // Extrusion is local +Z. Rotation maps it to the coverglass normal at body +Y.
  const shape = new THREE.Shape([
    new THREE.Vector2(-x, z), new THREE.Vector2(x, z),
    new THREE.Vector2(x, -z + crop), new THREE.Vector2(x - crop, -z),
    new THREE.Vector2(-x + crop, -z), new THREE.Vector2(-x, -z + crop),
  ]);
  mesh(assembly, new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false }), m.cell, [0, 0, 0])
    .rotation.x = -Math.PI / 2;

  const border = Math.min(width, length) * 0.017;
  const metal = thickness * 0.08;
  for (let finger = 1; finger <= 13; finger += 1) {
    const along = (finger / 14 - 0.5) * (length - 2 * border);
    const clippedHalfWidth = x - Math.max(0, along - (z - crop)) - border;
    box(assembly, m.grid, [0, thickness + metal / 2, along], [2 * clippedHalfWidth, metal, Math.min(width, length) * 0.000625]);
  }
  for (const side of [-1, 1]) {
    const contactX = side * width * 0.33;
    box(assembly, m.grid, [contactX, thickness + metal * 1.5, 0], [width * 0.001, metal, length - 2 * border]);
  }
}

function instrumentDeck(root: THREE.Group, m: Materials, w: number, d: number, h: number, cellScale: number) {
  const s = Math.min(w / 0.1, d / 0.1, h / 0.1135);
  const face = d / 2 + s * 0.00165;
  const boardThickness = s * 0.0016;
  const board = planarBoardOutline(0, 0, w * 0.87, h * 0.859, s * 0.0006);
  const patch = planarBoardOutline(w * 0.22, -h * (0.025 / 0.1135), w * 0.28, h * (0.024 / 0.1135), s * 0.00055);
  const foilThickness = s * 0.000035;
  const maskClearance = s * 0.000020;
  // Expose copper in the board surface with a soldermask-height recess.
  board.holes.push(patch);
  pcbLayer(root, m.pcb, board, face - boardThickness, boardThickness);
  pcbLayer(root, m.pcb, patch, face - boardThickness, boardThickness - maskClearance - foilThickness);
  pcbLayer(root, m.patch, patch, face - maskClearance - foilThickness, foilThickness);
  solarCell(root, m, [0, face, h * (0.016 / 0.1135)], cellScale, 0);

  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const cx = x * w * 0.405;
    // The upper-left mounting screw sits below the fisheye's edge mount.
    const cz = z * h * (x < 0 && z > 0 ? 0.282 : 0.402);
    const coreSurface = d / 2 - Math.min(w, d, h) * 0.04;
    const clearance = face - boardThickness - coreSurface;
    const spacerRadius = s * 0.0023;
    mesh(root, new THREE.CylinderGeometry(spacerRadius, spacerRadius, clearance, 12), m.aluminium,
      [cx, coreSurface + clearance / 2, cz]);
    const radius = s * 0.00155;
    const thickness = s * 0.0007;
    mesh(root, new THREE.CylinderGeometry(radius, radius, thickness, 12), m.black, [cx, face + thickness / 2, cz]);
    box(root, m.aluminium, [cx, face + thickness, cz], [s * 0.0020, s * 0.00015, s * 0.00025]);
  }
}

function frame(root: THREE.Group, m: Materials, w: number, d: number, h: number) {
  const rail = Math.min(w, d, h) * 0.06;
  const flange = rail * 2 / 3;
  const ledge = rail * 5 / 3;
  box(root, m.chassis, [0, 0, 0], [w - 2 * flange, d - 2 * flange, h - 2 * flange], rail * 0.06);
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    box(root, m.aluminium, [x * (w - rail) / 2, y * (d - rail) / 2, 0], [rail, rail, h], rail * 0.06);
  }
  for (const z of [-1, 1]) for (const side of [-1, 1]) {
    const shelf = z * (h - ledge) / 2;
    box(root, m.aluminium, [0, side * (d - flange) / 2, shelf], [w, flange, ledge], rail * 0.06);
    box(root, m.aluminium, [side * (w - flange) / 2, 0, shelf], [flange, d, ledge], rail * 0.06);
  }
}

function wing(root: THREE.Group, m: Materials, body: Scenario['body'], side: number, axis: 'x' | 'z', cellScale: number) {
  const { widthM, depthM, heightM, panelWidthM, panelLengthM, panelAngleDeg } = body;
  const hinge = new THREE.Group();
  hinge.position.set(axis === 'x' ? side * widthM / 2 : 0, depthM / 2, axis === 'z' ? side * heightM / 2 : 0);
  const fold = THREE.MathUtils.degToRad(90 - panelAngleDeg);
  if (axis === 'x') hinge.rotation.z = -side * fold;
  else hinge.rotation.x = side * fold;

  const leaf = new THREE.Group();
  if (axis === 'x') {
    leaf.position.x = side * panelLengthM / 2;
    leaf.rotation.y = Math.PI / 2;
  } else leaf.position.z = side * panelLengthM / 2;
  hinge.add(leaf);
  root.add(hinge);

  const scale = Math.min(panelWidthM / 0.088, panelLengthM / 0.101);
  const thickness = scale * 0.0013;
  const rimDepth = scale * 0.0024;
  const rimWidth = scale * 0.0032;
  const dividerWidth = scale * 0.0017;
  box(leaf, m.pcb, [0, 0, 0], [panelWidthM, thickness, panelLengthM], thickness / 3);
  for (const edge of [-1, 1]) {
    box(leaf, m.aluminium, [edge * (panelWidthM - rimWidth) / 2, 0, 0],
      [rimWidth, rimDepth, panelLengthM], scale * 0.0003);
    box(leaf, m.aluminium, [0, 0, edge * (panelLengthM - rimWidth) / 2],
      [panelWidthM - 2 * rimWidth, rimDepth, rimWidth], scale * 0.0003);
  }
  box(leaf, m.aluminium, [0, 0, 0], [panelWidthM - 2 * rimWidth, rimDepth, dividerWidth], scale * 0.0002);

  // Both cells turn their clipped corners away from the hinge.
  const rowCenter = (panelLengthM / 2 - rimWidth + dividerWidth / 2) / 2;
  for (const row of [-1, 1]) {
    solarCell(leaf, m, [0, thickness / 2, row * rowCenter], cellScale, side < 0 ? Math.PI : 0);
  }

  const radius = Math.min(panelWidthM, panelLengthM) * 0.027;
  const axisPin = mesh(root, new THREE.CylinderGeometry(radius, radius, panelWidthM * 0.70, 16), m.aluminium, hinge.position.toArray());
  if (axis === 'x') axisPin.rotation.x = Math.PI / 2;
  else axisPin.rotation.z = Math.PI / 2;
}

function axialBarrel(parent: THREE.Group, material: THREE.Material, profile: [number, number][]) {
  const profilePoints = profile.map(([r, z]) => new THREE.Vector2(r, z));
  const geometry = new THREE.LatheGeometry(profilePoints, 64);
  mesh(parent, geometry, material, [0, 0, 0]).rotation.x = Math.PI / 2;
}

function glassCap(parent: THREE.Group, material: THREE.Material, radius: number, centerZ: number, polarAngle: number) {
  const geometry = new THREE.SphereGeometry(radius, 64, 28, 0, Math.PI * 2, 0, polarAngle);
  mesh(parent, geometry, material, [0, 0, centerZ]).rotation.x = Math.PI / 2;
}

/** Shape reference: Entaniya M12 220. The dome center is the model's pupil. */
function fisheyeHousing(mount: THREE.Group, m: Materials, radius: number, length: number) {
  const domeRear = Math.min(radius * 0.40, length * 0.65);
  const rearRadius = Math.sqrt(radius ** 2 - domeRear ** 2);
  const setback = length - domeRear;
  const clearance = Math.tan(THREE.MathUtils.degToRad(12));
  const flangeRadius = Math.min(radius * 0.69, (length - setback * 0.20) / clearance);
  const neckRadius = Math.min(radius * 0.47, (length - setback * 0.53) / clearance);
  const shoulderRadius = Math.min(rearRadius * 0.96, domeRear / clearance);
  axialBarrel(mount, m.black, [
    [0, -length], [flangeRadius, -length], [flangeRadius, -length + setback * 0.20],
    [neckRadius, -length + setback * 0.32], [neckRadius, -length + setback * 0.53],
    [shoulderRadius, -domeRear], [0, -domeRear],
  ]);
  // The exposed surface passes the equator. No lip projects ahead of the glass.
  glassCap(mount, m.fisheyeGlass, radius, 0, Math.acos(-domeRear / radius));
}

function mainHousing(mount: THREE.Group, m: Materials, radius: number, length: number) {
  const nose = Math.min(length * 0.12, radius * 0.20);
  const opening = radius * 0.77;
  axialBarrel(mount, m.black, [
    [radius * 0.67, -length], [radius * 0.67, -length * 0.79],
    [radius * 0.82, -length * 0.76], [radius * 0.82, -length * 0.28],
    [radius, -length * 0.25], [radius, -nose], [radius * 0.92, -nose * 0.76],
    [radius * 0.92, -nose * 0.15], [radius * 0.88, 0], [opening, 0],
    [opening, -nose * 0.60],
  ]);
  const lensEdge = opening * 1.02;
  const sag = Math.min(radius * 0.058, nose * 0.42);
  const sphereRadius = (lensEdge ** 2 + sag ** 2) / (2 * sag);
  glassCap(mount, m.glass, sphereRadius, -nose * 0.08 - sphereRadius, Math.asin(lensEdge / sphereRadius));
}

function addCameraOutline(mount: THREE.Group, material: THREE.Material) {
  const outline = new THREE.Group();
  outline.name = CAMERA_OUTLINE;
  outline.layers.set(EDITOR_LAYER);
  outline.visible = false;
  for (const part of mount.children) {
    if (!(part instanceof THREE.Mesh)) continue;
    const expanded = mesh(outline, part.geometry, material, [0, 0, 0]);
    expanded.scale.set(1.17, 1.17, 1.13);
    expanded.layers.set(EDITOR_LAYER);
  }
  mount.add(outline);
}

export function setSpacecraftCameraHighlight(ship: THREE.Group, selectedId: CameraId | null) {
  const selectWides = selectedId === 'wideA' || selectedId === 'wideB';
  for (const mount of ship.children) {
    const outline = mount.getObjectByName(CAMERA_OUTLINE);
    if (!outline) continue;
    outline.visible = mount.userData.cameraId === 'main' ? selectedId === 'main' : selectWides;
  }
}

function cameraHousings(root: THREE.Group, m: Materials, scenario: Scenario) {
  for (const config of scenario.cameras) {
    const mount = new THREE.Group();
    mount.name = `Camera mount ${config.id}`;
    mount.userData.cameraId = config.id;
    const length = config.housingLengthMm / 1000;
    const radius = config.housingDiameterMm / 2000;
    if (config.id === 'main') mainHousing(mount, m, radius, length);
    else fisheyeHousing(mount, m, radius, length);
    mergeParts(mount);
    addCameraOutline(mount, m.selection);
    root.add(mount);
  }
  updateSpacecraftMounts(root, scenario);
}

export function updateSpacecraftMounts(ship: THREE.Group, scenario: Scenario) {
  for (const mount of ship.children) {
    const id = mount.userData.cameraId;
    if (!id) continue;
    const config = scenario.cameras.find(camera => camera.id === id)!;
    mount.position.fromArray(config.positionBodyM);
    mount.quaternion.fromArray(cameraBodyRotation(config));
    mount.updateMatrix();
  }
}

function mergeParts(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material as THREE.Material;
    const parts = batches.get(material) ?? [];
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    parts.push(geometry.applyMatrix4(object.matrixWorld));
    batches.set(material, parts);
    object.geometry.dispose();
  });
  group.clear();
  for (const [material, parts] of batches) {
    const merged = mergeGeometries(parts);
    parts.forEach(part => part.dispose());
    if (!merged) continue;
    const part = mesh(group, merged, material, [0, 0, 0]);
    part.castShadow = true;
    part.receiveShadow = true;
  }
}

/** Provisional mechanical envelope in meters. These decorative details are illustrative. */
export function makeSpacecraft(scenario: Scenario): THREE.Group {
  const root = new THREE.Group();
  const m = spacecraftMaterials();
  const { widthM, depthM, heightM, panelWidthM, panelLengthM } = scenario.body;
  const cellScale = Math.min(widthM / 0.1, heightM / 0.1135, panelWidthM / 0.088, panelLengthM / 0.101);
  frame(root, m, widthM, depthM, heightM);
  instrumentDeck(root, m, widthM, depthM, heightM, cellScale);
  for (const side of [-1, 1]) {
    wing(root, m, scenario.body, side, 'x', cellScale);
    wing(root, m, scenario.body, side, 'z', cellScale);
  }
  mergeParts(root);
  cameraHousings(root, m, scenario);
  return root;
}

export function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}
