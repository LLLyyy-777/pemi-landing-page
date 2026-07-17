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
  console.log("Worker: initializeDetector started. modelUrl:", modelUrl, "runtimeUrl:", runtimeUrl, "trackingUtilsUrl:", trackingUtilsUrl);
  
  try {
    self.importScripts(trackingUtilsUrl, runtimeUrl);
    console.log("Worker: self.importScripts completed successfully.");
  } catch (err) {
    console.error("Worker: self.importScripts failed!", err);
    throw err;
  }

  if (!self.ort || !self.PemiPetTracking) {
    console.error("Worker: self.ort or self.PemiPetTracking check failed. self.ort exists:", !!self.ort, "self.PemiPetTracking exists:", !!self.PemiPetTracking);
    throw new Error("ONNX Runtime did not load.");
  }

  self.ort.env.wasm.wasmPaths = {
    mjs: `${wasmRoot}ort-wasm-simd-threaded.jsep.js`,
    wasm: `${wasmRoot}ort-wasm-simd-threaded.jsep.wasm`
  };
  self.ort.env.wasm.numThreads = 1;
  console.log("Worker: setup env.wasm.wasmPaths as:", JSON.stringify(self.ort.env.wasm.wasmPaths));

  try {
    console.log("Worker: Starting self.ort.InferenceSession.create with Model URL:", modelUrl);
    const createStart = performance.now();
    session = await self.ort.InferenceSession.create(modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all"
    });
    console.log(`Worker: InferenceSession loaded successfully in ${(performance.now() - createStart).toFixed(1)}ms.`);
  } catch (err) {
    console.error("Worker: InferenceSession.create threw error! This is usually because WebAssembly compile or memory settings failed in this browser environment.", err);
    throw err;
  }

  inputName = session.inputNames[0] || inputName;
  outputName = session.outputNames[0] || outputName;
  
  try {
    canvas = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE);
    context = canvas.getContext("2d", { willReadFrequently: true });
    console.log("Worker: OffscreenCanvas and 2D context prepared successfully.");
  } catch (err) {
    console.error("Worker: OffscreenCanvas or 2D context creation failed!", err);
    throw err;
  }

  if (!context) {
    throw new Error("The browser could not prepare the pet detector canvas.");
  }

  console.log("Worker: initializeDetector completed. Sending 'ready' message.");
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
    console.error("Worker: detectPet called but session or context is null.");
    throw new Error("Pet detector is not ready.");
  }

  const startTotal = performance.now();
  try {
    const prepared = prepareInput(frame);
    const startRun = performance.now();
    const outputs = await session.run({ [inputName]: prepared.input });
    const runDuration = performance.now() - startRun;

    const output = outputs[outputName] || outputs[session.outputNames[0]];

    if (!output) {
      throw new Error("The pet detector returned no results.");
    }

    const startFind = performance.now();
    const pet = findBestPet(output, confidenceThreshold, minimumAreaRatio, prepared.metrics);
    const findDuration = performance.now() - startFind;

    const totalDuration = performance.now() - startTotal;

    if (pet) {
      console.log(`Worker: Pet found! Label: "${pet.label}", Confidence: ${pet.confidence.toFixed(2)}, ratio: ${pet.areaRatio.toFixed(3)}. Infer: ${runDuration.toFixed(1)}ms, Find: ${findDuration.toFixed(1)}ms, Total: ${totalDuration.toFixed(1)}ms`);
    } else {
      console.log(`Worker: Inference complete (${runDuration.toFixed(1)}ms), but no cat/dog matched. Confidence filter: ${confidenceThreshold}`);
    }

    self.postMessage({
      type: "detection",
      requestId,
      pet: pet
    });
  } catch (err) {
    console.error("Worker: detectPet failed during frame processing or session run!", err);
    throw err;
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
