"use client";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { GraphEdge } from "@/lib/api";
import { edgePalette, edgeStrength, graphNodeLabel, labelPriority, translateNodeType } from "./graphEncoding";
import { applyGraphFilters, buildNeighborMap, buildSceneNodes } from "./graphLayout";
import {
  applyHoverState,
  configureOrbitControls,
  createFlyTarget,
  resetCameraToBounds,
  tickFlyTarget,
  topDownCamera,
  type FlyTarget
} from "./graphInteraction";
import { GraphSceneOptions, NodeMesh, SceneNode } from "./types";

export function createThreeGraphScene({
  activeArticleId,
  autoOrbit,
  cameraMode,
  container,
  filters,
  focusMode,
  graph,
  mode,
  onEdgeSelect,
  onNodeSelect,
  selectedNodeId
}: GraphSceneOptions) {
  const visibleGraph = applyGraphFilters(graph, filters, focusMode ? selectedNodeId : null);
  const sceneNodes = buildSceneNodes(visibleGraph, activeArticleId, mode);
  const nodeById = new Map(sceneNodes.map((node) => [node.id, node]));
  const neighborMap = buildNeighborMap(visibleGraph.edges);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2("#030405", 0.00028);

  const width = Math.max(container.clientWidth, 640);
  const height = Math.max(container.clientHeight, 480);
  const camera = new THREE.PerspectiveCamera(46, width / height, 1, 5000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  container.replaceChildren(renderer.domElement);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.11, 0.24, 0.5));
  composer.addPass(new OutputPass());

  const labelLayer = document.createElement("div");
  labelLayer.className = "graphLabelLayer";
  container.appendChild(labelLayer);

  const controls = new OrbitControls(camera, renderer.domElement);
  configureOrbitControls(controls, autoOrbit);

  scene.add(new THREE.AmbientLight("#cbd5e1", 0.72));
  const keyLight = new THREE.PointLight("#7dd3fc", 1.2, 1200);
  keyLight.position.set(-220, 260, 300);
  scene.add(keyLight);
  const warmLight = new THREE.PointLight("#fbbf24", 0.62, 900);
  warmLight.position.set(260, -180, 260);
  scene.add(warmLight);

  const nodeMeshes: NodeMesh[] = [];
  const labelItems: Array<{ element: HTMLDivElement; node: SceneNode }> = [];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const edgeObjects: Array<{ edge: GraphEdge; object: THREE.Object3D }> = [];
  let hoveredNodeId: string | null = null;
  let flyTarget: FlyTarget | null = null;

  addStarField(scene, hashGraph(visibleGraph.nodes.map((node) => node.id).join("|")));
  addDepthRings(scene);

  for (const edge of visibleGraph.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const object = createEdgeObject(source, target, edge);
    scene.add(object);
    edgeObjects.push({ edge, object });
  }

  for (const node of sceneNodes) {
    const selected = node.id === selectedNodeId;
    const mesh = createNodeMesh(node, node.id === `article_${activeArticleId}` || Boolean(node.data.is_focus), selected) as unknown as NodeMesh;
    mesh.userData.graphNode = node;
    mesh.userData.baseSize = node.size;
    scene.add(mesh);
    nodeMeshes.push(mesh);

    const label = createHtmlLabel(node);
    label.addEventListener("click", (event) => {
      event.stopPropagation();
      onNodeSelect(node);
    });
    labelLayer.appendChild(label);
    labelItems.push({ element: label, node });
  }

  const resetView = () => resetCameraToBounds(camera, controls, sceneNodes);
  const topDown = () => topDownCamera(camera, controls, sceneNodes);
  if (cameraMode === "top") topDown();
  else resetView();

  function render() {
    flyTarget = tickFlyTarget(flyTarget, camera, controls);
    controls.update();
    updateHtmlLabels(labelItems, camera, renderer, filters.labelDensity, hoveredNodeId, selectedNodeId);
    composer.render();
    animationId = requestAnimationFrame(render);
  }

  function resize() {
    const nextWidth = Math.max(container.clientWidth, 640);
    const nextHeight = Math.max(container.clientHeight, 480);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight);
    composer.setSize(nextWidth, nextHeight);
  }

  function click(event: MouseEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const nodeHit = raycaster.intersectObjects(nodeMeshes, false)[0];
    if (nodeHit) {
      const node = (nodeHit.object as NodeMesh).userData.graphNode;
      onNodeSelect(node);
      flyTarget = createFlyTarget(camera, controls, node);
      return;
    }

    raycaster.params.Line = { threshold: 9 };
    const lineHit = raycaster.intersectObjects(edgeObjects.map((item) => item.object), true)[0];
    if (lineHit) {
      const edgeId = lineHit.object.userData.edgeId;
      const edgeItem = edgeObjects.find((item) => item.edge.id === edgeId || item.object === lineHit.object);
      if (edgeItem) onEdgeSelect(edgeItem.edge);
    }
  }

  function move(event: MouseEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const nodeHit = raycaster.intersectObjects(nodeMeshes, false)[0];
    const nextHoveredId = nodeHit ? (nodeHit.object as NodeMesh).userData.graphNode.id : null;
    if (nextHoveredId !== hoveredNodeId) {
      hoveredNodeId = nextHoveredId;
      applyHoverState(nodeMeshes, edgeObjects, neighborMap, hoveredNodeId, selectedNodeId);
    }
  }

  let animationId = requestAnimationFrame(render);
  window.addEventListener("resize", resize);
  renderer.domElement.addEventListener("click", click);
  renderer.domElement.addEventListener("mousemove", move);

  return {
    dispose() {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("click", click);
      renderer.domElement.removeEventListener("mousemove", move);
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
          object.geometry?.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material?.dispose();
        }
      });
      composer.dispose();
      renderer.dispose();
      container.replaceChildren();
    },
    resetView,
    topDown
  };
}

