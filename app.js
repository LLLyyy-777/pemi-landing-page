const camera = document.querySelector("#camera");
const canvas = document.querySelector("#snapshot");
const videoFrame = document.querySelector(".video-frame");
const emptyState = document.querySelector("#empty-state");
const petGuide = document.querySelector("#pet-guide");
const birdPlayground = document.querySelector("#bird-playground");
const birdElements = Array.from(document.querySelectorAll(".pet-bird"));
const detectionPrompt = document.querySelector("#detection-prompt");
const detectionPromptTitle = document.querySelector("#detection-prompt-title");
const detectionPromptCopy = document.querySelector("#detection-prompt-copy");
const waitingOverlay = document.querySelector("#waiting-overlay");
const waitingMessage = document.querySelector("#waiting-message");
const statusText = document.querySelector("#status-text");
const startButton = document.querySelector("#start-btn");
const retryButton = document.querySelector("#retry-btn");
const result = document.querySelector("#result");
const resultTitle = document.querySelector("#result-title");
const resultCopy = document.querySelector("#result-copy");
const cameraStage = document.querySelector(".camera-stage");
const posterTriggers = Array.from(document.querySelectorAll("[data-poster]"));
const posterDialog = document.querySelector("#poster-dialog");
const posterDialogImage = document.querySelector("#poster-dialog-image");
const posterDialogTitle = document.querySelector("#poster-dialog-title");
const posterCounter = document.querySelector("#poster-counter");
const posterCloseButton = document.querySelector("#poster-close");
const posterPreviousButton = document.querySelector("#poster-previous");
const posterNextButton = document.querySelector("#poster-next");
const petTracking = window.PemiPetTracking;

const RECORDING_SECONDS = 5;
const MIN_VIDEO_BYTES = 20 * 1024;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
const MODEL_SIZE = 640;
const PET_CLASS_IDS = new Set([15, 16]);
const DETECTION_INTERVAL_MS = 500;
const TRACKING_INTERVAL_MS = 800;
const DETECTION_CONFIDENCE = 0.55;
const MINIMUM_PET_AREA_RATIO = 0.04;
const DETECTION_WINDOW_SIZE = 4;
const REQUIRED_DETECTIONS = 3;
const BIRD_ARRIVAL_DELAY_MS = 620;
const PET_LOST_TIMEOUT_MS = 2000;
const ANALYSIS_WAITING_MESSAGES = [
  "Reading tiny signals...",
  "The birds are following every little clue...",
  "Turning posture and expression into pet-to-human..."
];
const BIRD_PERIODS_MS = [5200, 6100, 6900];
const BIRD_PHASES = [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6];

const STATES = {
  IDLE: "idle",
  REQUESTING_CAMERA: "requesting-camera",
  LOADING_MODEL: "loading-model",
  SEARCHING: "searching",
  RECORDING: "recording",
  ANALYZING: "analyzing",
  SUCCESS: "success",
  ERROR: "error"
};

let appState = STATES.IDLE;
let stream = null;
let detectorWorker = null;
let detectorReady = false;
let detectorFallback = false;
let detectorMode = null;
let mainDetectorSession = null;
let mainDetectorInitialization = null;
let onnxRuntimeLoading = null;
let detectionTimer = null;
let detectionInFlight = false;
let detectionRequestSequence = 0;
let activeDetectionRequestId = null;
let detectionHistory = [];
let currentVideoBlob = null;
let waitingMessageTimer = null;
let currentPosterIndex = 0;
let birdAnimationFrame = null;
let birdHideTimer = null;
let birdLastFrameTime = 0;
let birdLastSeenAt = 0;
let birdActive = false;
let birdLost = false;
let latestPetBox = null;
let birdTarget = null;
let birdPosition = null;
let reducedMotionQuery = null;

const posters = posterTriggers.reduce((items, trigger) => {
  if (!items.some((item) => item.src === trigger.dataset.poster)) {
    items.push({
      src: trigger.dataset.poster,
      title: trigger.dataset.title
    });
  }

  return items;
}, []);

function isBusy() {
  return appState === STATES.RECORDING || appState === STATES.ANALYZING;
}

function setStatus(message) {
  statusText.textContent = message;
}

function refreshControls() {
  const canRetry = [STATES.SUCCESS, STATES.ERROR].includes(appState);

  startButton.hidden = Boolean(stream) || appState === STATES.REQUESTING_CAMERA;
  startButton.disabled = appState === STATES.REQUESTING_CAMERA || isBusy();
  retryButton.hidden = !stream || !canRetry;
  retryButton.disabled = isBusy() || !stream || !canRetry;
}

