// Real CC0 office props for the workstations, loaded from the bundled Poly Haven gltf
// files (provenance + md5s: ../MODEL_CREDITS.md).
//
// Each asset is loaded once, then every mesh under it is baked into its asset-space
// transform and merged per material, so one desk costs ONE draw call no matter how many
// employees are on shift (`InstanceField` instances the merged part at every home).
// Nothing here suspends the rest of the scene: every prop layer carries its own
// Suspense + error boundary and a procedural fallback, so a missing or unreadable file
// degrades that one prop instead of blanking the canvas.
import { Component, Suspense, useMemo, type ReactNode } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Vec2 } from "../layout";
import type { LocalTransform } from "./InstanceField";
import { homeMatrices, InstanceField } from "./InstanceField";
import type { PropPlacement } from "./propLayout";

export type PropKey = "desk" | "cabinet" | "shelf" | "lamp";

export interface PropSource {
  /** Poly Haven asset id — also the folder the 1k gltf + .bin + textures live in */
  id: string;
  url: string;
}

export const PROP_SOURCES: Record<PropKey, PropSource> = {
  desk: { id: "metal_office_desk", url: "/virtual-factory/props/metal_office_desk/metal_office_desk.gltf" },
  cabinet: { id: "drawer_cabinet", url: "/virtual-factory/props/drawer_cabinet/drawer_cabinet.gltf" },
  shelf: { id: "Shelf_01", url: "/virtual-factory/props/Shelf_01/Shelf_01.gltf" },
  lamp: { id: "desk_lamp_arm_01", url: "/virtual-factory/props/desk_lamp_arm_01/desk_lamp_arm_01.gltf" },
};

/** Warm the browser cache before the first workstation mounts, like avatarAssets does. */
export function preloadPropModels(): void {
  for (const source of Object.values(PROP_SOURCES)) useGLTF.preload(source.url);
}
preloadPropModels();

export interface PropPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

const mergedByURL = new Map<string, PropPart[]>();

/**
 * Merge an entire gltf scene into one geometry per material, baked into the asset's own
 * space so `MEASURED` bounds describe the result. Throws when the primitives cannot be
 * merged (unexpected export shape) — the caller's boundary turns that into the
 * procedural fallback rather than an empty room.
 */
function mergePropScene(url: string, root: THREE.Object3D): PropPart[] {
  const cached = mergedByURL.get(url);
  if (cached) return cached;

  root.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry.clone() as THREE.BufferGeometry;
    geometry.applyMatrix4(mesh.matrixWorld);
    // mergeGeometries rejects mismatched attribute sets; these files are plain
    // POSITION/NORMAL/UV, and anything else a re-export may add is dropped on purpose.
    for (const name of ["color", "uv1", "uv2", "uv3", "tangent"] as const) {
      if (geometry.hasAttribute(name)) geometry.deleteAttribute(name);
    }
    if (!geometry.hasAttribute("uv")) {
      geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
    }
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) ?? null;
    if (!material) return;
    const list = buckets.get(material) ?? [];
    list.push(geometry);
    buckets.set(material, list);
  });

  const parts: PropPart[] = [];
  for (const [material, list] of buckets) {
    // mergeGeometries rejects a mix of indexed and non-indexed primitives; these four
    // files are uniformly indexed, but a re-export that mixes them must not strand the
    // prop, so flatten the group rather than fail.
    const mixed = list.some(g => g.index === null) && list.some(g => g.index !== null);
    const geometries = mixed ? list.map(g => (g.index ? g.toNonIndexed() : g)) : list;
    const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
    if (!merged) throw new Error(`[virtual-factory] cannot merge prop ${url} (${list.length} incompatible primitives)`);
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    for (const geometry of geometries) if (geometry !== merged) geometry.dispose();
    parts.push({ geometry: merged, material });
  }
  if (!parts.length) throw new Error(`[virtual-factory] prop ${url} has no renderable mesh`);
  parts.sort((a, b) => a.geometry.attributes.position.count - b.geometry.attributes.position.count);
  mergedByURL.set(url, parts);
  return parts;
}

function placementLocal(placement: PropPlacement): LocalTransform {
  return {
    position: placement.position,
    rotation: [0, placement.rotationY, 0],
    scale: placement.scale,
  };
}

function PropInstances({ source, placement, homes }: { source: PropSource; placement: PropPlacement; homes: readonly Vec2[] }) {
  const gltf = useGLTF(source.url);
  const parts = useMemo(() => mergePropScene(source.url, gltf.scene), [source.url, gltf]);
  const matrices = useMemo(() => homeMatrices(homes, [placementLocal(placement)]), [homes, placement]);
  return (
    <>
      {parts.map((part, i) => (
        <InstanceField key={`${source.id}-${i}`} geometry={part.geometry} material={part.material} matrices={matrices} />
      ))}
    </>
  );
}

interface BoundaryState {
  failed: boolean;
}

/** Keeps a 404 or an unexpected export from taking the canvas down with it. */
export class PropErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error("[virtual-factory] office prop unavailable, using the procedural fallback:", error);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export interface PropLayerProps {
  prop: PropKey;
  placement: PropPlacement;
  homes: readonly Vec2[];
  /** drawn while the file loads and if it never arrives */
  fallback?: ReactNode;
}

/** One prop across every workstation, isolated from the rest of the scene. */
export function PropLayer({ prop, placement, homes, fallback = null }: PropLayerProps) {
  const source = PROP_SOURCES[prop];
  if (!homes.length) return null;
  return (
    <PropErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <PropInstances source={source} placement={placement} homes={homes} />
      </Suspense>
    </PropErrorBoundary>
  );
}
