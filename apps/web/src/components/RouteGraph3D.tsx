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
const PARTICLE_COUNT = 2800;
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
    size: 1.05,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  return { points, positions, velocities };
}

/** 2:1 canvas so equirectangular sampling wraps the mark once around a sphere. */
const LOGO_W = 512;
const LOGO_H = 256;

function createLogoCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = LOGO_W;
  canvas.height = LOGO_H;
  return canvas;
}

function drawMonadLogo() {
  const canvas = createLogoCanvas();
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#836ef9";
  context.fillRect(0, 0, LOGO_W, LOGO_H);

  const size = LOGO_H * 0.52;
  context.save();
  context.translate(LOGO_W / 2, LOGO_H / 2);
  context.rotate(Math.PI / 4);
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.roundRect(-size / 2, -size / 2, size, size, size * 0.3);
  context.fill();
  const inner = size * 0.52;
  context.fillStyle = "#836ef9";
  context.beginPath();
  context.roundRect(-inner / 2, -inner / 2, inner, inner, inner * 0.34);
  context.fill();
  context.restore();

  return canvas;
}

function drawUsdcLogo() {
  const canvas = createLogoCanvas();
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#2775ca";
  context.fillRect(0, 0, LOGO_W, LOGO_H);

  const cx = LOGO_W / 2;
  const cy = LOGO_H / 2;
  const radius = LOGO_H * 0.3;

  context.strokeStyle = "#ffffff";
  context.lineWidth = radius * 0.16;
  context.lineCap = "round";

  // Two arcs leaving gaps at top and bottom, as on the USDC mark.
  for (const offset of [0, Math.PI]) {
    context.beginPath();
    context.arc(cx, cy, radius, offset + 0.36, offset + Math.PI - 0.36);
    context.stroke();
  }

  context.fillStyle = "#ffffff";
  context.font = `700 ${Math.round(radius * 1.55)}px Inter, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("$", cx, cy);

  return canvas;
}

const PLANET_POINTS = 9000;

/**
 * Wraps a 2:1 logo canvas onto a sphere of points. Uses a Fibonacci spiral so
 * the samples stay evenly spaced instead of bunching at the poles, then reads
 * each point's colour from the canvas via equirectangular lookup.
 */
function createPlanet(canvas: HTMLCanvasElement, radius: number) {
  const context = canvas.getContext("2d");
  if (!context) return null;
  const pixels = context.getImageData(0, 0, LOGO_W, LOGO_H).data;

  const positions = new Float32Array(PLANET_POINTS * 3);
  const colors = new Float32Array(PLANET_POINTS * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < PLANET_POINTS; i++) {
    const y = 1 - (i / (PLANET_POINTS - 1)) * 2;
    const ring = Math.sqrt(Math.max(1 - y * y, 0));
    const theta = golden * i;
    const x = Math.cos(theta) * ring;
    const z = Math.sin(theta) * ring;

    positions[i * 3] = x * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = z * radius;

    const u = (Math.atan2(z, x) / (Math.PI * 2) + 0.5) % 1;
    const v = Math.acos(Math.min(Math.max(y, -1), 1)) / Math.PI;
    const px = Math.min(LOGO_W - 1, Math.floor(u * LOGO_W));
    const py = Math.min(LOGO_H - 1, Math.floor(v * LOGO_H));
    const at = (py * LOGO_W + px) * 4;

    colors[i * 3] = pixels[at] / 255;
    colors[i * 3 + 1] = pixels[at + 1] / 255;
    colors[i * 3 + 2] = pixels[at + 2] / 255;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 1.5,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    sizeAttenuation: true,
  });

  return new THREE.Points(geometry, material);
}

type Planet = { group: THREE.Group; points: THREE.Points; spin: number };

/** Flanks the graph so both marks stay readable without crowding the centre. */
const PLANET_LAYOUT = [
  {
    draw: drawMonadLogo,
    radius: 34,
    position: [-208, 74, -120],
    spin: 0.0022,
    tint: 0x836ef9,
  },
  {
    draw: drawUsdcLogo,
    radius: 28,
    position: [212, -66, -150],
    spin: -0.0018,
    tint: 0x2775ca,
  },
] as const;

function createPlanets() {
  const planets: Planet[] = [];

  for (const config of PLANET_LAYOUT) {
    const canvas = config.draw();
    if (!canvas) continue;
    const points = createPlanet(canvas, config.radius);
    if (!points) continue;

    const group = new THREE.Group();
    const [px, py, pz] = config.position;
    group.position.set(px, py, pz);
    // Tilt gives the sphere depth instead of reading as a flat disc.
    group.rotation.z = 0.32;
    group.add(points);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(config.radius * 1.16, 24, 24),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(config.tint),
        transparent: true,
        opacity: 0.05,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    group.add(halo);

    planets.push({ group, points, spin: config.spin });
  }

  return planets;
}

function disposePlanet(planet: Planet) {
  planet.points.geometry.dispose();
  (planet.points.material as THREE.PointsMaterial).dispose();
  for (const child of planet.group.children) {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  }
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

    const planets = createPlanets();
    for (const planet of planets) graph.scene().add(planet.group);

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
      for (const planet of planets) planet.group.rotation.y += planet.spin;
      animFrame = requestAnimationFrame(animate);
    };
    animFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animFrame);
      graph.scene().remove(points);
      for (const planet of planets) {
        graph.scene().remove(planet.group);
        disposePlanet(planet);
      }
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