function setAppState(nextState) {
  appState = nextState;
  cameraStage.dataset.state = nextState;
  cameraStage.classList.toggle("is-busy", isBusy());

  if (![STATES.SEARCHING, STATES.LOADING_MODEL].includes(nextState)) {
    detectionPrompt.hidden = true;
  }

  refreshControls();
}

function hideResult() {
  result.hidden = true;
  resultTitle.textContent = "Listening closely...";
  resultCopy.textContent = "";
}

function updateWaitingMessage(message) {
  waitingMessage.textContent = message;
}

function showWaitingOverlay(message = "The birds found your pet...") {
  window.clearInterval(waitingMessageTimer);
  waitingMessageTimer = null;
  updateWaitingMessage(message);
  waitingOverlay.hidden = false;
}

function showAnalysisWaitingMessages() {
  let messageIndex = 0;
  updateWaitingMessage(ANALYSIS_WAITING_MESSAGES[messageIndex]);
  window.clearInterval(waitingMessageTimer);
  waitingMessageTimer = window.setInterval(() => {
    messageIndex = (messageIndex + 1) % ANALYSIS_WAITING_MESSAGES.length;
    updateWaitingMessage(ANALYSIS_WAITING_MESSAGES[messageIndex]);
  }, 4800);
}

function hideWaitingOverlay() {
  waitingOverlay.hidden = true;
  window.clearInterval(waitingMessageTimer);
  waitingMessageTimer = null;
}

function getBirdSize() {
  return window.matchMedia("(max-width: 680px)").matches ? 28 : 34;
}

function refreshBirdTarget() {
  if (!latestPetBox || !camera.videoWidth || !camera.videoHeight) {
    return;
  }

  const frameWidth = videoFrame.clientWidth;
  const frameHeight = videoFrame.clientHeight;
  const mappedBox = petTracking.mapNormalizedBoxToFrame(
    latestPetBox,
    camera.videoWidth,
    camera.videoHeight,
    frameWidth,
    frameHeight,
    true
  );

  if (!mappedBox || !mappedBox.width || !mappedBox.height) {
    return;
  }

  const birdSize = getBirdSize();
  const maximumRadiusX = Math.max(36, frameWidth / 2 - birdSize);
  const maximumRadiusY = Math.max(30, frameHeight / 2 - birdSize);

  birdTarget = {
    x: mappedBox.x + mappedBox.width / 2,
    y: mappedBox.y + mappedBox.height / 2,
    radiusX: petTracking.clamp(
      Math.max(54, mappedBox.width * 0.6),
      54,
      Math.min(154, maximumRadiusX)
    ),
    radiusY: petTracking.clamp(
      Math.max(42, mappedBox.height * 0.56),
      42,
      Math.min(118, maximumRadiusY)
    ),
    frameWidth,
    frameHeight,
    birdSize
  };

  if (!birdPosition) {
    birdPosition = { ...birdTarget };
  }
}

function setBirdLost(isLost) {
  birdLost = isLost;
  birdPlayground.classList.toggle("is-lost", isLost);
}

function updateBirdTracking(pet) {
  if (pet?.box) {
    latestPetBox = pet.box;
    birdLastSeenAt = performance.now();
    setBirdLost(false);
    refreshBirdTarget();
    return;
  }

  if (birdActive && birdLastSeenAt && performance.now() - birdLastSeenAt >= PET_LOST_TIMEOUT_MS) {
    setBirdLost(true);
  }
}

function renderBirds(timestamp) {
  if (!birdActive || !birdTarget || !birdPosition) {
    birdAnimationFrame = null;
    return;
  }

  const elapsed = birdLastFrameTime ? Math.min(64, timestamp - birdLastFrameTime) : 16;
  const smoothing = 1 - Math.exp(-elapsed / 190);
  const targetKeys = ["x", "y", "radiusX", "radiusY", "frameWidth", "frameHeight", "birdSize"];

  for (const key of targetKeys) {
    birdPosition[key] += (birdTarget[key] - birdPosition[key]) * smoothing;
  }

  const reducedMotion = Boolean(reducedMotionQuery?.matches);
  const orbitScale = birdLost ? 0.5 : 1;
  const orbitSpeedScale = birdLost ? 1.5 : 1;
  const padding = birdPosition.birdSize / 2 + 7;

  birdElements.forEach((bird, index) => {
    const angle = reducedMotion
      ? BIRD_PHASES[index]
      : (timestamp / (BIRD_PERIODS_MS[index] * orbitSpeedScale)) * Math.PI * 2 +
        BIRD_PHASES[index];
    const point = petTracking.clampPointToFrame(
      {
        x: birdPosition.x + Math.cos(angle) * birdPosition.radiusX * orbitScale,
        y: birdPosition.y + Math.sin(angle) * birdPosition.radiusY * orbitScale
      },
      birdPosition.frameWidth,
      birdPosition.frameHeight,
      padding
    );

    bird.style.transform = `translate3d(${point.x - birdPosition.birdSize / 2}px, ${point.y - birdPosition.birdSize / 2}px, 0)`;
    bird.classList.toggle("faces-left", !reducedMotion && Math.sin(angle) > 0);
  });

  birdLastFrameTime = timestamp;
  birdAnimationFrame = window.requestAnimationFrame(renderBirds);
}

