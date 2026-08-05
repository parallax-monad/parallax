import { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  type PlanetKind,
  sampleLogo,
  sampleLogoSphere,
} from "@/components/wallet/logoParticles";
import type { Verdict } from "@/lib/analyze/types";

const CAMERA_Z = 10;
const FOV = 60;
const STAR_COUNT = 1400;
const STAR_INNER = 16;
const STAR_OUTER = 55;
const BASE_RADIUS = 1.6;
const MINI_RADIUS = 0.42;
const BASE_POINT_SIZE = 0.06;
const MINI_POINT_SIZE = 0.026;
const MINI_POINT_COUNT = 2400;
const PLANET_START_X = 0.66;
const IDLE_SPIN = 0.0016;
/** Positive Y rotation carries the near face toward +X, so planets spin right. */
const OUTCOME_SPIN = 0.0042;
const BASE_GROW_MS = 620;
/** Starting scale of the grow-in, small enough to read as arriving from afar. */
const BASE_GROW_FROM = 0.12;
const EXPLOSION_DELAY_MS = 180;
const EXPLOSION_DURATION_MS = 650;

const OUTCOME_KIND: Record<Verdict, PlanetKind> = {
  PROCEED: "proceed",
  ADJUST: "adjust",
  STOP: "stop",
  UNKNOWN: "unknown",
};

const MINI_LAYOUT = [
  { x: -0.9, y: 0.63, z: 0.1, scale: 0.9 },
  { x: -0.72, y: 0.18, z: 0.05, scale: 1.08 },
  { x: -0.88, y: -0.48, z: -0.08, scale: 0.8 },
  { x: 0.82, y: 0.58, z: 0.04, scale: 1 },
  { x: 0.94, y: -0.02, z: -0.1, scale: 0.78 },
  { x: 0.7, y: -0.56, z: 0.12, scale: 1.1 },
];

type Anchor = { x: number; y: number; z: number; scale: number };
type Body = { anchor: Anchor; points: THREE.Points };
type BasePlanet = Body & { source: Float32Array; velocity: Float32Array };

const halfHeight = () => Math.tan((FOV / 2) * (Math.PI / 180)) * CAMERA_Z;
let dotTexture: THREE.Texture | undefined;

function dotSprite() {
  if (dotTexture) return dotTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "#fff");
  gradient.addColorStop(0.78, "#fff");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  dotTexture = new THREE.CanvasTexture(canvas);
  return dotTexture;
}

function buildPoints(
  kind: PlanetKind,
  radius: number,
  size: number,
  count?: number,
  front = false,
) {
  const cloud = front
    ? sampleLogoSphere(kind, radius, count ?? MINI_POINT_COUNT)
    : sampleLogo(kind, radius, count);
  if (!cloud) return undefined;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(cloud.positions, 3),
  );
  geometry.setAttribute("color", new THREE.BufferAttribute(cloud.colors, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      depthTest: false,
      depthWrite: false,
      map: dotSprite(),
      opacity: 0.94,
      size,
      sizeAttenuation: true,
      transparent: true,
      vertexColors: true,
    }),
  );
}

function buildStars() {
  const positions = new Float32Array(STAR_COUNT * 3);
  for (let index = 0; index < STAR_COUNT; index++) {
    const cosPhi = Math.random() * 2 - 1;
    const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
    const theta = Math.random() * Math.PI * 2;
    const radius = STAR_INNER + Math.random() * (STAR_OUTER - STAR_INNER);
    positions.set(
      [
        radius * sinPhi * Math.cos(theta),
        radius * cosPhi,
        radius * sinPhi * Math.sin(theta),
      ],
      index * 3,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xffffff,
      depthWrite: false,
      opacity: 0.7,
      size: 0.075,
      sizeAttenuation: true,
      transparent: true,
    }),
  );
}

function dispose(points: THREE.Points) {
  points.geometry.dispose();
  (points.material as THREE.Material).dispose();
}