function createNodeMesh(node: SceneNode, focused: boolean, selected: boolean) {
  const geometry = new THREE.SphereGeometry(node.size, 32, 24);
  const material = new THREE.MeshStandardMaterial({
    color: node.color,
    emissive: node.color,
    emissiveIntensity: focused || selected ? 0.42 : node.type === "article" ? 0.24 : 0.14,
    metalness: 0.15,
    roughness: 0.42,
    transparent: true,
    opacity: Math.max(0.72, Math.min(0.98, node.confidence)),
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(node.position);

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(node.size * (focused || selected ? 1.46 : 1.26), 32, 24),
    new THREE.MeshBasicMaterial({
      color: node.color,
      transparent: true,
      opacity: focused || selected ? 0.038 : 0.012,
      depthWrite: false
    })
  );
  mesh.add(glow);

  if (node.type === "article" || selected) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(node.size * (selected ? 1.62 : 1.42), selected ? 0.95 : 0.65, 10, 88),
      new THREE.MeshBasicMaterial({
        color: selected ? "#fbbf24" : "#38bdf8",
        transparent: true,
        opacity: selected ? 0.34 : 0.16,
        depthWrite: false
      })
    );
    ring.rotation.x = Math.PI / 2.35;
    mesh.add(ring);
  }
  return mesh;
}

function createEdgeObject(source: SceneNode, target: SceneNode, edge: GraphEdge): THREE.Object3D {
  const curve = edgeCurve(source, target);
  const color = edgePalette[edge.label] ?? "#7dd3fc";
  const strength = edgeStrength(edge);
  const opacity = Math.max(0.12, Math.min(0.42, strength * 0.48));
  const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(36));
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: Math.max(0.1, opacity * 0.76)
  });
  const line = new THREE.Line(geometry, material);
  line.userData.edgeId = edge.id;
  return line;
}

function edgeCurve(source: SceneNode, target: SceneNode) {
  const midpoint = source.position.clone().add(target.position).multiplyScalar(0.5);
  midpoint.y += 36 + source.position.distanceTo(target.position) * 0.1;
  return new THREE.QuadraticBezierCurve3(source.position, midpoint, target.position);
}