function activateBirdPlayground() {
  if (!birdTarget) {
    return;
  }

  window.clearTimeout(birdHideTimer);
  birdHideTimer = null;
  birdActive = true;
  birdPlayground.hidden = false;
  birdPlayground.classList.remove("is-leaving");
  window.requestAnimationFrame(() => birdPlayground.classList.add("is-active"));

  if (!birdAnimationFrame) {
    birdLastFrameTime = 0;
    birdAnimationFrame = window.requestAnimationFrame(renderBirds);
  }
}

function deactivateBirdPlayground({ immediate = false } = {}) {
  birdActive = false;
  window.clearTimeout(birdHideTimer);
  birdPlayground.classList.remove("is-active", "is-lost");
  birdPlayground.classList.toggle("is-leaving", !immediate);

  const finish = () => {
    if (birdActive) {
      return;
    }

    if (birdAnimationFrame) {
      window.cancelAnimationFrame(birdAnimationFrame);
    }

    birdAnimationFrame = null;
    birdHideTimer = null;
    birdLastFrameTime = 0;
    birdLastSeenAt = 0;
    birdLost = false;
    latestPetBox = null;
    birdTarget = null;
    birdPosition = null;
    birdPlayground.hidden = true;
    birdPlayground.classList.remove("is-leaving");
    birdElements.forEach((bird) => {
      bird.style.transform = "";
      bird.classList.remove("faces-left");
    });
  };

  if (immediate) {
    finish();
    return;
  }

  birdHideTimer = window.setTimeout(finish, 320);
}

function resetDetectionHistory() {
  detectionHistory = [];
  petGuide.classList.remove("has-pet");
}

function showDetectionPrompt(foundPet = false) {
  detectionPromptTitle.textContent = foundPet ? "Pet spotted - hold still" : "No pet spotted yet";
  detectionPromptCopy.textContent = foundPet
    ? "Pemi is making sure that little face is ready."
    : "Bring your pet into the camera so Pemi can find them.";
  detectionPrompt.hidden = false;
}

function stopDetectionLoop() {
  window.clearTimeout(detectionTimer);
  detectionTimer = null;
  detectionInFlight = false;
  activeDetectionRequestId = null;
}

function isPetTrackingState() {
  return [STATES.SEARCHING, STATES.RECORDING, STATES.ANALYZING].includes(appState);
}

function scheduleDetection(delay) {
  window.clearTimeout(detectionTimer);

  if (!detectorReady || !stream || document.hidden || !isPetTrackingState()) {
    return;
  }

  const nextDelay = delay ?? (appState === STATES.SEARCHING ? DETECTION_INTERVAL_MS : TRACKING_INTERVAL_MS);
  detectionTimer = window.setTimeout(captureDetectionFrame, nextDelay);
}

async function createCameraFrame() {
  try {
    return await window.createImageBitmap(camera);
  } catch (error) {
    const width = camera.videoWidth;
    const height = camera.videoHeight;

    if (!width || !height) {
      throw error;
    }

    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(camera, 0, 0, width, height);
    return window.createImageBitmap(canvas);
  }
}

