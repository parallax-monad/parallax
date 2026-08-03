import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Language } from "@/lib/i18n";
import { pick } from "@/lib/i18n";

type HeroProgressRef = { current: number };
type MarkerConfig = {
  label: string;
  color: string;
  role: "protocol" | "signal";
  size: number;
  phase: number;
  compact: readonly [number, number, number];
  dispersed: readonly [number, number, number];
};
type Marker = {
  config: MarkerConfig;
  group: THREE.Group;
  core: THREE.Sprite;
  halo: THREE.Sprite;
  label: THREE.Sprite;
  labelTexture: THREE.CanvasTexture;
};

const MARKERS: MarkerConfig[] = [
  {
    label: "Kuru",
    color: "#54e7ae",
    role: "protocol",
    size: 8.4,
    phase: 0.2,
    compact: [-21, 12, 5],
    dispersed: [-82, 30, 8],
  },
  {
    label: "PancakeSwap V2 / V3",
    color: "#b99aff",
    role: "protocol",
    size: 7.8,
    phase: 2.4,
    compact: [22, -11, -7],
    dispersed: [88, -34, -4],
  },
  {
    label: "WMON",
    color: "#ccff00",
    role: "signal",
    size: 3.8,
    phase: 1.1,
    compact: [-9, 23, -2],
    dispersed: [-114, -39, -32],
  },
  {
    label: "ERC-20 / native MON",
    color: "#69d7ff",
    role: "signal",
    size: 3.4,
    phase: 3.3,
    compact: [13, 18, 3],
    dispersed: [116, 48, -42],
  },
  {
    label: "ERC-721",
    color: "#7e8cff",
    role: "signal",
    size: 3,
    phase: 4.4,
    compact: [-18, -15, -5],
    dispersed: [-122, 56, -64],
  },
  {
    label: "ERC-1155",
    color: "#b99aff",
    role: "signal",
    size: 3,
    phase: 5.2,
    compact: [14, -22, 7],
    dispersed: [118, -56, -58],
  },
];

const PALETTE = [
  new THREE.Color("#f7fbff"),
  new THREE.Color("#9ddfff"),
  new THREE.Color("#6c7dff"),
  new THREE.Color("#9b7cff"),
  new THREE.Color("#ccff00"),
];

const VERTEX_SHADER = `
  uniform float uTime;
  uniform float uExpansion;
  uniform float uScrollProgress;
  uniform float uDisturbance;
  uniform float uPixelRatio;
  uniform float uMotion;
  attribute vec3 aDispersed;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aPhase;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vCenterFade;

  void main() {
    float expansion = smoothstep(0.0, 1.0, uExpansion);
    vec3 transformed = mix(position, aDispersed, expansion);
    float drift = sin(uTime * 0.24 + aPhase * 7.0) * uMotion;
    float ripple = sin(uTime * 1.8 + aPhase * 19.0) * uDisturbance;
    transformed += vec3(
      drift * 0.42 + ripple * 1.8,
      cos(uTime * 0.19 + aPhase * 11.0) * uMotion * 0.34 + ripple,
      sin(uTime * 0.16 + aPhase * 5.0) * uMotion * 0.58 + ripple * 2.8
    );
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    float twinkle = 0.88 + 0.12 * sin(uTime * (0.75 + aPhase) + aPhase * 31.0) * uMotion;
    gl_PointSize = clamp(aSize * uPixelRatio * (150.0 / -mvPosition.z) * twinkle, 0.75, 8.5);
    gl_Position = projectionMatrix * mvPosition;
    vColor = aColor;
    vAlpha = mix(0.42, 0.74, smoothstep(0.5, 3.4, aSize));
    float openedCenter = smoothstep(13.0, 43.0, length(transformed.xy));
    vCenterFade = mix(1.0, openedCenter, smoothstep(0.56, 0.86, uScrollProgress));
  }
`;

