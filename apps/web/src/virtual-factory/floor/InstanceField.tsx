// One draw call per (geometry, material) for the whole workstation field.
//
// Every desk-bound employee gets byte-identical furniture — only the home position
// differs — so instead of ~30 meshes per workstation we render each repeated part as a
// single InstancedMesh whose matrices are `translate(home) · partLocal`. Geometries and
// materials stay module-level constants shared by every instance (see Workstations.tsx
// and propAssets.tsx), so the floor costs a handful of draw calls rather than a
// thousand, in both the colour pass and the shadow pass.
import { useCallback } from "react";
import * as THREE from "three";
import type { Vec2 } from "../layout";

export type Vec3 = [number, number, number];

/** A workstation-local transform for one repeated part. */
export interface LocalTransform {
  position?: Vec3;
  /** euler XYZ, radians */
  rotation?: Vec3;
  scale?: Vec3 | number;
}

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _home = new THREE.Matrix4();

/** A workstation-local part transform as a matrix (geometry baking uses the same order). */
export function localMatrix(t: LocalTransform): THREE.Matrix4 {
  _pos.set(t.position?.[0] ?? 0, t.position?.[1] ?? 0, t.position?.[2] ?? 0);
  _quat.setFromEuler(_euler.set(t.rotation?.[0] ?? 0, t.rotation?.[1] ?? 0, t.rotation?.[2] ?? 0));
  if (Array.isArray(t.scale)) _scale.set(t.scale[0], t.scale[1], t.scale[2]);
  else _scale.set(t.scale ?? 1, t.scale ?? 1, t.scale ?? 1);
  return new THREE.Matrix4().compose(_pos, _quat, _scale);
}

/** `translate(home) · local` for every (home, local) pair, in workstation order. */
export function homeMatrices(homes: readonly Vec2[], locals: readonly LocalTransform[]): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = [];
  for (const home of homes) {
    for (const t of locals) {
      _home.makeTranslation(home.x, 0, home.z);
      out.push(_home.clone().multiply(localMatrix(t)));
    }
  }
  return out;
}

interface InstanceFieldProps {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrices: readonly THREE.Matrix4[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/**
 * Renders `matrices` as one InstancedMesh. The matrices are written through the ref
 * callback, so any change to the array re-uploads the instance buffer without rebuilding
 * the mesh (its `args` only change when the part count changes).
 */
export function InstanceField({ geometry, material, matrices, castShadow = true, receiveShadow = true }: InstanceFieldProps) {
  const count = matrices.length;
  const attach = useCallback((mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return;
    for (let i = 0; i < count; i++) mesh.setMatrixAt(i, matrices[i]);
    mesh.instanceMatrix.needsUpdate = true;
    // the shared geometry bounds describe one part; culling has to see all of them
    mesh.computeBoundingSphere();
  }, [matrices, count]);
  if (!count) return null;
  return (
    <instancedMesh
      ref={attach}
      args={[geometry, material, count]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      dispose={null}
    />
  );
}
