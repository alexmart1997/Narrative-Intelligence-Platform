import * as THREE from "three";
import { ArticleGraphResponse, GraphEdge, GraphNode } from "@/lib/api";

export type GraphMode = "article" | "similar" | "entity" | "compare";

export type VisualFilters = {
  showEntities: boolean;
  showArticles: boolean;
  showSources: boolean;
  showNarratives: boolean;
  showWeakEdges: boolean;
  confidenceThreshold: number;
  labelDensity: number;
};

export type CameraMode = "free" | "top";

export type SceneNode = GraphNode & {
  position: THREE.Vector3;
  size: number;
  color: string;
  weight: number;
  confidence: number;
};

export type NodeMesh = THREE.Mesh & {
  userData: {
    graphNode: SceneNode;
    baseSize: number;
  };
};

export type SceneApi = {
  dispose: () => void;
  resetView: () => void;
  topDown: () => void;
};

export type GraphSceneOptions = {
  activeArticleId: number;
  autoOrbit: boolean;
  cameraMode: CameraMode;
  container: HTMLDivElement;
  filters: VisualFilters;
  focusMode: boolean;
  graph: ArticleGraphResponse;
  mode: GraphMode;
  onEdgeSelect: (edge: GraphEdge) => void;
  onNodeSelect: (node: GraphNode) => void;
  selectedNodeId: string | null;
};

export const entityNodeTypes = new Set(["person", "organization", "country", "location", "concept"]);
export const routeEdgeTypes = new Set(["same_event_as", "similar_to", "shares_narrative", "entity_in_article"]);