async function captureDetectionFrame() {
  if (
    detectionInFlight ||
    document.hidden ||
    !stream ||
    camera.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    scheduleDetection();
    return;
  }

  detectionInFlight = true;
  const requestId = ++detectionRequestSequence;
  activeDetectionRequestId = requestId;

  try {
    if (detectorMode === "main") {
      const pet = await detectPetOnMainThread();
      handleDetection(pet, requestId);
      return;
    }

    if (!detectorWorker) {
      throw new Error("Pet detector worker is unavailable.");
    }

    const frame = await createCameraFrame();
    detectorWorker.postMessage(
      {
        type: "detect",
        requestId,
        frame,
        confidenceThreshold: DETECTION_CONFIDENCE,
        minimumAreaRatio: MINIMUM_PET_AREA_RATIO
      },
      [frame]
    );
  } catch (error) {
    if (activeDetectionRequestId !== requestId) {
      return;
    }

    detectionInFlight = false;
    activeDetectionRequestId = null;
    handleDetectorFailure(error);
  }
}

function loadOnnxRuntime() {
  if (window.ort) {
    return Promise.resolve(window.ort);
  }

  if (onnxRuntimeLoading) {
    return onnxRuntimeLoading;
  }

  onnxRuntimeLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/ort.min.js";
    script.addEventListener("load", () => resolve(window.ort));
    script.addEventListener("error", () => reject(new Error("ONNX Runtime did not load.")));
    document.head.append(script);
  });

  return onnxRuntimeLoading;
}

function prepareMainThreadInput(ort) {
  const width = camera.videoWidth;
  const height = camera.videoHeight;

  if (!width || !height) {
    throw new Error("The camera frame is not ready.");
  }

  const metrics = petTracking.getLetterboxMetrics(width, height, MODEL_SIZE);
  canvas.width = MODEL_SIZE;
  canvas.height = MODEL_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "rgb(114, 114, 114)";
  context.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE);
  context.drawImage(
    camera,
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
    input: new ort.Tensor("float32", tensorData, [1, 3, MODEL_SIZE, MODEL_SIZE]),
    metrics
  };
}

