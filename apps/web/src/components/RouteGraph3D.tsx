import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Language } from "@/lib/i18n";
import { pick } from "@/lib/i18n";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";

type Graph3DNode = {
  id: string;
  label: string;
  color: string;
  x?: number;
  y?: number;
  z?: number;
};

type Graph3DLink = { source: string; target: string };

const NODES: Graph3DNode[] = [
  { id: "wmon", label: "WMON", color: "#ccff00" },
  { id: "erc20", label: "ERC-20 / native MON", color: "#69d7ff" },
  { id: "erc721", label: "ERC-721", color: "#ffbe55" },
  { id: "erc1155", label: "ERC-1155", color: "#b99aff" },
  { id: "kuru", label: "Kuru", color: "#54e7ae" },
  { id: "pancake", label: "PancakeSwap V2 / V3", color: "#ff7a94" },
];

const LINKS: Graph3DLink[] = [
  { source: "wmon", target: "erc20" },
  { source: "wmon", target: "erc721" },
  { source: "wmon", target: "pancake" },
  { source: "erc20", target: "erc721" },
  { source: "erc20", target: "erc1155" },
  { source: "erc721", target: "erc1155" },
  { source: "erc721", target: "kuru" },
  { source: "erc721", target: "pancake" },
  { source: "erc1155", target: "kuru" },
];

const LABEL_FONT = "700 30px Inter, sans-serif";

/** Renders the node label into a canvas texture so no extra font dependency is needed. */
function createLabelSprite(text: string, color: string) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.font = LABEL_FONT;
  const width = Math.ceil(context.measureText(text).width) + 24;
  const height = 44;
  canvas.width = width;
  canvas.height = height;

  context.font = LABEL_FONT;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = color;
  context.fillText(text, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(width / 5, height / 5, 1);
  sprite.position.set(0, 11, 0);
  return sprite;
}

/** Core sphere plus a larger additive shell that reads as a neon glow. */
function createNodeObject(node: Graph3DNode) {
  const color = new THREE.Color(node.color);
  const group = new THREE.Group();

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(4.2, 24, 24),
    new THREE.MeshBasicMaterial({ color }),
  );
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(7.4, 24, 24),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );

  group.add(glow);
  group.add(core);

  const label = createLabelSprite(node.label, node.color);
  if (label) group.add(label);

  return group;
}

export function RouteGraph3D() {
  const graphRef = useRef<ForceGraph3D<Graph3DNode, Graph3DLink> | undefined>(
    undefined,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [interacting, setInteracting] = useState(false);

  // d3-force mutates link source/target into node references, so both nodes and
  // links must be fresh copies or a remount would reuse stale node objects.
  const graphData = useMemo(
    () => ({
      nodes: NODES.map((node) => ({ ...node })),
      links: LINKS.map((link) => ({ ...link })),
    }),
    [],
  );

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.d3Force("charge")?.strength(-150);
    graph.d3Force("link")?.distance(90);
  }, []);

  useEffect(() => {
    if (size.width <= 1 || size.height <= 1) return;
    const timer = window.setTimeout(() => graphRef.current?.zoomToFit(600, 90), 400);
    return () => window.clearTimeout(timer);
  }, [size]);

  // Slow orbit that yields to the user as soon as they drag the scene.
  useEffect(() => {
    if (interacting) return;
    let frame = 0;
    const radius = 320;
    let angle = 0;

    const orbit = () => {
      const graph = graphRef.current;
      if (graph) {
        angle += 0.0016;
        graph.cameraPosition({
          x: radius * Math.sin(angle),
          y: 90 * Math.sin(angle * 0.6),
          z: radius * Math.cos(angle),
        });
      }
      frame = window.requestAnimationFrame(orbit);
    };

    frame = window.requestAnimationFrame(orbit);
    return () => window.cancelAnimationFrame(frame);
  }, [interacting]);

  return (
    <div
      aria-label="Moss 能力路徑 3D 圖，可拖動旋轉與縮放"
      className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(204,255,0,0.1),transparent_4px)]"
    >
      <div
        ref={containerRef}
        onPointerDown={() => setInteracting(true)}
        onWheel={() => setInteracting(true)}
        className="absolute bottom-0 right-0 top-0 z-[2] w-full cursor-grab active:cursor-grabbing sm:w-[56%]"
      >
        <ForceGraph3D
          ref={graphRef}
          width={size.width}
          height={size.height}
          graphData={graphData}
          backgroundColor="rgba(0,0,0,0)"
          showNavInfo={false}
          nodeThreeObject={createNodeObject}
          nodeLabel="label"
          linkColor={() => "rgba(190,190,190,0.35)"}
          linkOpacity={0.35}
          linkWidth={0.6}
          enableNodeDrag={false}
          warmupTicks={60}
          cooldownTicks={120}
        />
      </div>
      <div className="absolute bottom-4 left-4 z-[3] text-[8.5px] font-bold tracking-[0.08em] text-faint">
        <i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_#ccff00]" />
        MOSS CAPABILITY GRAPH · DRAG TO ROTATE
      </div>
    </div>
  );
}
