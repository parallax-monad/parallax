import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Language } from "@/lib/i18n";
import { pick } from "@/lib/i18n";

type HeroProgressRef = { current: number };
type MarkerBaseConfig = {
  label: string;
  color: string;
  size: number;
  phase: number;
  compact: readonly [number, number, number];
  dispersed: readonly [number, number, number];
};

type ProtocolMarkerConfig = MarkerBaseConfig & {
  role: "protocol";
  intro: readonly [number, number, number];
  introControl: readonly [number, number, number];
  planetSeed: number;
};

type SignalMarkerConfig = MarkerBaseConfig & {
  role: "signal";
};

type MarkerConfig = ProtocolMarkerConfig | SignalMarkerConfig;

type PlanetUniforms = {
  uTime: { value: number };
  uFocus: { value: number };
  uIntroEmphasis: { value: number };
  uPixelRatio: { value: number };
  uMotion: { value: number };
  uLayerOpacity: { value: number };
  uPointTexture: { value: THREE.Texture };
};

type ProtocolPlanet = {
  group: THREE.Group;
  shell: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  interior: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  halo: THREE.Sprite;
  satellites: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  uniforms: readonly [PlanetUniforms, PlanetUniforms];
  focus: number;
  focusTarget: number;
  screenDistance: number;
};

type MarkerBase = {
  group: THREE.Group;
  label: THREE.Sprite;
  labelTexture: THREE.CanvasTexture;
};

type ProtocolMarker = MarkerBase & {
  kind: "protocol";
  config: ProtocolMarkerConfig;
  planet: ProtocolPlanet;
};

type SignalMarker = MarkerBase & {
  kind: "signal";
  config: SignalMarkerConfig;
  core: THREE.Sprite;
  halo: THREE.Sprite;
};

type Marker = ProtocolMarker | SignalMarker;

const INTRO_END_PROGRESS = 0.22;
const PROTOCOL_SATELLITE_COUNT = 144;
const PROTOCOL_SHELL_COUNT = 768;
const PROTOCOL_INTERIOR_COUNT = 256;
const PROTOCOL_FOCUS_NEAR = 0.1;
const PROTOCOL_FOCUS_FAR = 0.46;
const PROTOCOL_FOCUS_SCALE = 0.22;
const PROTOCOL_FOCUS_Z_OFFSET = 6;

