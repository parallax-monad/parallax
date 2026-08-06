/**
 * Turns the MON and USDC marks into particle spheres for the wallet background.
 *
 * The logos are drawn to an offscreen canvas with the same paths TokenIcon uses,
 * then read as an equirectangular texture. Nothing is fetched, so the background
 * stays offline capable and no third party learns which page a user opened.
 */
export type ParticleCloud = {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
};

export type PlanetKind =
  | "mon"
  | "usdc"
  | "proceed"
  | "adjust"
  | "stop"
  | "unknown";

/** Texture resolution. The logos are simple shapes, so this is plenty. */
const TEXTURE_SIZE = 128;

/** Particles per body. Fixed, so surface density does not depend on the art. */
const POINT_COUNT = 4000;

/** Below this a texel is background, and the body colour is used instead. */
const ALPHA_FLOOR = 24;

/**
 * Angular radius of the status decal. The mark is painted onto two opposite
 * caps on the equator rather than wrapped around the whole sphere, so a
 * spinning planet swings the mark past the camera head-on and undistorted, and
 * shows it twice per turn instead of once.
 */
const DECAL_CONE = (58 * Math.PI) / 180;
const DECAL_COS = Math.cos(DECAL_CONE);
const DECAL_SPAN = Math.sin(DECAL_CONE);

/** Fills the gaps where a mark does not cover its own square. */
const BASE_COLOR: Record<PlanetKind, [number, number, number]> = {
  mon: [0x6e / 255, 0x56 / 255, 0xf8 / 255],
  usdc: [0x27 / 255, 0x75 / 255, 0xca / 255],
  proceed: [0x22 / 255, 0xc5 / 255, 0x5e / 255],
  adjust: [0xea / 255, 0xb3 / 255, 0x08 / 255],
  stop: [0xef / 255, 0x44 / 255, 0x44 / 255],
  unknown: [0xf9 / 255, 0x73 / 255, 0x16 / 255],
};

function drawMon(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#6E56F8";
  ctx.fillRect(0, 0, 24, 24);

  ctx.save();
  ctx.translate(12, 12);
  ctx.rotate(Math.PI / 4);
  ctx.translate(-12, -12);
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.roundRect(5.75, 5.75, 12.5, 12.5, 4);
  ctx.stroke();
  ctx.restore();
}

function drawUsdc(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#2775CA";
  ctx.fillRect(0, 0, 24, 24);

  ctx.strokeStyle = "#FFFFFF";
  ctx.lineCap = "round";
  ctx.lineWidth = 1.7;
  ctx.stroke(
    new Path2D("M15.5 6.3a7 7 0 0 1 0 11.4M8.5 17.7a7 7 0 0 1 0-11.4"),
  );
  ctx.lineWidth = 1.5;
  ctx.stroke(new Path2D("M12 6.4v11.2"));
  ctx.stroke(
    new Path2D(
      "M13.9 9.6c-.3-.7-1-1.1-1.9-1.1-1.2 0-2 .6-2 1.6 0 .9.6 1.4 2 1.7 1.5.3 2.1.8 2.1 1.8 0 1.1-.9 1.8-2.1 1.8-1 0-1.8-.4-2.1-1.2",
    ),
  );
}

/**
 * Marks are drawn bare, with no ring or outline around them. The particle
 * sphere already supplies the silhouette, so an extra enclosing shape only
 * competed with it and shrank the mark at mini planet sizes.
 */
function drawProceed(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#22C55E";
  ctx.fillRect(0, 0, 24, 24);
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(5.6, 12.7);
  ctx.lineTo(10.2, 17.2);
  ctx.lineTo(18.6, 7.3);
  ctx.stroke();
}