function buildBase(kind: PlanetKind, anchor: Anchor): BasePlanet | undefined {
  const points = buildPoints(kind, BASE_RADIUS, BASE_POINT_SIZE);
  if (!points) return undefined;
  const source = new Float32Array(
    (points.geometry.getAttribute("position") as THREE.BufferAttribute)
      .array as Float32Array,
  );
  const velocity = new Float32Array(source.length);
  for (let index = 0; index < source.length; index += 3) {
    const length =
      Math.hypot(source[index], source[index + 1], source[index + 2]) || 1;
    const force = 0.04 + Math.random() * 0.09;
    velocity[index] = (source[index] / length) * force;
    velocity[index + 1] = (source[index + 1] / length) * force;
    velocity[index + 2] = (source[index + 2] / length) * force;
  }
  return { anchor, points, source, velocity };
}

export function WalletBackground({
  verdict,
  /**
   * Bumped every time the wallet returns home. Returning from the swap sheet
   * leaves `verdict` undefined either way, so without this the effect would not
   * re-run and the planets would never replay their entrance.
   */
  visitKey = 0,
}: {
  verdict?: Verdict;
  visitKey?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        canvas,
      });
    } catch {
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      FOV,
      window.innerWidth / window.innerHeight,
      0.1,
      200,
    );
    camera.position.z = CAMERA_Z;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);

    const stars = buildStars();
    scene.add(stars);
    const base = [
      buildBase("mon", { x: -PLANET_START_X, y: 0.3, z: 0, scale: 1 }),
      buildBase("usdc", { x: PLANET_START_X, y: -0.26, z: 0, scale: 1 }),
    ].filter((planet): planet is BasePlanet => planet !== undefined);
    for (const planet of base) {
      // Only the home entrance grows in. With a verdict these bodies explode
      // almost immediately, and starting them small would shrink that burst.
      planet.points.scale.setScalar(verdict ? 1 : BASE_GROW_FROM);
      scene.add(planet.points);
    }

    const outcomes: Body[] = [];
    let phase: "base" | "delay" | "explode" | "outcomes" = verdict
      ? "delay"
      : "base";
    let phaseStarted = performance.now();
    const baseBorn = performance.now();
    let outcomeBorn = 0;
    let baseDisposed = false;
    let dragging: Body | undefined;

    const layout = () => {
      const halfY = halfHeight();
      const halfX = halfY * camera.aspect;
      for (const body of [...base, ...outcomes]) {
        body.points.position.set(
          body.anchor.x * halfX,
          body.anchor.y * halfY,
          body.anchor.z,
        );
      }
    };

    const removeBase = () => {
      if (baseDisposed) return;
      baseDisposed = true;
      for (const planet of base) {
        scene.remove(planet.points);
        dispose(planet.points);
      }
    };

    const createOutcomes = () => {
      if (!verdict || outcomes.length > 0) return;
      for (const anchor of MINI_LAYOUT) {
        const points = buildPoints(
          OUTCOME_KIND[verdict],
          MINI_RADIUS,
          MINI_POINT_SIZE,
          MINI_POINT_COUNT,
          true,
        );
        if (!points) continue;
        // Spinning invalidates any fixed back-to-front point order, so these
        // bodies resolve their own depth instead. alphaTest drops the sprite's
        // soft edge, which would otherwise write depth and punch holes in the
        // dots drawn behind it.
        const material = points.material as THREE.PointsMaterial;
        material.alphaTest = 0.5;
        material.depthTest = true;
        material.depthWrite = true;
        // Staggered start angles only when the bodies actually spin. Without
        // motion a random angle could park the decal side-on and leave the
        // verdict unreadable, so the still case faces the camera.
        points.rotation.y = still ? 0 : Math.random() * Math.PI * 2;
        points.scale.setScalar(anchor.scale * 0.18);
        outcomes.push({ anchor: { ...anchor }, points });
        scene.add(points);
      }
      layout();
      outcomeBorn = performance.now();
      phase = "outcomes";
    };

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The grow-in seeds the base bodies at a small scale, so without motion they
    // have to be snapped to full size or they would stay tiny.
    if (still) {
      for (const planet of base) planet.points.scale.setScalar(1);
    }
    if (verdict && still) {
      removeBase();
      createOutcomes();
      for (const body of outcomes)
        body.points.scale.setScalar(body.anchor.scale);
    }

    const toWorld = (clientX: number, clientY: number) => {
      const halfY = halfHeight();
      const halfX = halfY * camera.aspect;
      return {
        x: ((clientX / window.innerWidth) * 2 - 1) * halfX,
        y: -((clientY / window.innerHeight) * 2 - 1) * halfY,
      };
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.target !== canvas) return;
      const point = toWorld(event.clientX, event.clientY);
      const bodies = phase === "outcomes" ? outcomes : base;
      dragging = bodies.reduce<Body | undefined>((closest, body) => {
        if (!closest) return body;
        const closestDistance =
          (closest.points.position.x - point.x) ** 2 +
          (closest.points.position.y - point.y) ** 2;
        const distance =
          (body.points.position.x - point.x) ** 2 +
          (body.points.position.y - point.y) ** 2;
        return distance < closestDistance ? body : closest;
      }, undefined);
      canvas.style.cursor = "grabbing";
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const point = toWorld(event.clientX, event.clientY);
      const halfY = halfHeight();
      const halfX = halfY * camera.aspect;
      dragging.anchor.x = point.x / halfX;
      dragging.anchor.y = point.y / halfY;
      dragging.points.position.set(point.x, point.y, dragging.anchor.z);
    };

    const onPointerUp = () => {
      dragging = undefined;
      canvas.style.cursor = "grab";
    };

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      layout();
    };

    const explode = (progress: number) => {
      for (const planet of base) {
        const attribute = planet.points.geometry.getAttribute(
          "position",
        ) as THREE.BufferAttribute;
        const positions = attribute.array as Float32Array;
        for (let index = 0; index < positions.length; index += 3) {
          positions[index] =
            planet.source[index] + planet.velocity[index] * progress * 24;
          positions[index + 1] =
            planet.source[index + 1] +
            planet.velocity[index + 1] * progress * 24;
          positions[index + 2] =
            planet.source[index + 2] +
            planet.velocity[index + 2] * progress * 24;
        }
        attribute.needsUpdate = true;
        (planet.points.material as THREE.PointsMaterial).opacity =
          0.94 * (1 - progress);
      }
    };

    canvas.style.cursor = "grab";
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("resize", onResize);
    layout();

    let frame = 0;
    const tick = (now: number) => {
      if (!still) {
        stars.rotation.y += 0.0002;
        if (phase === "delay" && now - phaseStarted >= EXPLOSION_DELAY_MS) {
          phase = "explode";
          phaseStarted = now;
        }
        if (phase === "explode") {
          const progress = Math.min(
            (now - phaseStarted) / EXPLOSION_DURATION_MS,
            1,
          );
          explode(progress);
          if (progress === 1) {
            removeBase();
            createOutcomes();
          }
        }
        if (phase === "base" || phase === "delay") {
          for (const planet of base) planet.points.rotation.y += IDLE_SPIN;
          if (!verdict) {
            const grown = Math.min((now - baseBorn) / BASE_GROW_MS, 1);
            const eased = 1 - (1 - grown) ** 3;
            for (const planet of base) {
              planet.points.scale.setScalar(
                BASE_GROW_FROM + eased * (1 - BASE_GROW_FROM),
              );
            }
          }
        }
        if (phase === "outcomes") {
          const progress = Math.min((now - outcomeBorn) / 300, 1);
          const eased = 1 - (1 - progress) ** 3;

          for (const body of outcomes) {
            body.points.rotation.y += OUTCOME_SPIN;
            body.points.scale.setScalar(
              body.anchor.scale * (0.18 + eased * 0.82),
            );
          }
        }
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("resize", onResize);
      dispose(stars);
      removeBase();
      for (const body of outcomes) dispose(body.points);
      renderer.dispose();
    };
  }, [verdict, visitKey]);

  return (
    <canvas
      aria-hidden="true"
      className="fixed inset-0 z-0 block h-full w-full"
      ref={canvasRef}
      tabIndex={-1}
    />
  );
}
