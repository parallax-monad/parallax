import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import * as THREE from "three";
import type { Language } from "@/lib/i18n";
import { pick } from "@/lib/i18n";

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
const PARTICLE_COUNT = 520;
/** Half-extents of the drifting particle field, wide enough to fill the frame. */
const PARTICLE_BOUND_XZ = 460;
const PARTICLE_BOUND_Y = 300;

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
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    }),
  );
  sprite.scale.set(width / 5, height / 5, 1);
  sprite.position.set(0, 11, 0);
  return sprite;
}

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

function createParticleSystem() {
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const velocities = new Float32Array(PARTICLE_COUNT * 3);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 2 * PARTICLE_BOUND_XZ;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 2 * PARTICLE_BOUND_Y;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 2 * PARTICLE_BOUND_XZ;
    velocities[i * 3] = (Math.random() - 0.5) * 0.08;
    velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.06;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.08;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xccff00,
    size: 1.4,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  return { points, positions, velocities };
}

export function RouteGraph3D({ language }: { language: Language }) {
  const graphRef = useRef<
    ForceGraphMethods<Graph3DNode, Graph3DLink> | undefined
  >(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [interacting, setInteracting] = useState(false);
  const resumeTimerRef = useRef<number | undefined>(undefined);
  const angleRef = useRef(0);

  const pauseOrbit = () => {
    window.clearTimeout(resumeTimerRef.current);
    setInteracting(true);
  };

  // Hand the camera back to the ambient orbit once the user settles.
  const scheduleResume = () => {
    window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(
      () => setInteracting(false),
      1500,
    );
  };

  useEffect(() => () => window.clearTimeout(resumeTimerRef.current), []);

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

    // 3d-force-graph uses TrackballControls by default (noZoom); OrbitControls
    // uses enableZoom. Set both so the wheel always scrolls the page instead.
    const controls = graph.controls() as {
      noZoom?: boolean;
      enableZoom?: boolean;
    } | null;
    if (controls) {
      controls.noZoom = true;
      controls.enableZoom = false;
    }

    const { points, positions, velocities } = createParticleSystem();
    graph.scene().add(points);

    let animFrame = 0;
    const animate = () => {
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        positions[i * 3] += velocities[i * 3];
        positions[i * 3 + 1] += velocities[i * 3 + 1];
        positions[i * 3 + 2] += velocities[i * 3 + 2];

        for (let axis = 0; axis < 3; axis++) {
          const limit = axis === 1 ? PARTICLE_BOUND_Y : PARTICLE_BOUND_XZ;
          if (Math.abs(positions[i * 3 + axis]) > limit) {
            velocities[i * 3 + axis] *= -1;
          }
        }
      }
      points.geometry.attributes.position.needsUpdate = true;
      animFrame = requestAnimationFrame(animate);
    };
    animFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animFrame);
      graph.scene().remove(points);
      points.geometry.dispose();
      (points.material as THREE.PointsMaterial).dispose();
    };
  }, []);

  useEffect(() => {
    if (size.width <= 1 || size.height <= 1) return;
    const timer = window.setTimeout(
      () => graphRef.current?.zoomToFit(600, 90),
      400,
    );
    return () => window.clearTimeout(timer);
  }, [size]);

  useEffect(() => {
    if (interacting) return;
    let frame = 0;
    const radius = 320;

    // Resume from where the user left the camera so the orbit does not snap.
    const camera = graphRef.current?.camera();
    if (camera)
      angleRef.current = Math.atan2(camera.position.x, camera.position.z);

    const orbit = () => {
      const graph = graphRef.current;
      if (graph) {
        angleRef.current += 0.0016;
        const angle = angleRef.current;
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
      role="img"
      aria-label={pick(
        language,
        "Monad DeFi ecosystem visualization; drag to rotate",
        "Monad DeFi 生态系统可视化；可拖动旋转",
      )}
      className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(204,255,0,0.1),transparent_4px)]"
    >
      <div
        ref={containerRef}
        onPointerDown={pauseOrbit}
        onPointerUp={scheduleResume}
        onPointerLeave={scheduleResume}
        onPointerCancel={scheduleResume}
        className="absolute inset-0 z-[1] w-full cursor-grab active:cursor-grabbing"
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
          enableNavigationControls={true}
          warmupTicks={60}
          cooldownTicks={120}
        />
      </div>
    </div>
  );
}