function findBestPet(output, metrics) {
  const values = output.data;
  let bestPet = null;

  for (let offset = 0; offset + 6 <= values.length; offset += 6) {
    const confidence = values[offset + 4];
    const classId = Math.round(values[offset + 5]);

    if (!PET_CLASS_IDS.has(classId) || confidence < DETECTION_CONFIDENCE) {
      continue;
    }

    const width = Math.max(0, values[offset + 2] - values[offset]);
    const height = Math.max(0, values[offset + 3] - values[offset + 1]);
    const areaRatio = (width * height) / (MODEL_SIZE * MODEL_SIZE);

    if (areaRatio < MINIMUM_PET_AREA_RATIO || (bestPet && confidence <= bestPet.confidence)) {
      continue;
    }

    bestPet = {
      classId,
      label: classId === 15 ? "cat" : "dog",
      confidence,
      areaRatio,
      box: petTracking.normalizeModelBox(
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

async function detectPetOnMainThread() {
  if (!mainDetectorSession || !window.ort) {
    throw new Error("Main pet detector is not ready.");
  }

  const prepared = prepareMainThreadInput(window.ort);
  const inputName = mainDetectorSession.inputNames[0];
  const outputName = mainDetectorSession.outputNames[0];
  const outputs = await mainDetectorSession.run({ [inputName]: prepared.input });
  return findBestPet(outputs[outputName], prepared.metrics);
}

function handleDetection(pet, requestId) {
  if (requestId !== activeDetectionRequestId) {
    return;
  }

  detectionInFlight = false;
  activeDetectionRequestId = null;

  if (!isPetTrackingState()) {
    return;
  }

  updateBirdTracking(pet);

  if (appState !== STATES.SEARCHING) {
    scheduleDetection();
    return;
  }

  const foundPet = Boolean(pet);
  detectionHistory.push(foundPet);
  detectionHistory = detectionHistory.slice(-DETECTION_WINDOW_SIZE);
  petGuide.classList.toggle("has-pet", foundPet);
  showDetectionPrompt(foundPet);

  const stableDetection =
    detectionHistory.length === DETECTION_WINDOW_SIZE &&
    detectionHistory.filter(Boolean).length >= REQUIRED_DETECTIONS;

  if (stableDetection) {
    detectionPrompt.hidden = true;
    activateBirdPlayground();
    runNewAnalysis();
    return;
  }

  if (foundPet) {
    setStatus("Pemi sees a pet! Keep that little face comfortably in frame...");
  } else {
    setStatus("Bring your pet into the camera so Pemi can find them.");
  }

  scheduleDetection();
}

function failPetDetector(error) {
  console.error("Pet detector failed completely:", error);
  detectorFallback = true;
  detectorReady = false;
  detectorMode = null;
  mainDetectorSession = null;
  mainDetectorInitialization = null;
  stopDetectionLoop();
  resetDetectionHistory();
  petGuide.hidden = true;
  detectionPrompt.hidden = true;

  if (stream && !isBusy()) {
    setAppState(STATES.ERROR);
    setStatus("Pemi's pet finder could not start. Tap Try It Again to reload it.");
  } else {
    refreshControls();
  }
}

async function initializeMainThreadDetector(workerError) {
  if (mainDetectorInitialization) {
    return mainDetectorInitialization;
  }

  console.warn("Worker pet detector unavailable; switching to browser fallback.", workerError);
  detectorReady = false;
  detectorFallback = false;
  detectorMode = "main-loading";

  if (stream && !isBusy()) {
    setAppState(STATES.LOADING_MODEL);
    petGuide.hidden = false;
    showDetectionPrompt();
  }

  mainDetectorInitialization = (async () => {
    try {
      const ort = await loadOnnxRuntime();
      ort.env.wasm.wasmPaths = {
        mjs: "/vendor/ort-wasm-simd-threaded.jsep.js",
        wasm: "/vendor/ort-wasm-simd-threaded.jsep.wasm"
      };
      ort.env.wasm.numThreads = 1;
      mainDetectorSession = await ort.InferenceSession.create("/yolo26n.onnx", {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all"
      });
      detectorMode = "main";
      detectorReady = true;
      detectorFallback = false;
      mainDetectorInitialization = null;

      if (stream && !isBusy()) {
        beginSearching();
      }
    } catch (error) {
      failPetDetector(error);
    }
  })();

  return mainDetectorInitialization;
}

function handleDetectorFailure(error) {
  console.error("Pet detector worker failed:", error);

  if (detectorMode === "main-loading") {
    return;
  }

  if (detectorWorker) {
    detectorWorker.terminate();
    detectorWorker = null;
  }

  if (detectorMode === "worker") {
    initializeMainThreadDetector(error);
    return;
  }

  failPetDetector(error);
}

function initializeDetector() {
  detectorReady = false;
  detectorFallback = false;
  mainDetectorSession = null;
  mainDetectorInitialization = null;

  if (!window.Worker || !window.createImageBitmap) {
    detectorMode = null;
    initializeMainThreadDetector(new Error("Web Worker camera frames are unavailable."));
    return;
  }

  detectorMode = "worker";
  detectorWorker = new Worker("/pet-detector-worker.js");
  detectorWorker.addEventListener("message", (event) => {
    if (event.data?.type === "ready") {
      detectorReady = true;
      detectorFallback = false;
      detectorMode = "worker";

      if (stream && !isBusy()) {
        setAppState(STATES.SEARCHING);
        petGuide.hidden = false;
        showDetectionPrompt();
        setStatus("Bring your pet into the camera so Pemi can find them.");
        scheduleDetection(0);
      } else {
        refreshControls();
      }
      return;
    }

    if (event.data?.type === "detection") {
      handleDetection(event.data.pet, event.data.requestId);
      return;
    }

    if (event.data?.type === "error") {
      if (
        event.data.requestId !== undefined &&
        event.data.requestId !== activeDetectionRequestId
      ) {
        return;
      }

      detectionInFlight = false;
      activeDetectionRequestId = null;
      handleDetectorFailure(new Error(event.data.message));
    }
  });
  detectorWorker.addEventListener("error", (event) => {
    detectionInFlight = false;
    activeDetectionRequestId = null;
    handleDetectorFailure(new Error(event.message || "Pet detector worker failed."));
  });
  detectorWorker.postMessage({
    type: "init",
    modelUrl: "/yolo26n.onnx",
    runtimeUrl: "/vendor/ort.min.js",
    trackingUtilsUrl: "/pet-tracking-utils.js",
    wasmRoot: "/vendor/"
  });
}

function beginSearching() {
  hideResult();
  hideWaitingOverlay();
  deactivateBirdPlayground({ immediate: true });
  currentVideoBlob = null;
  resetDetectionHistory();

  if (!window.MediaRecorder) {
    detectorFallback = true;
    petGuide.hidden = true;
    detectionPrompt.hidden = true;
    setAppState(STATES.ERROR);
    setStatus("This browser can show the camera, but it cannot record video. Try the latest Safari, Chrome, or Edge.");
    return;
  }

  if (detectorReady) {
    setAppState(STATES.SEARCHING);
    petGuide.hidden = false;
    showDetectionPrompt();
    setStatus("Bring your pet into the camera so Pemi can find them.");
    scheduleDetection(0);
    return;
  }

  if (detectorFallback) {
    petGuide.hidden = true;
    detectionPrompt.hidden = true;
    setAppState(STATES.ERROR);
    setStatus("Pemi's pet finder could not start. Tap Try It Again to reload it.");
    return;
  }

  setAppState(STATES.LOADING_MODEL);
  petGuide.hidden = false;
  showDetectionPrompt();
  setStatus("Camera ready. Pemi is warming up the pet finder...");
}

async function startCamera() {
  if (stream || appState === STATES.REQUESTING_CAMERA) {
    return;
  }

  hideResult();
  hideWaitingOverlay();
  deactivateBirdPlayground({ immediate: true });
  setAppState(STATES.REQUESTING_CAMERA);
  setStatus("Say yes to the camera so Pemi can look for your pet...");

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 960 }
      },
      audio: false
    });

    camera.srcObject = stream;
    await camera.play().catch(() => undefined);
    emptyState.hidden = true;
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      stopCamera();
      setStatus("The camera stopped. Open it again when your pet is ready.");
    });
    beginSearching();
  } catch (error) {
    stream = null;
    deactivateBirdPlayground({ immediate: true });
    petGuide.hidden = true;
    detectionPrompt.hidden = true;
    setAppState(STATES.ERROR);

    if (error.name === "NotAllowedError") {
      setStatus("The camera door is closed. Allow camera access in your browser, then tap Open Camera.");
      return;
    }

    if (error.name === "NotFoundError") {
      setStatus("We could not find a camera. Check your connection or try another device.");
      return;
    }

    setStatus("The camera got camera-shy. Tap Open Camera to give it another try.");
  }
}