function addStarField(scene: THREE.Scene, seed: number) {
  const count = 120;
  const random = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (random() - 0.5) * 1600;
    positions[index * 3 + 1] = (random() - 0.5) * 900;
    positions[index * 3 + 2] = (random() - 0.5) * 1600;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  scene.add(new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: "#38bdf8",
      opacity: 0.08,
      size: 1,
      transparent: true,
      depthWrite: false
    })
  ));
}

function addDepthRings(scene: THREE.Scene) {
  for (const radius of [190, 330, 470]) {
    const curve = new THREE.EllipseCurve(0, 0, radius, radius * 0.52);
    const points = curve.getPoints(160).map((point) => new THREE.Vector3(point.x, -140, point.y));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: "#155e75",
      opacity: 0.08,
      transparent: true
    });
    scene.add(new THREE.LineLoop(geometry, material));
  }
}

function createHtmlLabel(node: SceneNode) {
  const element = document.createElement("div");
  element.className = `nodeLabel label_${node.type}`;
  element.innerHTML = `
    <span>${translateNodeType(node.type)}</span>
    <strong>${escapeHtml(shortLabel(graphNodeLabel(node)))}</strong>
  `;
  return element;
}

function updateHtmlLabels(
  labels: Array<{ element: HTMLDivElement; node: SceneNode }>,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  labelDensity: number,
  hoveredNodeId: string | null,
  selectedNodeId: string | null,
) {
  const width = renderer.domElement.clientWidth;
  const height = renderer.domElement.clientHeight;
  const candidates = labels
    .map((item) => {
      const vector = item.node.position.clone();
      vector.y += item.node.size + 22;
      vector.project(camera);
      const x = (vector.x * 0.5 + 0.5) * width;
      const y = (-vector.y * 0.5 + 0.5) * height;
      const distance = camera.position.distanceTo(item.node.position);
      const zoomFactor = distance < 420 ? 0.36 : distance < 720 ? 0.2 : 0.06;
      const required = item.node.id === hoveredNodeId
        || item.node.id === selectedNodeId
        || Boolean(item.node.data.is_focus);
      return {
        item,
        distance,
        priority: labelPriority(item.node, distance, hoveredNodeId, selectedNodeId) + zoomFactor * 120,
        required,
        visible: vector.z < 1 && x > -120 && x < width + 120 && y > -80 && y < height + 120,
        x,
        y,
      };
    })
    .sort((left, right) => right.priority - left.priority);

  const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  const maxLabels = Math.round(7 + labelDensity * 22 + Math.max(0, 760 - camera.position.length()) / 58);
  const minPriority = 330 + (1 - labelDensity) * 265;
  let shown = 0;

  for (const candidate of candidates) {
    const { item, x, y, visible, required, priority, distance } = candidate;
    const labelWidth = item.element.offsetWidth || 160;
    const labelHeight = item.element.offsetHeight || 48;
    const box = {
      left: x - labelWidth / 2 - 8,
      right: x + labelWidth / 2 + 8,
      top: y - labelHeight - 10,
      bottom: y + 8,
    };
    const overlaps = occupied.some((placed) => (
      box.left < placed.right
      && box.right > placed.left
      && box.top < placed.bottom
      && box.bottom > placed.top
    ));
    const canShow = visible
      && (required || priority >= minPriority)
      && (required || shown < maxLabels)
      && (!overlaps || required);

    item.element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
    item.element.style.opacity = canShow ? "1" : "0";
    item.element.style.pointerEvents = canShow ? "auto" : "none";
    item.element.style.zIndex = String(Math.max(1, Math.round(3000 - distance)));
    item.element.dataset.visible = canShow ? "true" : "false";
    if (canShow) {
      shown += 1;
      occupied.push(box);
    }
  }
}

function shortLabel(value: string) {
  return value.length > 48 ? `${value.slice(0, 45)}...` : value;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hashGraph(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let state = seed || 1;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return ((state >>> 0) / 4294967296);
  };
}
