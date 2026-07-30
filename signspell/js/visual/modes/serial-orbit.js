/**
 * serial // orbit — a rotating polyhedron in a field of data stars.
 *
 * See MODE_CONTRACT in ../visualizer.js for the frame object.
 */

const VERTICES = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

/** One receding galaxy shell. Its reset is invisible at both faded endpoints. */
export function orbitZoomCycle(beatTravel, offset = 0) {
  const phase = ((beatTravel / 8 + offset) % 1 + 1) % 1;
  return {
    phase,
    scale: 1.52 - phase * 1.18,
    alpha: Math.pow(Math.sin(Math.PI * phase), 0.7),
  };
}

export default class SerialOrbitScene {
  static id = "serial-orbit";
  static label = "serial // orbit";
  static post = { grain: 0.075, scanlines: 0.15, vignette: 0.5 };

  constructor(kit) {
    this.kit = kit;
    this.galaxyBeatTravel = 1.7;
    this.stars = Array.from({ length: 96 }, (_, index) => ({
      x: (((index * 67) % 193) / 193) * 2 - 1,
      y: (((index * 101) % 197) / 197) * 2 - 1,
      z: 0.4 + ((index * 43) % 157) / 24,
      size: 0.4 + (index % 4) * 0.28,
    }));
  }

  render(frame) {
    const { ctx, width, height, audio, kit, palette } = frame;
    const reduced = frame.reducedMotion;
    const energy = audio.energy;
    kit.fadeTo(ctx, width, height, palette.void, reduced ? 1 : 0.34);

    const focal = Math.min(width, height) * 1.05;
    const baseTime = reduced ? 0.6 : frame.time;
    const pulse = 1 + audio.bass * 0.2 + audio.pulse * 0.08;
    if (!reduced) this.galaxyBeatTravel += frame.dt * frame.bpm / 60;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // A slow field of data stars gives the polyhedron real depth without a
    // bitmap texture or a GPU dependency.
    for (const star of this.stars) {
      const travel = reduced ? star.z : ((star.z - baseTime * 0.42) % 6.5 + 6.5) % 6.5 + 0.3;
      const point = kit.project3D({ x: star.x * 2.2, y: star.y * 1.4, z: travel }, width, height, focal);
      if (!point) continue;
      const alpha = kit.clamp((1 - travel / 7) * (0.18 + audio.treble * 0.55), 0.03, 0.7);
      ctx.fillStyle = palette.bone(alpha);
      ctx.fillRect(point.x, point.y, star.size * point.scale * 0.016, star.size * point.scale * 0.016);
    }

    const projected = VERTICES.map(([x, y, z]) => {
      const rotated = kit.rotate3D(x * 0.58 * pulse, y * 0.58 * pulse, z * 0.58 * pulse,
        baseTime * 0.23, baseTime * 0.31, baseTime * 0.17 + audio.flux * 0.25);
      rotated.z += 2.45;
      return kit.project3D(rotated, width, height, focal);
    });
    for (let layer = 0; layer < 3; layer += 1) {
      ctx.strokeStyle = layer === 0
        ? palette.blood(0.2 + energy * 0.5)
        : layer === 1 ? palette.violet(0.18 + audio.mid * 0.5)
          : palette.wire(0.2 + audio.treble * 0.55);
      ctx.lineWidth = (3 - layer) * 0.8 * frame.ratio;
      ctx.beginPath();
      for (const [from, to] of EDGES) {
        const a = projected[from], b = projected[to];
        if (!a || !b) continue;
        const scale = 1 + layer * 0.08;
        ctx.moveTo(width * 0.5 + (a.x - width * 0.5) * scale, height * 0.5 + (a.y - height * 0.5) * scale);
        ctx.lineTo(width * 0.5 + (b.x - width * 0.5) * scale, height * 0.5 + (b.y - height * 0.5) * scale);
      }
      ctx.stroke();
    }

    // Two cross-faded galaxy shells continuously recede at one cycle per
    // eight beats. Only these ellipses zoom; the cube and data stars above use
    // their original coordinates and motion.
    for (let shell = 0; shell < 2; shell += 1) {
      const zoom = reduced ? { scale: 1, alpha: shell === 0 ? 1 : 0 } : orbitZoomCycle(this.galaxyBeatTravel, shell * 0.5);
      if (zoom.alpha < 0.015) continue;
      for (let orbit = 0; orbit < 7; orbit += 1) {
        const opacity = (0.08 + (orbit % 3) * 0.045 + energy * 0.24) * zoom.alpha;
        ctx.strokeStyle = `hsla(${105 + orbit * 25 + audio.treble * 45},90%,72%,${opacity})`;
        ctx.lineWidth = (orbit % 3 === 0 ? 1.4 : 0.75) * frame.ratio;
        ctx.beginPath();
        let started = false;
        for (let step = 0; step <= 72; step += 1) {
          const theta = step / 72 * Math.PI * 2;
          const radius = (0.72 + orbit * 0.105 + Math.sin(theta * 3 + baseTime) * audio.mid * 0.045) * zoom.scale;
          const tilted = kit.rotate3D(Math.cos(theta) * radius, Math.sin(theta) * radius * 0.48, 0,
            orbit * 0.38 + baseTime * (orbit % 2 ? -0.07 : 0.09), orbit * 0.29, baseTime * 0.06);
          tilted.z += 2.55;
          const point = kit.project3D(tilted, width, height, focal);
          if (!point) continue;
          if (!started) { ctx.moveTo(point.x, point.y); started = true; } else ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
      }
    }

    ctx.globalCompositeOperation = "source-over";
    kit.machineText(ctx, "SERIAL ORBIT / NO CARRIER / AUDIO BODY ONLINE", width * 0.04, height * 0.95, {
      size: Math.max(9, 12 * frame.ratio), color: palette.wire(0.3 + audio.flux * 0.45),
    });
    ctx.restore();
  }
}