function stopCamera() {
  stopDetectionLoop();
  hideWaitingOverlay();
  deactivateBirdPlayground({ immediate: true });

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }

  stream = null;
  camera.srcObject = null;
  emptyState.hidden = false;
  petGuide.hidden = true;
  detectionPrompt.hidden = true;
  setAppState(STATES.IDLE);
}

function getSupportedVideoMimeType() {
  const candidates = [
    "video/mp4;codecs=h264",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];

  if (!window.MediaRecorder?.isTypeSupported) {
    return "";
  }

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function getVideoExtension(blobType) {
  return blobType.includes("mp4") ? "mp4" : "webm";
}

function getUploadContentType(blobType) {
  if (blobType.includes("mp4")) {
    return "video/mp4";
  }

  if (blobType.includes("webm")) {
    return "video/webm";
  }

  throw new Error("The browser recorded an unsupported video format.");
}

async function validateRecordedVideo(videoBlob, contentType) {
  if (videoBlob.size < MIN_VIDEO_BYTES) {
    throw new Error("The browser produced an empty or incomplete video clip.");
  }

  if (videoBlob.size > MAX_VIDEO_BYTES) {
    throw new Error("The video is too large. Please try the reading again.");
  }

  const header = new Uint8Array(await videoBlob.slice(0, 12).arrayBuffer());
  const isMp4 =
    contentType === "video/mp4" &&
    header.length >= 8 &&
    String.fromCharCode(...header.slice(4, 8)) === "ftyp";
  const isWebm =
    contentType === "video/webm" &&
    header.length >= 4 &&
    header[0] === 0x1a &&
    header[1] === 0x45 &&
    header[2] === 0xdf &&
    header[3] === 0xa3;

  if (!isMp4 && !isWebm) {
    throw new Error("The browser did not produce a valid video clip.");
  }
}

function recordPetVideo(seconds) {
  if (!window.MediaRecorder) {
    return Promise.reject(new Error("This browser cannot record video. Try the latest Safari, Chrome, or Edge."));
  }

  const mimeType = getSupportedVideoMimeType();
  const options = {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 2_000_000
  };
  const chunks = [];
  let recorder;

  try {
    recorder = new MediaRecorder(stream, options);
  } catch (error) {
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (fallbackError) {
      return Promise.reject(fallbackError);
    }
  }

  return new Promise((resolve, reject) => {
    let stopTimer;

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size > 0) {
        chunks.push(event.data);
      }
    });

    recorder.addEventListener("error", () => {
      window.clearTimeout(stopTimer);
      reject(new Error("Video recording failed."));
    });

    recorder.addEventListener("stop", () => {
      window.clearTimeout(stopTimer);

      if (!chunks.length) {
        reject(new Error("No video data was recorded."));
        return;
      }

      const type = recorder.mimeType || mimeType || "video/webm";
      resolve(new Blob(chunks, { type }));
    });

    recorder.start(250);
    stopTimer = window.setTimeout(() => {
      if (recorder.state === "recording") {
        recorder.stop();
      }
    }, seconds * 1000);
  });
}