const FRAGMENT_SHADER = `
  uniform sampler2D uPointTexture;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vCenterFade;

  void main() {
    vec4 point = texture2D(uPointTexture, gl_PointCoord);
    float alpha = point.a * vAlpha * vCenterFade;
    if (alpha < 0.012) discard;
    gl_FragColor = vec4(vColor * point.rgb, alpha);
  }
`;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createPointTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create point texture");
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.12, "rgba(255,255,255,0.98)");
  gradient.addColorStop(0.42, "rgba(255,255,255,0.34)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function particleCountFor(width: number) {
  if (width < 640) return 4000;
  if (width < 1100) return 7000;
  return 10000;
}

function createParticleField(count: number, pointTexture: THREE.Texture) {
  const compact = new Float32Array(count * 3);
  const dispersed = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const random = createSeededRandom(0x50415241);

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    const angle = random() * Math.PI * 2;
    const radius = random() ** 0.68 * 48;
    const branch = Math.floor(random() * 4);
    const depth = (random() + random() + random() - 1.5) * 31;
    const x =
      Math.cos(angle + (branch - 1.5) * 0.18) * radius * 1.08 + depth * 0.2 + 6;
    const y =
      Math.sin(angle * 1.35 + branch) * radius * 0.31 +
      (random() + random() - 1) * 13 -
      2;
    const z = depth + Math.sin(angle * 2.1) * radius * 0.24;
    compact[offset] = x;
    compact[offset + 1] = y;
    compact[offset + 2] = z;

    const spread = 1.9 + random() * 1.35;
    let dispersedX = x * spread + (random() - 0.5) * 74;
    let dispersedY = y * (2.2 + random()) + (random() - 0.5) * 55;
    const dispersedZ = z * (2.05 + random()) + (random() - 0.5) * 108;
    const centerDistance = Math.hypot(dispersedX, dispersedY);
    if (centerDistance < 42) {
      const xDirection =
        dispersedX === 0 ? (random() > 0.5 ? 1 : -1) : Math.sign(dispersedX);
      const yDirection = Math.sign(dispersedY || random() - 0.5);
      dispersedX +=
        xDirection * (42 - centerDistance) * (0.72 + random() * 0.42);
      dispersedY += yDirection * (42 - centerDistance) * 0.24;
    }
    dispersed[offset] = dispersedX;
    dispersed[offset + 1] = dispersedY;
    dispersed[offset + 2] = dispersedZ;

    const paletteIndex =
      random() > 0.965 ? 4 : random() > 0.76 ? 1 + Math.floor(random() * 3) : 0;
    const color = PALETTE[paletteIndex];
    const brightness = 0.58 + random() * 0.42;
    colors[offset] = color.r * brightness;
    colors[offset + 1] = color.g * brightness;
    colors[offset + 2] = color.b * brightness;
    sizes[index] = 0.72 + random() ** 4 * 3.7;
    phases[index] = random();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(compact, 3));
  geometry.setAttribute("aDispersed", new THREE.BufferAttribute(dispersed, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  const uniforms = {
    uTime: { value: 0 },
    uExpansion: { value: 0 },
    uScrollProgress: { value: 0 },
    uDisturbance: { value: 0 },
    uPixelRatio: { value: 1 },
    uMotion: { value: 1 },
    uPointTexture: { value: pointTexture },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { points, geometry, material, uniforms };
}

function createLabelTexture(config: MarkerConfig) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create marker label");
  const fontSize = config.role === "protocol" ? 28 : 23;
  const weight = config.role === "protocol" ? 700 : 600;
  context.font = `${weight} ${fontSize}px Inter, sans-serif`;
  canvas.width = Math.ceil(context.measureText(config.label).width) + 36;
  canvas.height = 52;
  context.font = `${weight} ${fontSize}px Inter, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = config.color;
  context.fillText(config.label, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createMarker(
  config: MarkerConfig,
  pointTexture: THREE.Texture,
): Marker {
  const group = new THREE.Group();
  const core = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: pointTexture,
      color: config.color,
      transparent: true,
      opacity: config.role === "protocol" ? 0.98 : 0.64,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: pointTexture,
      color: config.color,
      transparent: true,
      opacity: config.role === "protocol" ? 0.24 : 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  const labelTexture = createLabelTexture(config);
  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: labelTexture,
      transparent: true,
      opacity: config.role === "protocol" ? 0.76 : 0.3,
      depthWrite: false,
    }),
  );
  core.scale.set(config.size, config.size, 1);
  halo.scale.set(config.size * 3.5, config.size * 3.5, 1);
  label.scale.set(
    labelTexture.image.width / 7,
    labelTexture.image.height / 7,
    1,
  );
  label.position.set(0, config.size * 1.15, 0);
  group.add(halo, core, label);
  return { config, group, core, halo, label, labelTexture };
}

function disposeMarker(marker: Marker) {
  (marker.core.material as THREE.SpriteMaterial).dispose();
  (marker.halo.material as THREE.SpriteMaterial).dispose();
  (marker.label.material as THREE.SpriteMaterial).dispose();
  marker.labelTexture.dispose();
}

export function RouteGraph3D({
  language,
  progressRef,
}: {
  language: Language;
  progressRef: HeroProgressRef;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = motionQuery.matches;
    let renderer: THREE.WebGLRenderer;
    let pointTexture: THREE.CanvasTexture;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
      pointTexture = createPointTexture();
    } catch {
      container.dataset.webgl = "failed";
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x02030a, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.className = "block h-full w-full";
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x03040b, 0.0062);
    const camera = new THREE.PerspectiveCamera(54, 1, 0.1, 700);
    camera.position.set(0, 0, 132);
    const constellation = new THREE.Group();
    constellation.rotation.z = -0.055;
    scene.add(constellation);
    const particleField = createParticleField(
      particleCountFor(container.clientWidth || window.innerWidth),
      pointTexture,
    );
    constellation.add(particleField.points);
    const markers = MARKERS.map((config) => createMarker(config, pointTexture));
    for (const marker of markers) constellation.add(marker.group);

    let frame = 0;
    let isVisible = true;
    let pointerTargetX = 0;
    let pointerTargetY = 0;
    let pointerTargetDistance = 0;
    let pointerX = 0;
    let pointerY = 0;
    let pointerDistance = 0;
    let disturbance = 0;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let lastPointerAt = 0;

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      particleField.uniforms.uPixelRatio.value = pixelRatio;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const bounds = container.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      ) {
        return;
      }
      const normalizedX = clamp(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -1,
        1,
      );
      const normalizedY = clamp(
        -(((event.clientY - bounds.top) / bounds.height) * 2 - 1),
        -1,
        1,
      );
      const now = performance.now();
      if (lastPointerAt > 0) {
        const velocity =
          Math.hypot(
            event.clientX - lastPointerX,
            event.clientY - lastPointerY,
          ) / Math.max(now - lastPointerAt, 8);
        disturbance = Math.min(1, disturbance + velocity * 0.11);
      }
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      lastPointerAt = now;
      pointerTargetX = normalizedX;
      pointerTargetY = normalizedY;
      pointerTargetDistance = clamp(Math.hypot(normalizedX, normalizedY), 0, 1);
    };

    const resetPointer = () => {
      pointerTargetX = 0;
      pointerTargetY = 0;
      pointerTargetDistance = 0;
    };
    const requestRender = () => {
      if (frame === 0 && isVisible && !document.hidden) {
        frame = window.requestAnimationFrame(render);
      }
    };
    const render = (time: number) => {
      frame = 0;
      if (!isVisible || document.hidden) return;
      if (time - lastPointerAt > 900) {
        pointerTargetX *= 0.965;
        pointerTargetY *= 0.965;
        pointerTargetDistance *= 0.96;
      }
      pointerX += (pointerTargetX - pointerX) * 0.055;
      pointerY += (pointerTargetY - pointerY) * 0.055;
      pointerDistance += (pointerTargetDistance - pointerDistance) * 0.05;
      disturbance *= 0.945;

      const progress = reduceMotion
        ? Math.max(progressRef.current, 0.78)
        : clamp(progressRef.current, 0, 1);
      const scrollExpansion = smoothstep(0.18, 0.78, progress);
      const expansion = clamp(
        scrollExpansion + (pointerDistance - 0.28) * 0.075,
        0,
        1,
      );
      particleField.uniforms.uTime.value = time * 0.001;
      particleField.uniforms.uExpansion.value = expansion;
      particleField.uniforms.uScrollProgress.value = progress;
      particleField.uniforms.uDisturbance.value = reduceMotion
        ? 0
        : disturbance;
      particleField.uniforms.uMotion.value = reduceMotion ? 0 : 1;

      const ambientYaw = reduceMotion ? 0 : Math.sin(time * 0.000055) * 0.032;
      constellation.rotation.y = ambientYaw + pointerX * 0.155;
      constellation.rotation.x = -pointerY * 0.065;
      constellation.position.x = pointerX * 4.8;
      constellation.position.y = pointerY * 3.1;
      camera.position.x = pointerX * 2.6;
      camera.position.y = -pointerY * 1.9;
      camera.position.z = 132 - progress * 9;
      camera.rotation.x = pointerY * 0.022;
      camera.rotation.y = -pointerX * 0.018;

      for (const marker of markers) {
        const { config, group } = marker;
        const markerExpansion = smoothstep(0.12, 0.9, expansion);
        group.position.set(
          lerp(config.compact[0], config.dispersed[0], markerExpansion),
          lerp(config.compact[1], config.dispersed[1], markerExpansion),
          lerp(config.compact[2], config.dispersed[2], markerExpansion),
        );
        const breathe = reduceMotion
          ? 1
          : 1 +
            Math.sin(time * 0.00072 + config.phase) *
              (config.role === "protocol" ? 0.075 : 0.025);
        marker.core.scale.set(config.size * breathe, config.size * breathe, 1);
        marker.halo.scale.set(
          config.size * 3.5 * breathe,
          config.size * 3.5 * breathe,
          1,
        );
        (marker.label.material as THREE.SpriteMaterial).opacity =
          config.role === "protocol"
            ? 0.76 - progress * 0.22
            : (0.3 - progress * 0.2) * (container.clientWidth < 640 ? 0 : 1);
      }
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(render);
    };

    const resizeObserver = new ResizeObserver(() => {
      resize();
      requestRender();
    });
    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry?.isIntersecting ?? true;
        if (isVisible) requestRender();
        else if (frame !== 0) {
          window.cancelAnimationFrame(frame);
          frame = 0;
        }
      },
      { threshold: 0.01 },
    );
    const onVisibilityChange = () => requestRender();
    const onMotionChange = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
      requestRender();
    };
    resizeObserver.observe(container);
    intersectionObserver.observe(container);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("blur", resetPointer);
    document.documentElement.addEventListener("pointerleave", resetPointer);
    document.addEventListener("visibilitychange", onVisibilityChange);
    motionQuery.addEventListener("change", onMotionChange);
    resize();
    requestRender();

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("blur", resetPointer);
      document.documentElement.removeEventListener(
        "pointerleave",
        resetPointer,
      );
      document.removeEventListener("visibilitychange", onVisibilityChange);
      motionQuery.removeEventListener("change", onMotionChange);
      for (const marker of markers) disposeMarker(marker);
      particleField.geometry.dispose();
      particleField.material.dispose();
      pointTexture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [progressRef]);

  return (
    <div
      role="img"
      aria-label={pick(
        language,
        "Monad DeFi ecosystem visualization; drag to rotate",
        "Monad DeFi 生态系统可视化；可拖动旋转",
      )}
      className="absolute inset-0 overflow-hidden bg-[#02030a]"
    >
      <div
        aria-hidden="true"
        className="hero-webgl-fallback absolute inset-0"
      />
      <div ref={containerRef} className="absolute inset-0 z-[1]" />
    </div>
  );
}
