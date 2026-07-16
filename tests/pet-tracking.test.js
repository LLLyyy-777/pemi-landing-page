import assert from "node:assert/strict";
import test from "node:test";

await import("../pet-tracking-utils.js");

const {
  clampPointToFrame,
  getLetterboxMetrics,
  mapNormalizedBoxToFrame,
  normalizeModelBox
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