async function requestPetVideoUpload(filename, contentType) {
  const response = await fetch("/api/presign-pet-video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      filename,
      content_type: contentType
    })
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    if (payload?.error) {
      throw new Error(payload.error);
    }

    if (response.status === 404) {
      throw new Error("The S3 upload service is not connected to this website deployment.");
    }

    throw new Error(`The S3 upload service returned HTTP ${response.status}.`);
  }

  if (!payload?.uploadUrl || !payload?.publicUrl || payload?.contentType !== contentType) {
    throw new Error("The S3 upload service returned incomplete upload details.");
  }

  return payload;
}

async function uploadPetVideoToS3(videoBlob, upload) {
  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: {
      ...(upload.uploadHeaders || {}),
      "Content-Type": upload.contentType
    },
    body: videoBlob
  });

  if (!response.ok) {
    throw new Error("The video could not be uploaded to S3.");
  }
}

async function requestPetVideoConversion(videoUrl) {
  const response = await fetch("/api/transcode-pet-video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ video_url: videoUrl })
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || `The video conversion service returned HTTP ${response.status}.`);
  }

  if (!payload?.videoUrl || payload?.contentType !== "video/mp4") {
    throw new Error("The video conversion service returned incomplete details.");
  }

  return payload.videoUrl;
}

async function requestPetAnalysis(videoUrl) {
  const response = await fetch("/api/analyze-pet-url", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ video_url: videoUrl })
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    if (payload?.error) {
      throw new Error(payload.error);
    }

    if (response.status === 404) {
      throw new Error("The analysis service is not connected to this website deployment.");
    }

    throw new Error(`The analysis service returned HTTP ${response.status}.`);
  }

  if (!payload?.title || !payload?.copy) {
    throw new Error("The analysis response was missing display text.");
  }

  return payload;
}

async function analyzePet(videoBlob) {
  const contentType = getUploadContentType(videoBlob.type);
  const extension = getVideoExtension(contentType);
  const filename = `pemi-reading-${Date.now()}.${extension}`;
  await validateRecordedVideo(videoBlob, contentType);

  showWaitingOverlay("Safely sending your pet's tiny moment...");
  setStatus("Pemi is safely sending your pet's tiny moment...");
  const upload = await requestPetVideoUpload(filename, contentType);
  await uploadPetVideoToS3(videoBlob, upload);
  let analysisVideoUrl = upload.publicUrl;

  if (contentType === "video/webm") {
    showWaitingOverlay("Preparing this tiny moment for a closer look...");
    setStatus("Pemi is preparing this tiny moment for a closer look...");
    analysisVideoUrl = await requestPetVideoConversion(upload.publicUrl);
  }

  showAnalysisWaitingMessages();
  setStatus("Pemi is listening closely and decoding those tiny feelings...");
  return requestPetAnalysis(analysisVideoUrl);
}

async function submitCurrentClip() {
  if (!currentVideoBlob) {
    throw new Error("There is no pet clip to analyze.");
  }

  setAppState(STATES.ANALYZING);
  setStatus("Pemi is listening closely and decoding those tiny feelings...");

  try {
    const analysis = await analyzePet(currentVideoBlob);
    resultTitle.textContent = analysis.title;
    resultCopy.textContent = analysis.copy;
    result.hidden = false;
    currentVideoBlob = null;
    hideWaitingOverlay();
    stopDetectionLoop();
    deactivateBirdPlayground();
    setAppState(STATES.SUCCESS);
    setStatus("Message received! Try another look whenever your pet is ready.");
  } catch (error) {
    console.error(error);
    hideWaitingOverlay();
    stopDetectionLoop();
    deactivateBirdPlayground();
    setAppState(STATES.ERROR);
    setStatus(`${error.message || "The message got fuzzy."} Tap Try It Again to start a new reading.`);
  }
}

