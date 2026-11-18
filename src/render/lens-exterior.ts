import * as THREE from 'three/webgpu';

type Section = [radius: number, z: number];

// Local +Z follows the optical axis. Scale the exterior to the scenario's
// housing diameter and rear setback from its entrance-pupil reference.
function barrel(mount: THREE.Group, material: THREE.Material, sections: Section[]) {
  const geometry = new THREE.LatheGeometry(sections.map(([r, z]) => new THREE.Vector2(r, z)), 48);
  geometry.rotateX(Math.PI / 2);
  mount.add(new THREE.Mesh(geometry, material));
}

function frontElement(mount: THREE.Group, material: THREE.Material, radius: number,
  apexZ: number, angle: number, axialScale = 1) {
  const geometry = new THREE.SphereGeometry(radius, 48, 20, 0, 2 * Math.PI, 0, angle);
  const positions = geometry.getAttribute('position');
  const colors: number[] = [];
  // Approximate the dark pupil and off-axis reflections behind the coated
  // surface in one opaque draw. Highlights track the actual scene lighting.
  for (let i = 0; i < positions.count; i++) {
    const polar = Math.acos(THREE.MathUtils.clamp(positions.getY(i) / radius, -1, 1)) / angle;
    const iris = THREE.MathUtils.smoothstep(polar, 0.42, 0.52);
    const edge = 1 - THREE.MathUtils.smoothstep(polar, 0.8, 1);
    colors.push(0.003 + iris * edge * 0.012, 0.005 + iris * edge * 0.026, 0.008 + iris * edge * 0.031);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, apexZ - radius);
  geometry.scale(1, 1, axialScale);
  mount.add(new THREE.Mesh(geometry, material));
}

// Commonlands CIL220-F2.3-M12C650 rev. 1, drawing sheet 1.
// https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/6504/CIL220-F2.3-M12C650.pdf
function cil220(mount: THREE.Group, metal: THREE.Material, glass: THREE.Material, r: number, length: number) {
  // At the 215° field edge the drawing puts the entrance pupil at the glass apex.
  // Sag is 16.0 mm TTL less 2.9 mm rear clearance, 8.1 mm neck, and 3.1 mm collar.
  const sagMm = 1.9, collarMm = 3.1, neckMm = 8.1;
  const shoulderMm = sagMm + collarMm;
  const rearMm = shoulderMm + neckMm;
  const radialUnit = r / 7, axialUnit = length / rearMm;
  const edgeMm = 6;
  const profile: Section[] = [[0, -rearMm], [5.6, -rearMm], [5.75, -rearMm + 0.15],
    [5.75, -11.15], [5.65, -11.15]];
  // Shallow lathed rings suggest the exposed M12×0.5 thread in the drawing.
  for (let z = -11.0; z < -6.5; z += 0.5) {
    profile.push([6, z], [6, z + 0.14], [5.65, z + 0.32]);
  }
  profile.push([5.65, -6.48], [5.75, -6.42], [5.75, -shoulderMm - 0.15],
    [6, -shoulderMm], [6.95, -shoulderMm], [7, -shoulderMm + 0.10],
    [7, -sagMm - 0.10], [6.9, -sagMm], [edgeMm, -sagMm]);
  barrel(mount, metal, profile.map(([radius, z]) => [radius * radialUnit, z * axialUnit]));
  const curvatureMm = (edgeMm ** 2 + sagMm ** 2) / (2 * sagMm);
  frontElement(mount, glass, curvatureMm * radialUnit, 0,
    2 * Math.atan(sagMm / edgeMm), axialUnit / radialUnit);
}

/** Exterior sections. Supplier dimensions are used where available. */
export function addLensExterior(mount: THREE.Group, metal: THREE.Material, glass: THREE.Material,
  r: number, length: number, main: boolean, profileId?: string) {
  if (main) {
    // Rear mounting boss, stepped focus grip, retaining bezel and recessed glass.
    const profile: Section[] = [[0, -1], [0.64, -1], [0.64, -0.82], [0.77, -0.80],
      [0.77, -0.72], [0.82, -0.70], [0.82, -0.63], [0.91, -0.60]];
    for (const z of [-0.56, -0.50, -0.44]) {
      profile.push([0.95, z], [0.95, z + 0.025], [0.91, z + 0.035]);
    }
    profile.push([0.91, -0.28], [1, -0.24], [1, -0.05], [0.94, 0],
      [0.76, 0], [0.70, -0.044], [0.70, -0.12]);
    barrel(mount, metal, profile.map(([radius, z]) => [radius * r, z * length]));
    const edge = 0.71 * r;
    const sag = Math.min(0.095 * r, 0.075 * length);
    const curvature = (edge * edge + sag * sag) / (2 * sag);
    frontElement(mount, glass, curvature, -0.045 * length, Math.asin(edge / curvature));
    return;
  }

  // FRAMOS's L185A module drawing gives Ø25.8 mm and a 3.94 mm sag (30.70 − 26.76).
  // The remaining FRAMOS exterior sections relative to the pupil are illustrative.
  // https://docs.framos.com/en/latest/FSMEcosystem/ProductDocumentation/FSMGO/IMX676.html#l185a
  const framos = profileId === 'framos-l185a';
  if (profileId === 'commonlands-cil220' || framos) {
    // The specified angular coverage already includes the lens's own mechanical field stop.
    mount.userData.catalogLensHousing = true;
    if (!framos) {
      cil220(mount, metal, glass, r, length);
      return;
    }
  }
  const neckRadius = (framos ? 12 / 25.8 : 0.59) * r;
  const domeRadius = 0.94 * r;
  const rimDepth = Math.min((framos ? 0.07 : 0.34) * r, 0.55 * length);
  const seatRadius = framos ? 0.86 * r : Math.sqrt(domeRadius ** 2 - rimDepth ** 2);
  const span = length - rimDepth;
  const sections: Section[] = [[0, -length], [neckRadius, -length],
    [neckRadius, -length + 0.27 * span], [0.66 * r, -length + 0.30 * span],
    [0.66 * r, -length + 0.42 * span], [0.84 * r, -rimDepth - 0.36 * span],
    [r, -rimDepth - 0.27 * span], [r, -rimDepth - 0.10 * span],
    [0.96 * r, -rimDepth], [seatRadius, -rimDepth]];
  barrel(mount, metal, sections);
  const sag = framos ? (3.94 / 12.9) * r : domeRadius + rimDepth;
  const curvature = (seatRadius ** 2 + sag ** 2) / (2 * sag);
  frontElement(mount, glass, curvature, sag - rimDepth, 2 * Math.atan(sag / seatRadius));
}
