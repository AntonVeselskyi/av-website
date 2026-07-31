import { FeedbackWarp } from "./scene-kit.js?v=8";

const EXPECTED = [
  ["wired", "wired-tunnel"],
  ["fire", "spectral-fire"],
  ["cruciform", "cruciform-scope"],
  ["shrine", "warped-shrine"],
  ["orbit", "serial-orbit"],
  ["lava", "lava-lamp"],
  ["royale", "royale-fractal"],
];

const failures = [];
const warnings = [];
const checks = [];

function check(condition, message, details = null) {
  checks.push(message);
  if (!condition) failures.push({ message, details });
}

const frames = (count = 1) => new Promise((resolve) => {
  const next = () => {
    if (--count <= 0) resolve();
    else requestAnimationFrame(next);
  };
  requestAnimationFrame(next);
});

function fakeAnalyser(seed) {
  let tick = seed * 3;
  return {
    frequencyBinCount: 512,
    getByteFrequencyData(target) {
      tick += 1;
      const phase = tick % 18;
      const hit = phase < 3 ? 1 : phase < 7 ? 0.22 : 0.08;
      for (let index = 0; index < target.length; index += 1) {
        const u = index / Math.max(1, target.length - 1);
        const body = 20 + 18 * Math.sin(index * 0.071 + seed);
        const bass = u < 0.16 ? hit * 185 : 0;
        const mids = u >= 0.16 && u < 0.56 ? (0.28 + 0.72 * hit) * 105 : 0;
        const air = u >= 0.56 ? (0.18 + 0.82 * hit) * 82 : 0;
        target[index] = Math.max(0, Math.min(255, Math.round(body + bass + mids + air)));
      }
    },
    getByteTimeDomainData(target) {
      const amplitude = tick % 18 < 4 ? 76 : 42;
      for (let index = 0; index < target.length; index += 1) {
        target[index] = 128 + Math.round(Math.sin(index * 0.13 + tick * 0.19 + seed) * amplitude);
      }
    },
  };
}

function canvasSignature(canvas) {
  const sample = document.createElement("canvas");
  sample.width = 32;
  sample.height = 18;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
  const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
  const vector = new Float32Array(sample.width * sample.height * 3);
  const colors = new Set();
  let minimum = 255;
  let maximum = 0;
  let sum = 0;
  let square = 0;
  let lit = 0;
  let cursor = 0;
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    vector[cursor++] = r;
    vector[cursor++] = g;
    vector[cursor++] = b;
    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
    minimum = Math.min(minimum, luminance);
    maximum = Math.max(maximum, luminance);
    sum += luminance;
    square += luminance * luminance;
    if (luminance > 9) lit += 1;
    colors.add(`${r >> 5}:${g >> 5}:${b >> 5}`);
  }
  const count = sample.width * sample.height;
  const mean = sum / count;
  return {
    vector,
    colors: colors.size,
    range: maximum - minimum,
    variance: square / count - mean * mean,
    coverage: lit / count,
  };
}

function rms(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    const delta = left[index] - right[index];
    total += delta * delta;
  }
  return Math.sqrt(total / Math.max(1, left.length));
}

function finiteArray(values) {
  return values && [...values].every(Number.isFinite);
}

function smokeChecksum(scene) {
  const data = scene?.smokeImage?.data;
  if (!data) return -1;
  let hash = 2166136261;
  for (let index = 0; index < data.length; index += 97) hash = Math.imul(hash ^ data[index], 16777619) >>> 0;
  return hash;
}

function feedbackObjects(scene) {
  return ["feedback", "smokeFeedback", "phosphor"]
    .map((key) => scene?.[key])
    .filter((value) => value && typeof value.primed === "boolean");
}