async function runNewAnalysis() {
  if (!stream || isBusy()) {
    return;
  }

  hideResult();
  currentVideoBlob = null;
  setAppState(STATES.RECORDING);
  petGuide.hidden = true;
  activateBirdPlayground();
  showWaitingOverlay("The birds found your pet — getting ready...");
  setStatus("Pemi found your pet. Keep that little face comfortably in frame...");
  scheduleDetection(0);

  try {
    await new Promise((resolve) => window.setTimeout(resolve, BIRD_ARRIVAL_DELAY_MS));

    if (!stream || appState !== STATES.RECORDING) {
      throw new Error("The camera stopped before the reading could begin.");
    }

    updateWaitingMessage("Capturing a 5-second moment...");
    setStatus("The birds are keeping your pet company while Pemi captures this moment...");
    currentVideoBlob = await recordPetVideo(RECORDING_SECONDS);

    if (!stream || appState !== STATES.RECORDING) {
      throw new Error("The camera stopped before the reading was complete.");
    }

    await submitCurrentClip();
  } catch (error) {
    console.error(error);
    hideWaitingOverlay();
    stopDetectionLoop();
    deactivateBirdPlayground();
    setAppState(STATES.ERROR);
    setStatus(error.message || "The message got fuzzy. Try brighter light and a steadier pose.");
  }
}

function handleRetry() {
  hideResult();
  hideWaitingOverlay();
  deactivateBirdPlayground({ immediate: true });
  currentVideoBlob = null;
  resetDetectionHistory();

  if (!detectorReady) {
    detectorFallback = false;
    setAppState(STATES.LOADING_MODEL);
    petGuide.hidden = false;
    showDetectionPrompt();
    setStatus("Pemi is reloading the pet finder...");
    initializeDetector();
    return;
  }

  beginSearching();
}

function showPoster(index) {
  if (!posters.length) {
    return;
  }

  currentPosterIndex = (index + posters.length) % posters.length;
  const poster = posters[currentPosterIndex];

  posterDialogImage.src = poster.src;
  posterDialogImage.alt = `${poster.title} full Pemi poster`;
  posterDialogTitle.textContent = poster.title;
  posterCounter.textContent = `${currentPosterIndex + 1} of ${posters.length}`;
}

function openPoster(index) {
  if (!posters.length) {
    return;
  }

  showPoster(index);

  if (typeof posterDialog.showModal === "function") {
    posterDialog.showModal();
    return;
  }

  posterDialog.setAttribute("open", "");
}

function closePoster() {
  if (typeof posterDialog.close === "function") {
    posterDialog.close();
    return;
  }

  posterDialog.removeAttribute("open");
}

function handlePosterKeys(event) {
  if (!posterDialog.open) {
    return;
  }

  if (event.key === "ArrowLeft") {
    showPoster(currentPosterIndex - 1);
  }

  if (event.key === "ArrowRight") {
    showPoster(currentPosterIndex + 1);
  }
}

function wirePosterViewer() {
  posterTriggers.forEach((trigger) => {
    trigger.addEventListener("click", () => {
      const index = posters.findIndex((poster) => poster.src === trigger.dataset.poster);
      openPoster(index);
    });
  });
  posterCloseButton.addEventListener("click", closePoster);
  posterPreviousButton.addEventListener("click", () => showPoster(currentPosterIndex - 1));
  posterNextButton.addEventListener("click", () => showPoster(currentPosterIndex + 1));
  posterDialog.addEventListener("click", (event) => {
    if (event.target === posterDialog) {
      closePoster();
    }
  });
  window.addEventListener("keydown", handlePosterKeys);
}

function isCameraContextAllowed() {
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  return window.isSecureContext || localHosts.has(window.location.hostname);
}

function boot() {
  wirePosterViewer();
  petGuide.hidden = true;
  birdPlayground.hidden = true;
  detectionPrompt.hidden = true;
  reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  if (!petTracking) {
    startButton.disabled = true;
    setStatus("Pemi's pet tracker could not start. Refresh the page to try again.");
    return;
  }

  if (!isCameraContextAllowed()) {
    startButton.disabled = true;
    setStatus("Camera access needs HTTPS. Open this page on a secure Pemi link.");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    startButton.disabled = true;
    setStatus("This browser cannot open the camera. Try the latest Safari, Chrome, or Edge.");
    return;
  }

  startButton.addEventListener("click", startCamera);
  retryButton.addEventListener("click", handleRetry);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.clearTimeout(detectionTimer);
      detectionTimer = null;
      return;
    }

    if (isPetTrackingState()) {
      scheduleDetection(0);
    }
  });
  if (window.ResizeObserver) {
    new ResizeObserver(refreshBirdTarget).observe(videoFrame);
  } else {
    window.addEventListener("resize", refreshBirdTarget);
  }
  window.addEventListener("pagehide", stopCamera);

  if (window.MediaRecorder) {
    initializeDetector();
  } else {
    detectorFallback = true;
  }

  startCamera();
}

boot();
