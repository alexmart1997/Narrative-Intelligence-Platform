import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GraphEdge } from "@/lib/api";
import { edgeStrength } from "./graphEncoding";
import { NodeMesh, SceneNode } from "./types";

export type FlyTarget = {
  camera: THREE.Vector3;
  target: THREE.Vector3;
  startedAt: number;
  duration: number;
};

export function configureOrbitControls(
  controls: OrbitControls,
  autoOrbit: boolean
) {
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.42;
  controls.zoomSpeed = 0.62;
  controls.panSpeed = 0.42;
  controls.minDistance = 180;
  controls.maxDistance = 1050;
  controls.autoRotate = autoOrbit;
  controls.autoRotateSpeed = 0.65;
  controls.target.set(0, 0, 0);
}

export function resetCameraToBounds(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  nodes: SceneNode[],
) {
  const bounds = new THREE.Box3().setFromPoints(nodes.map((node) => node.position));
  const size = bounds.getSize(new THREE.Vector3()).length() || 420;
  const center = bounds.getCenter(new THREE.Vector3());
  const distance = Math.max(360, Math.min(920, size * 0.72));

  controls.target.copy(center);
  camera.position.copy(center.clone().add(new THREE.Vector3(0, 220, distance)));
  clampCamera(camera, controls);
  controls.update();
}

export function topDownCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  nodes: SceneNode[],
) {
  const bounds = new THREE.Box3().setFromPoints(nodes.map((node) => node.position));
  const center = bounds.getCenter(new THREE.Vector3());
  const distance = Math.max(620, Math.min(1050, bounds.getSize(new THREE.Vector3()).length()));
  controls.target.copy(center);
  camera.position.copy(center.clone().add(new THREE.Vector3(0, distance, 8)));
  clampCamera(camera, controls);
  controls.update();
}

export function createFlyTarget(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  node: SceneNode,
): FlyTarget {
  const distance = Math.max(260, Math.min(520, camera.position.distanceTo(controls.target)));
  const direction = camera.position.clone().sub(controls.target).normalize();
  return {
    camera: node.position.clone().add(direction.multiplyScalar(distance)),
    target: node.position.clone(),
    startedAt: performance.now(),
    duration: 850,
  };
}

export function tickFlyTarget(
  flyTarget: FlyTarget | null,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
) {
  if (!flyTarget) return null;
  const progress = Math.min(1, (performance.now() - flyTarget.startedAt) / flyTarget.duration);
  const eased = 1 - Math.pow(1 - progress, 3);
  camera.position.lerp(flyTarget.camera, eased);
  controls.target.lerp(flyTarget.target, eased);
  clampCamera(camera, controls);
  return progress >= 1 ? null : flyTarget;
}

export function applyHoverState(
  nodeMeshes: NodeMesh[],
  edgeObjects: Array<{ edge: GraphEdge; object: THREE.Object3D }>,
  neighborMap: Map<string, Set<string>>,
  hoveredNodeId: string | null,
  selectedNodeId: string | null,
) {
  const highlighted = new Set<string>();
  if (hoveredNodeId) {
    highlighted.add(hoveredNodeId);
    (neighborMap.get(hoveredNodeId) ?? new Set<string>()).forEach((id) => highlighted.add(id));
  }
  if (selectedNodeId) {
    highlighted.add(selectedNodeId);
    (neighborMap.get(selectedNodeId) ?? new Set<string>()).forEach((id) => highlighted.add(id));
  }

  for (const mesh of nodeMeshes) {
    const node = mesh.userData.graphNode;
    const active = highlighted.size === 0 || highlighted.has(node.id);
    mesh.scale.setScalar(active ? (node.id === hoveredNodeId ? 1.14 : 1) : 0.82);
    const material = mesh.material;
    if (!Array.isArray(material)) {
      material.opacity = active ? Math.max(0.72, Math.min(0.98, node.confidence)) : 0.58;
      material.needsUpdate = true;
    }
  }

  for (const item of edgeObjects) {
    const active = highlighted.size === 0 || highlighted.has(item.edge.source) || highlighted.has(item.edge.target);
    item.object.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        const material = object.material;
        if (!Array.isArray(material)) {
          material.opacity = active ? Math.max(0.2, Math.min(0.58, edgeStrength(item.edge) * 0.62)) : 0.16;
          material.needsUpdate = true;
        }
      }
    });
  }
}

function clampCamera(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
  const distance = camera.position.distanceTo(controls.target);
  if (distance < controls.minDistance || distance > controls.maxDistance) {
    const clamped = Math.max(controls.minDistance, Math.min(controls.maxDistance, distance));
    const direction = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target.clone().add(direction.multiplyScalar(clamped)));
  }
}