function drawAdjust(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#EAB308";
  ctx.fillRect(0, 0, 24, 24);
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineCap = "round";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(3.6, 8.6);
  ctx.lineTo(12.4, 8.6);
  ctx.moveTo(17.4, 8.6);
  ctx.lineTo(20.4, 8.6);
  ctx.moveTo(3.6, 15.4);
  ctx.lineTo(8.6, 15.4);
  ctx.moveTo(13.6, 15.4);
  ctx.lineTo(20.4, 15.4);
  ctx.stroke();
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.arc(14.9, 8.6, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(11.1, 15.4, 2.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawStop(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#EF4444";
  ctx.fillRect(0, 0, 24, 24);
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(6.6, 6.6);
  ctx.lineTo(17.4, 17.4);
  ctx.moveTo(17.4, 6.6);
  ctx.lineTo(6.6, 17.4);
  ctx.stroke();
}

function drawUnknown(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#F97316";
  ctx.fillRect(0, 0, 24, 24);
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineCap = "round";
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(8, 8.4);
  ctx.bezierCurveTo(8.6, 4.4, 15.6, 4.6, 16, 8.8);
  ctx.bezierCurveTo(16.3, 12, 12, 12.8, 12, 15.6);
  ctx.stroke();
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.arc(12, 19.4, 1.7, 0, Math.PI * 2);
  ctx.fill();
}

const PAINTERS: Record<PlanetKind, (ctx: CanvasRenderingContext2D) => void> = {
  mon: drawMon,
  usdc: drawUsdc,
  proceed: drawProceed,
  adjust: drawAdjust,
  stop: drawStop,
  unknown: drawUnknown,
};

export function logoCanvas(kind: PlanetKind, size = TEXTURE_SIZE) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;

  ctx.scale(size / 24, size / 24);
  PAINTERS[kind](ctx);
  return canvas;
}

/**
 *
 * Points come from a Fibonacci spiral rather than a lat/long grid: the grid
 * clusters at the poles, which made the cloud read as an ellipse instead of a
 * ball. Every point is kept, so the silhouette stays a full circle even where
 * the mark itself is transparent.
 *
 * Returns undefined when a 2D context is unavailable, so the caller can fall
 * back to stars only rather than rendering an empty planet.
 */
export function sampleLogo(
  kind: PlanetKind,
  radius: number,
  pointCount = POINT_COUNT,
): ParticleCloud | undefined {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return undefined;

  ctx.scale(TEXTURE_SIZE / 24, TEXTURE_SIZE / 24);
  PAINTERS[kind](ctx);

  const { data } = ctx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  const positions = new Float32Array(pointCount * 3);
  const colors = new Float32Array(pointCount * 3);
  const base = BASE_COLOR[kind];

  // The golden angle spaces successive points so no latitude bunches up.
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let index = 0; index < pointCount; index++) {
    // Uniform in cos(phi), which is what keeps the density even on the surface.
    const cosPhi = 1 - (2 * (index + 0.5)) / pointCount;
    const sinPhi = Math.sqrt(Math.max(1 - cosPhi * cosPhi, 0));
    const theta = goldenAngle * index;

    positions[index * 3] = radius * sinPhi * Math.cos(theta);
    positions[index * 3 + 1] = radius * cosPhi;
    positions[index * 3 + 2] = radius * sinPhi * Math.sin(theta);

    // Equirectangular lookup: longitude across the texture, latitude down it.
    const u = (((theta / (Math.PI * 2)) % 1) + 1) % 1;
    const v = Math.acos(cosPhi) / Math.PI;
    const texel =
      (Math.min(Math.floor(v * TEXTURE_SIZE), TEXTURE_SIZE - 1) * TEXTURE_SIZE +
        Math.min(Math.floor(u * TEXTURE_SIZE), TEXTURE_SIZE - 1)) *
      4;

    if (data[texel + 3] < ALPHA_FLOOR) {
      colors[index * 3] = base[0];
      colors[index * 3 + 1] = base[1];
      colors[index * 3 + 2] = base[2];
    } else {
      colors[index * 3] = data[texel] / 255;
      colors[index * 3 + 1] = data[texel + 1] / 255;
      colors[index * 3 + 2] = data[texel + 2] / 255;
    }
  }

  return { positions, colors, count: pointCount };
}

/**
 * Samples a full particle sphere and stamps the status mark on it as a decal.
 *
 * Positions cover the whole ball, so the body has real depth and a spherical
 * silhouette. Both the shading and the decal placement are defined in the
 * planet's own space and depend only on latitude, so the body can spin about Y
 * without the mark distorting or the highlight travelling with it.
 */
export function sampleLogoSphere(
  kind: PlanetKind,
  radius: number,
  pointCount: number,
): ParticleCloud | undefined {
  const canvas = logoCanvas(kind);
  const ctx = canvas?.getContext("2d", { willReadFrequently: true });
  if (!canvas || !ctx) return undefined;

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const base = BASE_COLOR[kind];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  const positions = new Float32Array(pointCount * 3);
  const colors = new Float32Array(pointCount * 3);

  for (let index = 0; index < pointCount; index++) {
    const cosPhi = 1 - (2 * (index + 0.5)) / pointCount;
    const sinPhi = Math.sqrt(Math.max(1 - cosPhi * cosPhi, 0));
    const theta = goldenAngle * index;

    // Unit direction first, so the decal test is a plain dot product and does
    // not depend on the planet's radius.
    const dirX = sinPhi * Math.cos(theta);
    const dirY = cosPhi;
    const dirZ = sinPhi * Math.sin(theta);
    positions.set([radius * dirX, radius * dirY, radius * dirZ], index * 3);

    // Shading depends on latitude only, which is invariant under the spin about
    // the Y axis, so a rotating planet keeps a steady lit top instead of
    // dragging a baked highlight around with it.
    const light = 0.62 + 0.38 * ((dirY + 1) / 2);

    // Two decal caps sit on opposite ends of the equator. The far one is
    // mirrored in X so both read the right way round from outside the sphere.
    const onNear = dirZ >= DECAL_COS;
    const onFar = dirZ <= -DECAL_COS;

    if (!onNear && !onFar) {
      colors.set(
        [base[0] * light, base[1] * light, base[2] * light],
        index * 3,
      );
      continue;
    }

    const capX = (onNear ? dirX : -dirX) / DECAL_SPAN;
    const capY = dirY / DECAL_SPAN;
    const pixelX = Math.min(
      Math.max(Math.floor(((capX + 1) / 2) * canvas.width), 0),
      canvas.width - 1,
    );
    const pixelY = Math.min(
      Math.max(Math.floor(((1 - capY) / 2) * canvas.height), 0),
      canvas.height - 1,
    );
    const pixel = (pixelY * canvas.width + pixelX) * 4;
    colors.set(
      [
        (data[pixel] / 255) * light,
        (data[pixel + 1] / 255) * light,
        (data[pixel + 2] / 255) * light,
      ],
      index * 3,
    );
  }

  return { positions, colors, count: pointCount };
}
