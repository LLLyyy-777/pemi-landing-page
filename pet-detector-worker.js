const MODEL_SIZE = 640;
const PET_CLASS_IDS = new Set([15, 16]);

let session = null;
let inputName = "images";
let outputName = "output0";
let canvas = null;
let context = null;

function postError(error, requestId) {
  self.postMessage({
    type: "error",
    ...(requestId === undefined ? {} : { requestId }),
    message: error?.message || "Pet detection could not start."
  });
}

async function initializeDetector({ modelUrl, runtimeUrl, trackingUtilsUrl, wasmRoot }) {
  self.importScripts(trackingUtilsUrl, runtimeUrl);

  if (!self.ort || !self.PemiPetTracking) {
    throw new Error("ONNX Runtime did not load.");
  }

  self.ort.env.wasm.wasmPaths = {
    mjs: `${wasmRoot}ort-wasm-simd-threaded.jsep.js`,
    wasm: `${wasmRoot}ort-wasm-simd-threaded.jsep.wasm`
  };
  self.ort.env.wasm.numThreads = 1;

  session = await self.ort.InferenceSession.create(modelUrl, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all"
  });

  inputName = session.inputNames[0] || inputName;
  outputName = session.outputNames[0] || outputName;
  canvas = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE);
  context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("The browser could not prepare the pet detector canvas.");
  }

  self.postMessage({ type: "ready" });
}

function prepareInput(frame) {
  const metrics = self.PemiPetTracking.getLetterboxMetrics(frame.width, frame.height, MODEL_SIZE);

  context.fillStyle = "rgb(114, 114, 114)";
  context.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE);
  context.drawImage(
    frame,
    metrics.offsetX,
    metrics.offsetY,
    metrics.drawWidth,
    metrics.drawHeight
  );

  const pixels = context.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
  const channelSize = MODEL_SIZE * MODEL_SIZE;
  const tensorData = new Float32Array(channelSize * 3);

  for (let pixelIndex = 0; pixelIndex < channelSize; pixelIndex += 1) {
    const sourceIndex = pixelIndex * 4;
    tensorData[pixelIndex] = pixels[sourceIndex] / 255;
    tensorData[channelSize + pixelIndex] = pixels[sourceIndex + 1] / 255;
    tensorData[channelSize * 2 + pixelIndex] = pixels[sourceIndex + 2] / 255;
  }

  return {
    input: new self.ort.Tensor("float32", tensorData, [1, 3, MODEL_SIZE, MODEL_SIZE]),
    metrics
  };
}

function findBestPet(output, confidenceThreshold, minimumAreaRatio, metrics) {
  const values = output.data;
  const rowSize = 6;
  let bestPet = null;

  for (let offset = 0; offset + rowSize <= values.length; offset += rowSize) {
    const confidence = values[offset + 4];
    const classId = Math.round(values[offset + 5]);

    if (!PET_CLASS_IDS.has(classId) || confidence < confidenceThreshold) {
      continue;
    }

    const width = Math.max(0, values[offset + 2] - values[offset]);
    const height = Math.max(0, values[offset + 3] - values[offset + 1]);
    const areaRatio = (width * height) / (MODEL_SIZE * MODEL_SIZE);

    if (areaRatio < minimumAreaRatio || (bestPet && confidence <= bestPet.confidence)) {
      continue;
    }

    bestPet = {
      classId,
      label: classId === 15 ? "cat" : "dog",
      confidence,
      areaRatio,
      box: self.PemiPetTracking.normalizeModelBox(
        {
          x1: values[offset],
          y1: values[offset + 1],
          x2: values[offset + 2],
          y2: values[offset + 3]
        },
        metrics
      )
    };
  }

  return bestPet;
}

async function detectPet({ frame, requestId, confidenceThreshold, minimumAreaRatio }) {
  if (!session || !context) {
    throw new Error("Pet detector is not ready.");
  }

  try {
    const prepared = prepareInput(frame);
    const outputs = await session.run({ [inputName]: prepared.input });
    const output = outputs[outputName] || outputs[session.outputNames[0]];

    if (!output) {
      throw new Error("The pet detector returned no results.");
    }

    self.postMessage({
      type: "detection",
      requestId,
      pet: findBestPet(output, confidenceThreshold, minimumAreaRatio, prepared.metrics)
    });
  } finally {
    frame.close();
  }
}

self.addEventListener("message", async (event) => {
  try {
    if (event.data?.type === "init") {
      await initializeDetector(event.data);
      return;
    }

    if (event.data?.type === "detect") {
      await detectPet(event.data);
    }
  } catch (error) {
    postError(error, event.data?.requestId);
  }
});
