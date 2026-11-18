import * as THREE from 'three/webgpu';

const TAPE_LENGTH_M = 299_792_458 / (4 * 433e6);
const TAPE_SPLAY_RAD = THREE.MathUtils.degToRad(30);
const TAPE_WIDTH_M = 0.0055;
const TAPE_THICKNESS_M = 0.0002;
const TAPE_CAMBER_M = 0.00055;
const CROSS_SECTION_STEPS = 8;

function tapeMarkings() {
  const width = 512, height = 32;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mm = (x + 0.5) * TAPE_LENGTH_M * 1000 / width;
      const major = Math.abs(mm - 10 * Math.round(mm / 10)) < 0.24;
      const minor = Math.abs(mm - 2 * Math.round(mm / 2)) < 0.20;
      const ink = (major && y < 16) || (minor && y < 8);
      pixels.set(ink ? [77, 78, 74, 255] : [237, 235, 224, 255], (y * width + x) * 4);
    }
  }
  const map = new THREE.DataTexture(pixels, width, height);
  map.colorSpace = THREE.SRGBColorSpace;
  map.generateMipmaps = true;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}

/** Closed tape cross section, extruded along local +X. The edges rise
 * above the center of the marked face, as on a curved steel tape. */
function tapeGeometry() {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const crossSection: [number, number][] = [];
  for (const face of [1, -1]) {
    for (let i = 0; i <= CROSS_SECTION_STEPS; i++) {
      const across = face * (2 * i / CROSS_SECTION_STEPS - 1);
      crossSection.push([across, TAPE_CAMBER_M * across ** 2 + face * TAPE_THICKNESS_M / 2]);
    }
  }
  const count = crossSection.length;
  for (const u of [0, 1]) for (const [across, z] of crossSection) {
    positions.push(u * TAPE_LENGTH_M, across * TAPE_WIDTH_M / 2, z);
    uvs.push(u, 0.5 + across / 2);
  }
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    indices.push(i, count + i, j, j, count + i, count + j);
  }
  // End caps fan across opposite vertices so the camber remains open in profile.
  for (let i = 0; i < CROSS_SECTION_STEPS; i++) {
    const a = i, b = i + 1, c = count - 1 - i, d = count - 2 - i;
    indices.push(a, b, c, b, d, c, count + a, count + c, count + b, count + b, count + c, count + d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const markedFaceIndices = 6 * CROSS_SECTION_STEPS;
  geometry.addGroup(0, markedFaceIndices, 0);
  geometry.addGroup(markedFaceIndices, indices.length - markedFaceIndices, 1);
  return geometry;
}

/** Sapling-style deployed V, on body −Y. The dimensions and tape angles
 * are illustrative, as the reference photographs do not give dimensions. */
export function makeRearDipole(rearFaceY: number, widthM: number, heightM: number) {
  const mount = new THREE.Group();
  mount.name = 'Rear tape dipole';
  mount.position.set(0, rearFaceY, -heightM * 0.24);
  const socketSpacing = Math.min(widthM * 0.39, 0.039);
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(socketSpacing + 0.008, 0.004, 0.011),
    new THREE.MeshStandardMaterial({ color: 0x292f34, roughness: 0.58 }),
  );
  base.position.y = -0.002;
  mount.add(base);

  const geometry = tapeGeometry();
  const white = new THREE.MeshStandardMaterial({ map: tapeMarkings(), roughness: 0.53 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x697078, metalness: 0.64, roughness: 0.41 });
  const lateral = Math.sin(TAPE_SPLAY_RAD);
  for (const side of [-1, 1]) {
    const arm = new THREE.Vector3(side * lateral, -Math.cos(TAPE_SPLAY_RAD), 0);
    const across = new THREE.Vector3(0, 0, 1).cross(arm).normalize();
    if (side > 0) across.applyAxisAngle(arm, THREE.MathUtils.degToRad(72));
    const normal = new THREE.Vector3().crossVectors(arm, across);
    const tape = new THREE.Mesh(geometry, [white, steel]);
    tape.name = side < 0 ? 'Rear tape −X' : 'Rear tape +X';
    // Each arm starts at its feed terminal on the rear surface of the mount.
    tape.position.set(side * socketSpacing / 2, -0.004, 0);
    tape.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(arm, across, normal));
    mount.add(tape);
  }
  mount.traverse(part => {
    if (!(part instanceof THREE.Mesh)) return;
    part.castShadow = true;
    part.receiveShadow = true;
  });
  return mount;
}