const MARKERS: MarkerConfig[] = [
  {
    label: "Kuru",
    color: "#54e7ae",
    role: "protocol",
    size: 8.4,
    phase: 0.2,
    intro: [-47, 9, 34],
    introControl: [-39, 27, 20],
    planetSeed: 0x4b555255,
    compact: [-21, 12, 5],
    dispersed: [-82, 30, 8],
  },
  {
    label: "PancakeSwap V2 / V3",
    color: "#b99aff",
    role: "protocol",
    size: 7.8,
    phase: 2.4,
    intro: [49, -8, -36],
    introControl: [39, -27, -17],
    planetSeed: 0x50414e43,
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
  uniform float uIntroEmphasis;
  uniform float uDisturbance;
  uniform float uPixelRatio;
  uniform float uMotion;
  attribute vec3 aDispersed;
  attribute vec3 aIntroPosition;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aPhase;
  attribute float aDepthLayer;
  attribute float aIntroSizeBoost;
  attribute float aIntroBrightness;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vCenterFade;
  varying float vNavigationMask;

  void main() {
    float expansion = smoothstep(0.0, 1.0, uExpansion);
    vec3 introPosition = mix(position, aIntroPosition, uIntroEmphasis);
    vec3 transformed = mix(introPosition, aDispersed, expansion);
    float drift = sin(uTime * 0.24 + aPhase * 7.0) * uMotion;
    float ripple = sin(uTime * 1.8 + aPhase * 19.0) * uDisturbance;
    float introDrift = sin(uTime * (0.12 + aPhase * 0.08) + aPhase * 23.0)
      * uMotion * uIntroEmphasis * mix(0.12, 0.42, aDepthLayer);
    transformed += vec3(
      drift * 0.42 + ripple * 1.8 + introDrift,
      cos(uTime * 0.19 + aPhase * 11.0) * uMotion * 0.34 + ripple + introDrift * 0.5,
      sin(uTime * 0.16 + aPhase * 5.0) * uMotion * 0.58 + ripple * 2.8
    );
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    float twinkle = 0.88 + 0.12 * sin(uTime * (0.75 + aPhase) + aPhase * 31.0) * uMotion;
    float introTwinkle = 1.0 + sin(uTime * (0.55 + aPhase * 1.5) + aPhase * 41.0)
      * uMotion * uIntroEmphasis * aIntroBrightness * 0.12;
    float introScale = mix(1.0, aIntroSizeBoost, uIntroEmphasis);
    gl_PointSize = clamp(
      aSize * introScale * uPixelRatio * (150.0 / -mvPosition.z) * twinkle * introTwinkle,
      0.75,
      mix(8.5, 9.5, uIntroEmphasis)
    );
    gl_Position = projectionMatrix * mvPosition;
    vColor = aColor * (1.0 + uIntroEmphasis * aIntroBrightness * 0.42);
    vAlpha = mix(0.42, 0.74, smoothstep(0.5, 3.4, aSize))
      + uIntroEmphasis * mix(0.08, 0.22, aIntroBrightness);
    float openedCenter = smoothstep(13.0, 43.0, length(transformed.xy));
    vCenterFade = mix(1.0, openedCenter, smoothstep(0.56, 0.86, uScrollProgress));
    float normalizedY = gl_Position.y / max(gl_Position.w, 0.0001);
    float topSafeArea = 1.0 - smoothstep(0.68, 0.98, normalizedY) * 0.62;
    vNavigationMask = mix(1.0, topSafeArea, uIntroEmphasis);
  }
`;

const FRAGMENT_SHADER = `
  uniform sampler2D uPointTexture;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vCenterFade;
  varying float vNavigationMask;

  void main() {
    vec4 point = texture2D(uPointTexture, gl_PointCoord);
    float alpha = point.a * vAlpha * vCenterFade * vNavigationMask;
    if (alpha < 0.012) discard;
    gl_FragColor = vec4(vColor * point.rgb, alpha);
  }
`;

const PLANET_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uFocus;
  uniform float uIntroEmphasis;
  uniform float uPixelRatio;
  uniform float uMotion;
  uniform float uLayerOpacity;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aPhase;
  attribute float aLayer;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vec3 localNormal = normalize(position);
    vec3 viewNormal = normalize(normalMatrix * localNormal);
    vec3 viewDirection = normalize(-mvPosition.xyz);
    float facing = abs(dot(viewNormal, viewDirection));
    float rim = pow(1.0 - facing, 2.0);
    float directional = max(
      dot(localNormal, normalize(vec3(0.35, 0.55, 0.76))),
      0.0
    );
    float twinkle = 1.0 + sin(uTime * (0.58 + aPhase) + aPhase * 29.0)
      * uMotion * mix(0.025, 0.075, aLayer);
    float focusScale = 1.0 + uFocus * 0.16;
    gl_PointSize = clamp(
      aSize * focusScale * uPixelRatio * (126.0 / -mvPosition.z) * twinkle,
      0.7,
      6.6
    );
    gl_Position = projectionMatrix * mvPosition;
    float surfaceLight = 0.7 + directional * 0.24 + rim * 0.2;
    float introLight = 1.0 + uIntroEmphasis * mix(0.05, 0.14, aLayer);
    vColor = aColor * surfaceLight * introLight * (1.0 + uFocus * 0.26);
    vAlpha = uLayerOpacity * mix(0.72, 1.0, aLayer)
      * (0.88 + rim * 0.12 + uFocus * 0.12);
  }
`;

const PLANET_FRAGMENT_SHADER = `
  uniform sampler2D uPointTexture;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 point = texture2D(uPointTexture, gl_PointCoord);
    float alpha = point.a * vAlpha;
    if (alpha < 0.015) discard;
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

function setQuadraticBezier3(
  target: THREE.Vector3,
  start: readonly [number, number, number],
  control: readonly [number, number, number],
  end: readonly [number, number, number],
  amount: number,
) {
  const inverse = 1 - amount;
  const startWeight = inverse * inverse;
  const controlWeight = 2 * inverse * amount;
  const endWeight = amount * amount;
  target.set(
    start[0] * startWeight + control[0] * controlWeight + end[0] * endWeight,
    start[1] * startWeight + control[1] * controlWeight + end[1] * endWeight,
    start[2] * startWeight + control[2] * controlWeight + end[2] * endWeight,
  );
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
  const introPositions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const depthLayers = new Float32Array(count);
  const introSizeBoosts = new Float32Array(count);
  const introBrightness = new Float32Array(count);
  const random = createSeededRandom(0x50415241);
  const introRandom = createSeededRandom(0x494e5452);

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

    const layerSelector = introRandom();
    let introX: number;
    let introY: number;
    let introZ: number;
    let depthLayer: number;
    if (layerSelector < 0.56) {
      // Distant micro-stars deliberately cover the complete camera frustum.
      const band = Math.floor(introRandom() * 3);
      introX = (introRandom() * 2 - 1) * (104 + introRandom() * 28);
      introY =
        (introRandom() * 2 - 1) * 66 +
        Math.sin(introX * 0.036 + band * 1.7) * (7 + band * 2) -
        introX * 0.075;
      introZ = -34 - introRandom() * 82;
      depthLayer = 0;
    } else if (layerSelector < 0.9) {
      // The midground forms an asymmetric diagonal protocol constellation.
      const diagonal = (introRandom() * 2 - 1) * 88;
      introX = diagonal + (introRandom() + introRandom() - 1) * 25 + 7;
      introY =
        diagonal * -0.28 +
        Math.sin(diagonal * 0.075) * 10 +
        (introRandom() + introRandom() + introRandom() - 1.5) * 24 -
        2;
      introZ = (introRandom() + introRandom() - 1) * 46;
      depthLayer = 0.5;
    } else {
      // Sparse near-camera stars provide edge parallax without becoming a veil.
      const edgeBias =
        introRandom() < 0.58 ? (introRandom() < 0.5 ? -1 : 1) : 0;
      introX =
        edgeBias === 0
          ? (introRandom() * 2 - 1) * 66
          : edgeBias * (44 + introRandom() * 34);
      introY = (introRandom() * 2 - 1) * 49 - introX * 0.1;
      introZ = 38 + introRandom() * 42;
      depthLayer = 1;
    }
    introPositions[offset] = introX;
    introPositions[offset + 1] = introY;
    introPositions[offset + 2] = introZ;

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
    depthLayers[index] = depthLayer;

    const hierarchy = introRandom();
    if (hierarchy < 0.76) {
      introSizeBoosts[index] =
        depthLayer === 1 ? 1.28 : 0.82 + introRandom() * 0.28;
      introBrightness[index] = 0.08 + introRandom() * 0.2;
    } else if (hierarchy < 0.965) {
      introSizeBoosts[index] = 1.12 + introRandom() * 0.42 + depthLayer * 0.18;
      introBrightness[index] = 0.34 + introRandom() * 0.24;
    } else if (hierarchy < 0.995) {
      introSizeBoosts[index] = 1.52 + introRandom() * 0.5;
      introBrightness[index] = 0.62 + introRandom() * 0.24;
    } else {
      introSizeBoosts[index] = 2.05 + introRandom() * 0.55;
      introBrightness[index] = 0.9 + introRandom() * 0.1;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(compact, 3));
  geometry.setAttribute("aDispersed", new THREE.BufferAttribute(dispersed, 3));
  geometry.setAttribute(
    "aIntroPosition",
    new THREE.BufferAttribute(introPositions, 3),
  );
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute(
    "aDepthLayer",
    new THREE.BufferAttribute(depthLayers, 1),
  );
  geometry.setAttribute(
    "aIntroSizeBoost",
    new THREE.BufferAttribute(introSizeBoosts, 1),
  );
  geometry.setAttribute(
    "aIntroBrightness",
    new THREE.BufferAttribute(introBrightness, 1),
  );
  const uniforms = {
    uTime: { value: 0 },
    uExpansion: { value: 0 },
    uScrollProgress: { value: 0 },
    uIntroEmphasis: { value: 1 },
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

function createPlanetGeometry({
  count,
  radius,
  shell,
  color,
  seed,
}: {
  count: number;
  radius: number;
  shell: boolean;
  color: string;
  seed: number;
}) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const layers = new Float32Array(count);
  const random = createSeededRandom(seed);
  const baseColor = new THREE.Color(color);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    let x: number;
    let y: number;
    let z: number;
    if (shell) {
      y = 1 - (2 * (index + 0.5)) / count;
      const radial = Math.sqrt(Math.max(0, 1 - y * y));
      const angle = goldenAngle * index + (random() - 0.5) * 0.045;
      x = Math.cos(angle) * radial;
      z = Math.sin(angle) * radial;
      const shellRadius = radius * (0.975 + random() * 0.05);
      x *= shellRadius;
      y *= shellRadius;
      z *= shellRadius;
    } else {
      const vertical = random() * 2 - 1;
      const angle = random() * Math.PI * 2;
      const radial = Math.sqrt(Math.max(0, 1 - vertical * vertical));
      const interiorRadius = Math.cbrt(random()) * radius * 0.82;
      x = Math.cos(angle) * radial * interiorRadius;
      y = vertical * interiorRadius;
      z = Math.sin(angle) * radial * interiorRadius;
    }
    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = z;

    const brightness = shell ? 0.78 + random() * 0.28 : 0.52 + random() * 0.3;
    colors[offset] = baseColor.r * brightness;
    colors[offset + 1] = baseColor.g * brightness;
    colors[offset + 2] = baseColor.b * brightness;
    sizes[index] = shell ? 0.78 + random() * 0.48 : 0.56 + random() * 0.38;
    phases[index] = random();
    layers[index] = shell ? 1 : 0;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute("aLayer", new THREE.BufferAttribute(layers, 1));
  return geometry;
}

function createPlanetMaterial(
  pointTexture: THREE.Texture,
  layerOpacity: number,
) {
  const uniforms: PlanetUniforms = {
    uTime: { value: 0 },
    uFocus: { value: 0 },
    uIntroEmphasis: { value: 1 },
    uPixelRatio: { value: 1 },
    uMotion: { value: 1 },
    uLayerOpacity: { value: layerOpacity },
    uPointTexture: { value: pointTexture },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: PLANET_VERTEX_SHADER,
    fragmentShader: PLANET_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  return { material, uniforms };
}

function createProtocolSatellites(
  config: ProtocolMarkerConfig,
  pointTexture: THREE.Texture,
) {
  const positions = new Float32Array(PROTOCOL_SATELLITE_COUNT * 3);
  const random = createSeededRandom(config.planetSeed ^ 0x53415445);
  for (let index = 0; index < PROTOCOL_SATELLITE_COUNT; index += 1) {
    const offset = index * 3;
    const angle = random() * Math.PI * 2;
    const isWideCloud = index >= PROTOCOL_SATELLITE_COUNT * 0.7;
    const radius = isWideCloud
      ? config.size * (1.7 + random() * 1.5)
      : config.size * (0.9 + random() * 1.15);
    positions[offset] = Math.cos(angle) * radius;
    positions[offset + 1] =
      Math.sin(angle) * radius * (isWideCloud ? 0.65 : 0.3) +
      (random() - 0.5) * config.size * 0.38;
    positions[offset + 2] =
      Math.sin(angle * 1.7) * config.size * 0.22 +
      (random() - 0.5) * config.size * 0.55;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    map: pointTexture,
    color: config.color,
    size: 0.82,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.rotation.x = config.phase * 0.12;
  points.rotation.z = -0.24 + config.phase * 0.03;
  return points;
}

function createProtocolPlanet(
  config: ProtocolMarkerConfig,
  pointTexture: THREE.Texture,
): ProtocolPlanet {
  const radius = config.size * 0.58;
  const shellGeometry = createPlanetGeometry({
    count: PROTOCOL_SHELL_COUNT,
    radius,
    shell: true,
    color: config.color,
    seed: config.planetSeed,
  });
  const interiorGeometry = createPlanetGeometry({
    count: PROTOCOL_INTERIOR_COUNT,
    radius,
    shell: false,
    color: config.color,
    seed: config.planetSeed ^ 0x494e5445,
  });
  const shellLayer = createPlanetMaterial(pointTexture, 0.92);
  const interiorLayer = createPlanetMaterial(pointTexture, 0.54);
  const shell = new THREE.Points(shellGeometry, shellLayer.material);
  const interior = new THREE.Points(interiorGeometry, interiorLayer.material);
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: pointTexture,
      color: config.color,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  halo.scale.set(config.size * 3.4, config.size * 3.4, 1);
  const satellites = createProtocolSatellites(config, pointTexture);
  const group = new THREE.Group();
  group.add(halo, interior, shell, satellites);
  return {
    group,
    shell,
    interior,
    halo,
    satellites,
    uniforms: [shellLayer.uniforms, interiorLayer.uniforms],
    focus: 0,
    focusTarget: 0,
    screenDistance: Number.POSITIVE_INFINITY,
  };
}

function createMarker(
  config: MarkerConfig,
  pointTexture: THREE.Texture,
): Marker {
  const group = new THREE.Group();
  const labelTexture = createLabelTexture(config);
  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: labelTexture,
      transparent: true,
      opacity: config.role === "protocol" ? 0.76 : 0.3,
      depthWrite: false,
    }),
  );
  label.scale.set(
    labelTexture.image.width / 7,
    labelTexture.image.height / 7,
    1,
  );
  label.position.set(0, config.size * 1.15, 0);
  if (config.role === "protocol") {
    const planet = createProtocolPlanet(config, pointTexture);
    group.add(planet.group, label);
    return {
      kind: "protocol",
      config,
      group,
      planet,
      label,
      labelTexture,
    };
  }

  const core = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: pointTexture,
      color: config.color,
      transparent: true,
      opacity: 0.64,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: pointTexture,
      color: config.color,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  core.scale.set(config.size, config.size, 1);
  halo.scale.set(config.size * 3.5, config.size * 3.5, 1);
  group.add(halo, core, label);
  return {
    kind: "signal",
    config,
    group,
    core,
    halo,
    label,
    labelTexture,
  };
}

function disposeMarker(marker: Marker) {
  if (marker.kind === "protocol") {
    marker.planet.shell.geometry.dispose();
    marker.planet.shell.material.dispose();
    marker.planet.interior.geometry.dispose();
    marker.planet.interior.material.dispose();
    (marker.planet.halo.material as THREE.SpriteMaterial).dispose();
    marker.planet.satellites.geometry.dispose();
    marker.planet.satellites.material.dispose();
  } else {
    (marker.core.material as THREE.SpriteMaterial).dispose();
    (marker.halo.material as THREE.SpriteMaterial).dispose();
  }
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
    const protocolMarkers = markers.filter(
      (marker): marker is ProtocolMarker => marker.kind === "protocol",
    );
    for (const marker of markers) constellation.add(marker.group);

    let frame = 0;
    let isVisible = true;
    let pointerTargetX = 0;
    let pointerTargetY = 0;
    let pointerTargetDistance = 0;
    let pointerX = 0;
    let pointerY = 0;
    let pointerDistance = 0;
    let focusPointerX = 0;
    let focusPointerY = 0;
    let hasPointer = false;
    let disturbance = 0;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let lastPointerAt = 0;
    const projectedPosition = new THREE.Vector3();

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      particleField.uniforms.uPixelRatio.value = pixelRatio;
      for (const marker of protocolMarkers) {
        for (const uniforms of marker.planet.uniforms) {
          uniforms.uPixelRatio.value = pixelRatio;
        }
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        hasPointer = false;
        return;
      }
      const bounds = container.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      ) {
        hasPointer = false;
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
      focusPointerX = normalizedX;
      focusPointerY = normalizedY;
      hasPointer = true;
    };

    const resetPointer = () => {
      pointerTargetX = 0;
      pointerTargetY = 0;
      pointerTargetDistance = 0;
      hasPointer = false;
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
      const rawProgress = clamp(progressRef.current, 0, 1);
      const introEmphasis = 1 - smoothstep(0, INTRO_END_PROGRESS, rawProgress);
      const scrollExpansion = smoothstep(0.18, 0.78, progress);
      const expansion = clamp(
        scrollExpansion + (pointerDistance - 0.28) * 0.075,
        0,
        1,
      );
      particleField.uniforms.uTime.value = time * 0.001;
      particleField.uniforms.uExpansion.value = expansion;
      particleField.uniforms.uScrollProgress.value = progress;
      particleField.uniforms.uIntroEmphasis.value = introEmphasis;
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

      const markerExpansion = smoothstep(0.12, 0.9, expansion);
      const introPathAmount = 1 - introEmphasis;
      for (const marker of markers) {
        const { config, group } = marker;
        if (marker.kind === "protocol" && introEmphasis > 0) {
          setQuadraticBezier3(
            group.position,
            marker.config.intro,
            marker.config.introControl,
            marker.config.compact,
            introPathAmount,
          );
          const introHorizontalScale =
            container.clientWidth < 640
              ? 0.48
              : container.clientWidth < 1100
                ? 0.76
                : 1;
          group.position.x = lerp(
            group.position.x,
            group.position.x * introHorizontalScale,
            introEmphasis,
          );
        } else {
          group.position.set(
            lerp(config.compact[0], config.dispersed[0], markerExpansion),
            lerp(config.compact[1], config.dispersed[1], markerExpansion),
            lerp(config.compact[2], config.dispersed[2], markerExpansion),
          );
        }

        if (marker.kind === "protocol") {
          if (!reduceMotion) {
            const depthResponse = clamp(
              (group.position.z + 45) / 90,
              0.55,
              1.2,
            );
            group.position.x += pointerX * (0.85 + depthResponse * 0.55);
            group.position.y += pointerY * (0.45 + depthResponse * 0.35);
          }
        } else {
          const breathe = reduceMotion
            ? 1
            : 1 + Math.sin(time * 0.00072 + config.phase) * 0.025;
          marker.core.scale.set(
            config.size * breathe,
            config.size * breathe,
            1,
          );
          marker.halo.scale.set(
            config.size * 3.5 * breathe,
            config.size * 3.5 * breathe,
            1,
          );
          (marker.label.material as THREE.SpriteMaterial).opacity =
            (0.3 - progress * 0.2) * (container.clientWidth < 640 ? 0 : 1);
        }
      }

      camera.updateMatrixWorld();
      scene.updateMatrixWorld(true);
      let nearestProtocol: ProtocolMarker | undefined;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const marker of protocolMarkers) {
        marker.group.getWorldPosition(projectedPosition);
        projectedPosition.project(camera);
        marker.planet.screenDistance = Math.hypot(
          projectedPosition.x - focusPointerX,
          projectedPosition.y - focusPointerY,
        );
        if (marker.planet.screenDistance < nearestDistance) {
          nearestProtocol = marker;
          nearestDistance = marker.planet.screenDistance;
        }
      }

      for (const marker of protocolMarkers) {
        const { config, group, planet } = marker;
        let focusTarget =
          hasPointer && !reduceMotion
            ? 1 -
              smoothstep(
                PROTOCOL_FOCUS_NEAR,
                PROTOCOL_FOCUS_FAR,
                planet.screenDistance,
              )
            : 0;
        if (
          nearestProtocol !== marker &&
          nearestDistance < PROTOCOL_FOCUS_FAR
        ) {
          focusTarget *= 0.36;
        }
        planet.focusTarget = focusTarget;
        planet.focus = reduceMotion
          ? 0
          : lerp(planet.focus, planet.focusTarget, 0.08);

        group.position.z += planet.focus * PROTOCOL_FOCUS_Z_OFFSET;
        const breathe = reduceMotion
          ? 1
          : 1 + Math.sin(time * 0.00056 + config.phase) * 0.025;
        const mobileScale = container.clientWidth < 640 ? 0.88 : 1;
        planet.group.scale.setScalar(
          mobileScale * breathe * (1 + planet.focus * PROTOCOL_FOCUS_SCALE),
        );
        planet.group.rotation.x =
          config.phase * 0.08 + (reduceMotion ? 0 : pointerY * 0.08);
        planet.group.rotation.y = reduceMotion
          ? config.phase * 0.14
          : time * 0.000085 + config.phase * 0.14 + pointerX * 0.14;
        planet.group.rotation.z = config.phase * 0.035;

        for (const uniforms of planet.uniforms) {
          uniforms.uTime.value = time * 0.001;
          uniforms.uFocus.value = planet.focus;
          uniforms.uIntroEmphasis.value = introEmphasis;
          uniforms.uMotion.value = reduceMotion ? 0 : 1;
        }
        planet.halo.scale.set(
          config.size * (3.35 + introEmphasis * 0.35 + planet.focus * 0.42),
          config.size * (3.35 + introEmphasis * 0.35 + planet.focus * 0.42),
          1,
        );
        (planet.halo.material as THREE.SpriteMaterial).opacity =
          0.15 + introEmphasis * 0.1 + planet.focus * 0.12;
        planet.satellites.rotation.y = reduceMotion
          ? config.phase * 0.08
          : time * (0.000055 + planet.focus * 0.000035) + config.phase * 0.08;
        planet.satellites.rotation.z =
          -0.24 + config.phase * 0.03 + (reduceMotion ? 0 : time * 0.000018);
        planet.satellites.material.opacity =
          0.08 + introEmphasis * 0.3 + planet.focus * 0.16;
        planet.satellites.material.size =
          0.72 + introEmphasis * 0.18 + planet.focus * 0.12;
        (marker.label.material as THREE.SpriteMaterial).opacity = Math.min(
          1,
          0.76 - progress * 0.22 + planet.focus * 0.24,
        );
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