async function run() {
  const lab = await window.visualLabReady;
  const { cells, visualizers, setMaximized, setReducedMotion } = lab;
  check(cells.length === 7, "visual lab exposes exactly seven cells", cells.length);
  check(visualizers.length === 7, "visual lab creates exactly seven visualizers", visualizers.length);

  visualizers.forEach((visualizer) => visualizer.setAnalyser(fakeAnalyser(1)));
  const startFrames = visualizers.map((visualizer) => visualizer.frameIndex);
  await frames(42);

  const signatures = [];
  for (let index = 0; index < EXPECTED.length; index += 1) {
    const [alias, canonical] = EXPECTED[index];
    const cell = cells[index];
    const visualizer = visualizers[index];
    const scene = visualizer.activeScene();
    const rect = cell.querySelector("canvas").getBoundingClientRect();
    const signature = canvasSignature(visualizer.canvas);
    signatures.push(signature);

    check(cell.dataset.mode === alias, `${alias}: cell alias is stable`, cell.dataset.mode);
    check(visualizer.mode === canonical, `${alias}: canonical mode resolves`, visualizer.mode);
    check(scene?.constructor?.id === canonical, `${alias}: active scene matches registry`, scene?.constructor?.id);
    check(visualizer.running, `${alias}: animation loop remains running`);
    check(visualizer.frameIndex - startFrames[index] >= 20, `${alias}: frame counter advances`, visualizer.frameIndex - startFrames[index]);
    check(rect.width > 80 && rect.height > 40, `${alias}: canvas has a useful CSS size`, [rect.width, rect.height]);
    check(Math.abs(visualizer.canvas.width - rect.width * visualizer.ratio) <= 3, `${alias}: backing width tracks CSS size`, [visualizer.canvas.width, rect.width, visualizer.ratio]);
    check(Math.abs(visualizer.canvas.height - rect.height * visualizer.ratio) <= 3, `${alias}: backing height tracks CSS size`, [visualizer.canvas.height, rect.height, visualizer.ratio]);
    check(Number.isFinite(visualizer.load) && Number.isFinite(visualizer.detail), `${alias}: adaptive render state is finite`);
    check(Object.values(visualizer.audio).filter((value) => typeof value === "number").every(Number.isFinite), `${alias}: audio state stays finite`);
    check(finiteArray(visualizer.bands) && finiteArray(visualizer.bandPeaks), `${alias}: analyser bands stay finite`);
    check(!visualizer.audio.silent, `${alias}: deterministic analyser produces a live signal`);
    check(visualizer.audio.beatCount > 0, `${alias}: deterministic onsets reach beat detection`, visualizer.audio.beatCount);
    check(signature.colors >= 4 && signature.range > 12 && signature.variance > 4 && signature.coverage > 0.01, `${alias}: scene paints nontrivial image data`, {
      colors: signature.colors,
      range: signature.range,
      variance: signature.variance,
      coverage: signature.coverage,
    });

    if (canonical === "wired-tunnel") check(scene.ringLive.some((value) => value > 0), "wired: live tunnel rings exist");
    if (canonical === "spectral-fire") check(scene.image?.data?.length > 0 && scene.heat.some((value) => value > 0), "fire: heat field and image are alive");
    if (canonical === "cruciform-scope") check(scene.plot?.w > 0 && scene.graticuleKey, "scope: graticule and plot are built");
    if (canonical === "warped-shrine") check(scene.piers.length >= 2 && scene.windows.length >= 2 && scene.smokeRendered, "shrine: architecture and smoke are built");
    if (canonical === "serial-orbit") check(scene.bodies.length === 4 && scene.auroraOk.some((value) => value > 0), "orbit: bodies and projected aurora are live");
    if (canonical === "lava-lamp") check(scene.blobs.length >= 10 && scene.field.width > 1 && scene.tonePattern, "lava: wax field and tone mask are built");
    if (canonical === "royale-fractal") check(scene.suits.length === 4 && scene.suitLayer.width > 1, "royale: suit geometry and layer are built");
  }

  let closestPair = Infinity;
  for (let left = 0; left < signatures.length; left += 1) {
    for (let right = left + 1; right < signatures.length; right += 1) {
      closestPair = Math.min(closestPair, rms(signatures[left].vector, signatures[right].vector));
    }
  }
  check(closestPair > 1.5, "all seven modes produce visibly distinct sampled frames", closestPair);

  // Feedback must discard an old aspect ratio instead of stretching it once.
  const source = document.createElement("canvas");
  source.width = 120;
  source.height = 60;
  const sourceCtx = source.getContext("2d");
  sourceCtx.fillStyle = "#fff";
  sourceCtx.fillRect(0, 0, source.width, source.height);
  const feedback = new FeedbackWarp({ scale: 0.5 });
  feedback.store({ ctx: sourceCtx, width: 120, height: 60 });
  const destination = document.createElement("canvas");
  destination.width = 240;
  destination.height = 150;
  feedback.warp({ ctx: destination.getContext("2d"), width: 240, height: 150 }, { background: "#000" });
  check(!feedback.primed && feedback.layer.width === 120 && feedback.layer.height === 75, "feedback invalidates stale dimensions before warping", {
    primed: feedback.primed,
    width: feedback.layer.width,
    height: feedback.layer.height,
  });
  feedback.release();

  for (let index = 0; index < EXPECTED.length; index += 1) {
    const [alias] = EXPECTED[index];
    const visualizer = visualizers[index];
    const before = [visualizer.canvas.width, visualizer.canvas.height, visualizer.frameIndex];
    setMaximized(alias, true);
    await frames(6);
    const rect = cells[index].getBoundingClientRect();
    check(rect.width >= innerWidth * 0.9 && rect.height >= innerHeight * 0.78, `${alias}: lab maximize covers the viewport`, [rect.width, rect.height, innerWidth, innerHeight]);
    check(visualizer.canvas.width > before[0] || visualizer.canvas.height > before[1], `${alias}: backing canvas grows while maximized`, [before, visualizer.canvas.width, visualizer.canvas.height]);
    check(visualizer.frameIndex > before[2], `${alias}: animation survives maximize`);
    const maximizedSignature = canvasSignature(visualizer.canvas);
    check(maximizedSignature.range > 12 && maximizedSignature.coverage > 0.01, `${alias}: maximized scene still paints`, {
      range: maximizedSignature.range,
      coverage: maximizedSignature.coverage,
    });
    setMaximized(alias, false);
    await frames(5);
    const restoredSignature = canvasSignature(visualizer.canvas);
    check(restoredSignature.range > 12 && restoredSignature.coverage > 0.01, `${alias}: restored scene repaints after being hidden`, {
      range: restoredSignature.range,
      coverage: restoredSignature.coverage,
    });
  }
  check(visualizers.every((visualizer) => visualizer.canvas.width > 80 && visualizer.canvas.height > 40), "all hidden canvases recover after maximize cycles");

  const shrine = visualizers[3].activeScene();
  const smokeBefore = smokeChecksum(shrine);
  const phasesBefore = visualizers.map((visualizer) => visualizer.phase);
  setReducedMotion(true);
  check(visualizers.flatMap((visualizer) => feedbackObjects(visualizer.activeScene())).every((item) => !item.primed), "reduced-motion transition clears temporal feedback");
  await frames(16);
  const reducedDeltas = visualizers.map((visualizer, index) => visualizer.phase - phasesBefore[index]);
  check(smokeChecksum(shrine) === smokeBefore, "reduced-motion Shrine freezes its fluid snapshot", [smokeBefore, smokeChecksum(shrine)]);
  check(visualizers.every((visualizer) => visualizer.running && Number.isFinite(visualizer.phase)), "reduced-motion frames remain live and finite");
  setReducedMotion(false);
  check(visualizers.flatMap((visualizer) => feedbackObjects(visualizer.activeScene())).every((item) => !item.primed), "leaving reduced motion cannot resurrect old trails");
  const animatedStart = visualizers.map((visualizer) => visualizer.phase);
  await frames(16);
  const animatedDeltas = visualizers.map((visualizer, index) => visualizer.phase - animatedStart[index]);
  check(reducedDeltas.every((delta, index) => delta < animatedDeltas[index] * 0.35), "reduced motion substantially slows every visualizer phase", { reducedDeltas, animatedDeltas });

  for (const issue of window.__visualLabIssues || []) {
    const externalFont = issue.type === "resource" && /fonts\.(googleapis|gstatic)\.com/.test(issue.resource);
    if (externalFont) warnings.push(issue);
    else failures.push({ message: `${issue.type}: ${issue.message}`, details: issue.resource || null });
  }

  return {
    status: failures.length ? "fail" : "pass",
    checks: checks.length,
    failures,
    warnings,
    modes: EXPECTED.map(([, canonical]) => canonical),
  };
}

let result;
try {
  result = await run();
} catch (error) {
  result = {
    status: "fail",
    checks: checks.length,
    failures: [...failures, { message: error?.message || String(error), details: error?.stack || null }],
    warnings,
  };
}

const output = document.createElement("pre");
output.id = "visual-smoke-result";
output.textContent = JSON.stringify(result);
document.body.append(output);
document.documentElement.dataset.visualSmoke = result.status;
window.__SIGN_SPELL_VISUAL_SMOKE__ = result;
