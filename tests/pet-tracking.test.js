import assert from "node:assert/strict";
import test from "node:test";

await import("../pet-tracking-utils.js");

const {
  calculateFrameCandidateScore,
  calculateLuminanceGradientSharpness,
  calculateResultFrameMinimumHeight,
  clampPointToFrame,
  getNextCameraFacingMode,
  getLetterboxMetrics,
  isLikelyPhoneDevice,
  mapNormalizedBoxToFrame,
  normalizeModelBox,
  shouldMirrorCamera
} = globalThis.PemiPetTracking;

function assertClose(actual, expected, epsilon = 0.000001) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} was not close to ${expected}`);
}

function assertBoxClose(actual, expected) {
  for (const key of Object.keys(expected)) {
    assertClose(actual[key], expected[key]);
  }
}

test("normalizes a model box after landscape letterboxing", () => {
  const metrics = getLetterboxMetrics(1280, 960, 640);
  const box = normalizeModelBox({ x1: 160, y1: 200, x2: 480, y2: 440 }, metrics);

  assert.deepEqual(metrics, {
    sourceWidth: 1280,
    sourceHeight: 960,
    modelSize: 640,
    drawWidth: 640,
    drawHeight: 480,
    offsetX: 0,
    offsetY: 80
  });
  assertBoxClose(box, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
});

test("normalizes a model box after portrait letterboxing", () => {
  const metrics = getLetterboxMetrics(720, 1280, 640);
  const box = normalizeModelBox({ x1: 230, y1: 160, x2: 410, y2: 480 }, metrics);

  assert.equal(metrics.offsetX, 140);
  assert.equal(metrics.offsetY, 0);
  assertBoxClose(box, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
});

test("maps a centered box through object-fit cover", () => {
  const box = mapNormalizedBoxToFrame(
    { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    1280,
    960,
    1600,
    900,
    true
  );

  assertBoxClose(box, { x: 400, y: 150, width: 800, height: 600 });
});

test("mirrors an off-center box into camera-preview coordinates", () => {
  const box = mapNormalizedBoxToFrame(
    { x: 0.1, y: 0.3, width: 0.2, height: 0.2 },
    1280,
    960,
    1600,
    900,
    true
  );

  assertBoxClose(box, { x: 1120, y: 210, width: 320, height: 240 });
});

test("keeps an off-center box unmirrored for a rear-camera preview", () => {
  const box = mapNormalizedBoxToFrame(
    { x: 0.1, y: 0.3, width: 0.2, height: 0.2 },
    1280,
    960,
    1600,
    900,
    false
  );

  assertBoxClose(box, { x: 160, y: 210, width: 320, height: 240 });
});

test("toggles camera direction and mirrors only the front camera", () => {
  assert.equal(getNextCameraFacingMode("user"), "environment");
  assert.equal(getNextCameraFacingMode("environment"), "user");
  assert.equal(shouldMirrorCamera("user"), true);
  assert.equal(shouldMirrorCamera("environment"), false);
});

test("identifies phones without treating tablets or desktop windows as phones", () => {
  assert.equal(isLikelyPhoneDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)"), true);
  assert.equal(isLikelyPhoneDevice("Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile"), true);
  assert.equal(isLikelyPhoneDevice("Mozilla/5.0 (iPad; CPU OS 18_0)"), false);
  assert.equal(isLikelyPhoneDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X)"), false);
  assert.equal(isLikelyPhoneDevice("desktop", true), true);
});

test("clips boxes at the visible edge of a mobile cover frame", () => {
  const box = mapNormalizedBoxToFrame(
    { x: 0, y: 0.2, width: 0.2, height: 0.4 },
    1280,
    960,
    400,
    315,
    true
  );

  assertBoxClose(box, { x: 326, y: 63, width: 74, height: 126 });
});

test("keeps orbit points inside the frame safety padding", () => {
  assert.deepEqual(clampPointToFrame({ x: -20, y: 300 }, 400, 240, 24), {
    x: 24,
    y: 216
  });
});

test("scores a detailed frame as sharper than a flat frame", () => {
  const width = 4;
  const height = 4;
  const flatPixels = new Uint8ClampedArray(width * height * 4);
  const detailedPixels = new Uint8ClampedArray(width * height * 4);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const detailedValue = (pixel + Math.floor(pixel / width)) % 2 === 0 ? 0 : 255;

    flatPixels.set([128, 128, 128, 255], offset);
    detailedPixels.set([detailedValue, detailedValue, detailedValue, 255], offset);
  }

  const flatScore = calculateLuminanceGradientSharpness(flatPixels, width, height);
  const detailedScore = calculateLuminanceGradientSharpness(detailedPixels, width, height);

  assert.equal(flatScore, 0);
  assert.ok(detailedScore > flatScore);
});

test("combines sharpness, confidence, and pet area for frame selection", () => {
  assertClose(calculateFrameCandidateScore(100, 0.8, 0.25), 40);

  const candidates = [
    { id: "soft", score: calculateFrameCandidateScore(70, 0.9, 0.3) },
    { id: "best", score: calculateFrameCandidateScore(120, 0.85, 0.35) },
    { id: "small", score: calculateFrameCandidateScore(140, 0.7, 0.08) }
  ];
  const selected = candidates.reduce((best, candidate) =>
    candidate.score > best.score ? candidate : best
  );

  assert.equal(selected.id, "best");
});

test("matches the camera frame height at desktop and mobile ratios", () => {
  assertClose(calculateResultFrameMinimumHeight(826, false), 464.625);
  assertClose(calculateResultFrameMinimumHeight(346, true), 272.475);
});
