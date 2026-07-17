const camera = document.querySelector("#camera");
const canvas = document.querySelector("#snapshot");
const experienceVisual = document.querySelector(".experience-visual");
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
const knowledgeCards = document.querySelector("#knowledge-cards");
const knowledgeCardButtons = Array.from(document.querySelectorAll(".knowledge-card"));
const statusText = document.querySelector("#status-text");
const startButton = document.querySelector("#start-btn");
const retryButton = document.querySelector("#retry-btn");
const cameraSwitchButton = document.querySelector("#camera-switch-btn");
const cameraSwitchStatus = document.querySelector("#camera-switch-status");
const result = document.querySelector("#result");
const resultSnapshot = document.querySelector("#result-snapshot");
const resultTitle = document.querySelector("#result-title");
const resultCopy = document.querySelector("#result-copy");
const resultMoodContainer = document.querySelector("#result-mood-container");
const resultMoodValue = document.querySelector("#result-mood-value");
const resultDistributionContainer = document.querySelector("#result-distribution-container");
const resultDistributionSvg = document.querySelector("#result-distribution-svg");
const resultDistributionLegend = document.querySelector("#result-distribution-legend");
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
const PET_KNOWLEDGE = {
  dog: [
    {
      title: "A wagging tail is not always happy",
      copy: "Tail height, speed, and the rest of the body tell the full story. A relaxed body matters more than the wag alone."
    },
    {
      title: "Yawning can mean calm",
      copy: "Dogs may yawn when they feel excited or unsure, not only when they are sleepy. A little space can help them settle."
    },
    {
      title: "A dry nose is not a diagnosis",
      copy: "A nose can feel dry after a nap, sunbathing, or in dry weather. Overall behavior is a better clue than nose moisture."
    },
    {
      title: "Dogs read your voice",
      copy: "Dogs often respond to your tone as much as your words. A warm, steady voice can make a new situation feel safer."
    },
    {
      title: "Sniffing is serious work",
      copy: "Sniffing helps dogs gather information about their surroundings. A slow sniffing walk can be great mental exercise."
    },
    {
      title: "The play bow is an invitation",
      copy: "Front legs down with the rear up is often a playful hello. Look for a loose body and happy movement around it."
    }
  ],
  cat: [
    {
      title: "Slow blinks can mean trust",
      copy: "A slow blink often shows that a cat feels relaxed around you. Try a slow blink back as a friendly hello."
    },
    {
      title: "Watch the tip of the tail",
      copy: "A tiny tail-tip twitch can mean focused attention. Give your cat time to decide what happens next."
    },
    {
      title: "Purring is not always joy",
      copy: "Purring often happens during contentment, but cats may also purr to soothe themselves. Read the whole body and context."
    },
    {
      title: "Whiskers show attention",
      copy: "Whiskers naturally point forward when a cat is curious and may pull back when it feels worried. Keep the whole posture in mind."
    },
    {
      title: "A raised tail is a hello",
      copy: "A relaxed, upright tail is commonly a friendly greeting. A puffed-up tail tells a very different story."
    },
    {
      title: "Kneading comes from kittenhood",
      copy: "Many cats knead soft places when they feel comfortable. It is a leftover soothing behavior from nursing as kittens."
    }
  ]
};
const BIRD_PERIODS_MS = [5200, 6100, 6900];
const BIRD_PHASES = [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6];
const RESULT_FRAME_SAMPLE_SIZE = 96;
const RESULT_REVEAL_MS = 220;

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
let preferredCameraFacingMode = "environment";
let activeCameraFacingMode = "environment";
let phoneCameraUiEnabled = false;
let cameraSwitchAvailable = null;
let isSwitchingCamera = false;
let cameraOperationSequence = 0;
let cameraStreamGeneration = 0;
let resumeBirdsAfterCameraSwitch = false;
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
let currentPetType = null;
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
let resultRevealTimer = null;
let collectingResultFrames = false;
let resultSnapshotReady = false;
let firstFrameCaptured = false;
let bestResultFrameScore = Number.NEGATIVE_INFINITY;
let pendingResultFrameRequestId = null;
const pendingResultFrame = document.createElement("canvas");
const resultFrameSample = document.createElement("canvas");

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

function isCameraPreviewMirrored() {
  return petTracking.shouldMirrorCamera(activeCameraFacingMode);
}

function announceCameraSwitch(message) {
  cameraSwitchStatus.textContent = "";
  window.requestAnimationFrame(() => {
    cameraSwitchStatus.textContent = message;
  });
}

function syncCameraPresentation() {
  const mirrored = isCameraPreviewMirrored();
  const targetLabel = mirrored ? "rear" : "front";
  cameraStage.classList.toggle("is-front-camera", mirrored);
  cameraSwitchButton.setAttribute("aria-label", `Switch to ${targetLabel} camera`);
  cameraSwitchButton.title = `Switch to ${targetLabel} camera`;
}

function isCameraSwitchAllowedState() {
  // 只在加载模型、搜索查找宠物阶段提供镜头翻转按钮。
  // 在录制阶段 (RECORDING) 与等待深度解读分析阶段 (ANALYZING) 移除按钮，防止发生遮挡
  return [STATES.LOADING_MODEL, STATES.SEARCHING, STATES.ERROR].includes(
    appState
  );
}

function refreshControls() {
  const canRetry = [STATES.SUCCESS, STATES.ERROR].includes(appState);
  const showCameraSwitch =
    phoneCameraUiEnabled &&
    Boolean(stream) &&
    cameraSwitchAvailable !== false &&
    isCameraSwitchAllowedState();

  startButton.hidden = Boolean(stream) || appState === STATES.REQUESTING_CAMERA;
  startButton.disabled = appState === STATES.REQUESTING_CAMERA || isBusy() || isSwitchingCamera;
  retryButton.hidden = !stream || !canRetry;
  retryButton.disabled = isBusy() || isSwitchingCamera || !stream || !canRetry;
  cameraSwitchButton.hidden = !showCameraSwitch;
  cameraSwitchButton.disabled = isSwitchingCamera;
  cameraSwitchButton.classList.toggle("is-switching", isSwitchingCamera);
}

function setAppState(nextState) {
  appState = nextState;
  cameraStage.dataset.state = nextState;
  cameraStage.classList.toggle("is-busy", isBusy());

  if (![STATES.SEARCHING, STATES.LOADING_MODEL].includes(nextState)) {
    detectionPrompt.hidden = true;
  }

  // 根据当前状态显示或隐藏模型加载中的磨砂遮罩
  const overlay = document.querySelector("#model-loading-overlay");
  if (overlay) {
    if (nextState === STATES.LOADING_MODEL) {
      overlay.removeAttribute("hidden");
    } else {
      overlay.setAttribute("hidden", "");
    }
  }

  refreshControls();
}

function syncResultFrameMinimumHeight() {
  const width = experienceVisual.clientWidth;

  if (!width) {
    return;
  }

  const minimumHeight = petTracking.calculateResultFrameMinimumHeight(
    width,
    window.matchMedia("(max-width: 680px)").matches
  );
  result.style.setProperty("--result-frame-min-height", `${minimumHeight}px`);
}

function clearCanvas(targetCanvas) {
  targetCanvas.width = 1;
  targetCanvas.height = 1;
  targetCanvas.getContext("2d")?.clearRect(0, 0, 1, 1);
}

function resetResultFrameCapture({ clearSnapshot = true } = {}) {
  collectingResultFrames = false;
  firstFrameCaptured = false;
  bestResultFrameScore = Number.NEGATIVE_INFINITY;
  pendingResultFrameRequestId = null;
  clearCanvas(pendingResultFrame);
  clearCanvas(resultFrameSample);

  if (clearSnapshot) {
    resultSnapshotReady = false;
    clearCanvas(resultSnapshot);
  }
}

function drawCameraFrame(targetCanvas, { mirrored = false } = {}) {
  const width = camera.videoWidth;
  const height = camera.videoHeight;

  if (!width || !height || camera.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return false;
  }

  targetCanvas.width = width;
  targetCanvas.height = height;
  const context = targetCanvas.getContext("2d");
  context.save();

  if (mirrored) {
    context.translate(width, 0);
    context.scale(-1, 1);
  }

  context.drawImage(camera, 0, 0, width, height);
  context.restore();
  return true;
}

function saveResultFrame(sourceCanvas) {
  if (!sourceCanvas.width || !sourceCanvas.height) {
    return false;
  }

  resultSnapshot.width = sourceCanvas.width;
  resultSnapshot.height = sourceCanvas.height;
  const context = resultSnapshot.getContext("2d");
  context.save();

  if (isCameraPreviewMirrored()) {
    context.translate(sourceCanvas.width, 0);
    context.scale(-1, 1);
  }

  context.drawImage(sourceCanvas, 0, 0);
  context.restore();
  resultSnapshotReady = true;
  return true;
}

function captureFallbackResultFrame() {
  if (resultSnapshotReady) {
    return;
  }

  const fallbackFrame = document.createElement("canvas");

  if (drawCameraFrame(fallbackFrame)) {
    saveResultFrame(fallbackFrame);
  }
}

function beginResultFrameCollection() {
  resetResultFrameCapture();
  collectingResultFrames = true;

  // 捕获视频的第一帧作为结果展示图片
  const firstFrame = document.createElement("canvas");
  if (drawCameraFrame(firstFrame)) {
    saveResultFrame(firstFrame);
    firstFrameCaptured = true;
    console.log("First frame of video captured successfully at the start of recording.");
  } else {
    console.warn("Could not capture first frame immediately; will capture next available active frame.");
  }
}

function finishResultFrameCollection() {
  collectingResultFrames = false;
  captureFallbackResultFrame();
}

function capturePendingResultFrame(requestId) {
  if (!collectingResultFrames || appState !== STATES.RECORDING) {
    return;
  }

  // 如果未能在大底启动时成功捕获首帧，在后续任一活跃帧中进行重试并锁定为首帧展示
  if (!firstFrameCaptured) {
    const backupFirstFrame = document.createElement("canvas");
    if (drawCameraFrame(backupFirstFrame)) {
      saveResultFrame(backupFirstFrame);
      firstFrameCaptured = true;
      console.log("First frame of video captured on active frame callback.");
    }
  }

  if (drawCameraFrame(pendingResultFrame)) {
    pendingResultFrameRequestId = requestId;
  }
}

function scorePendingResultFrame(pet, requestId) {
  if (pendingResultFrameRequestId !== requestId) {
    return;
  }

  pendingResultFrameRequestId = null;

  if (!pet?.box || pendingResultFrame.width <= 1 || pendingResultFrame.height <= 1) {
    clearCanvas(pendingResultFrame);
    return;
  }

  const sourceWidth = pendingResultFrame.width;
  const sourceHeight = pendingResultFrame.height;
  const sourceX = petTracking.clamp(pet.box.x, 0, 1) * sourceWidth;
  const sourceY = petTracking.clamp(pet.box.y, 0, 1) * sourceHeight;
  const cropWidth = Math.max(
    1,
    (petTracking.clamp(pet.box.x + pet.box.width, 0, 1) - petTracking.clamp(pet.box.x, 0, 1)) *
      sourceWidth
  );
  const cropHeight = Math.max(
    1,
    (petTracking.clamp(pet.box.y + pet.box.height, 0, 1) - petTracking.clamp(pet.box.y, 0, 1)) *
      sourceHeight
  );
  resultFrameSample.width = RESULT_FRAME_SAMPLE_SIZE;
  resultFrameSample.height = RESULT_FRAME_SAMPLE_SIZE;
  const sampleContext = resultFrameSample.getContext("2d", { willReadFrequently: true });
  sampleContext.drawImage(
    pendingResultFrame,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    0,
    0,
    RESULT_FRAME_SAMPLE_SIZE,
    RESULT_FRAME_SAMPLE_SIZE
  );
  const sample = sampleContext.getImageData(
    0,
    0,
    RESULT_FRAME_SAMPLE_SIZE,
    RESULT_FRAME_SAMPLE_SIZE
  );
  const sharpness = petTracking.calculateLuminanceGradientSharpness(
    sample.data,
    sample.width,
    sample.height
  );
  const score = petTracking.calculateFrameCandidateScore(
    sharpness,
    pet.confidence,
    pet.areaRatio
  );

  if (score > bestResultFrameScore) {
    bestResultFrameScore = score;
    // 结果展示图片已规定为视频第一帧，此评分阶段不再覆盖已被捕获的视频首帧
    // saveResultFrame(pendingResultFrame);
  }

  clearCanvas(pendingResultFrame);
}

function showResult() {
  window.clearTimeout(resultRevealTimer);
  syncResultFrameMinimumHeight();
  videoFrame.hidden = false;
  result.hidden = false;

  const reveal = () => {
    if (result.hidden || appState !== STATES.SUCCESS) {
      return;
    }

    cameraStage.classList.add("is-result-revealed");

    if (reducedMotionQuery?.matches) {
      videoFrame.hidden = true;
      return;
    }

    resultRevealTimer = window.setTimeout(() => {
      if (appState === STATES.SUCCESS) {
        videoFrame.hidden = true;
      }
    }, RESULT_REVEAL_MS);
  };

  if (reducedMotionQuery?.matches) {
    reveal();
  } else {
    window.requestAnimationFrame(() => window.requestAnimationFrame(reveal));
  }
}

function renderDistributionChart(distribution) {
  if (!resultDistributionContainer || !resultDistributionSvg || !resultDistributionLegend) {
    return;
  }

  // 1. Clear previous segments and legend
  const bgCircle = resultDistributionSvg.querySelector(".donut-bg");
  resultDistributionSvg.innerHTML = "";
  if (bgCircle) {
    resultDistributionSvg.appendChild(bgCircle);
  } else {
    // Recreate bg
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "21");
    circle.setAttribute("cy", "21");
    circle.setAttribute("r", "15.91549430918954");
    circle.setAttribute("class", "donut-bg");
    circle.setAttribute("fill", "transparent");
    circle.setAttribute("stroke", "#f5f1fc");
    circle.setAttribute("stroke-width", "4.5");
    resultDistributionSvg.appendChild(circle);
  }
  resultDistributionLegend.innerHTML = "";

  if (!distribution || typeof distribution !== "object") {
    resultDistributionContainer.hidden = true;
    return;
  }

  const entries = Object.entries(distribution);
  if (entries.length === 0) {
    resultDistributionContainer.hidden = true;
    return;
  }

  // Calculate sum to normalize (just in case they don't sum to exactly 1.0)
  const sum = entries.reduce((acc, [_, val]) => acc + Number(val || 0), 0);
  if (sum <= 0) {
    resultDistributionContainer.hidden = true;
    return;
  }

  // Color Mapping matching the brand design and moods
  const emotionColors = {
    happy: "#ef8d9d",       // var(--coral)
    calm: "#8e6ccf",        // var(--violet)
    surprised: "#ffe9a5",    // var(--yellow)
    relaxed: "#ddf4e8",     // var(--mint)
    trusting: "#ddefff",    // var(--sky)
    affectionate: "#b86176" // Dark plum
  };

  function getColor(emotion) {
    const norm = String(emotion || "").toLowerCase();
    return emotionColors[norm] || "#796879"; // default slate gray
  }

  let cumulativePercent = 0;

  entries.forEach(([emotion, val]) => {
    const rawVal = Number(val || 0);
    const percent = (rawVal / sum) * 100;
    if (percent <= 0) return;

    const color = getColor(emotion);

    // 2. Add SVG donut segment
    const segment = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    segment.setAttribute("cx", "21");
    segment.setAttribute("cy", "21");
    segment.setAttribute("r", "15.91549430918954");
    segment.setAttribute("fill", "transparent");
    segment.setAttribute("stroke", color);
    segment.setAttribute("stroke-width", "4.5");
    segment.setAttribute("stroke-dasharray", `${percent} ${100 - percent}`);
    segment.setAttribute("stroke-dashoffset", String(-cumulativePercent));

    resultDistributionSvg.appendChild(segment);

    // 3. Add Legend item
    const legendItem = document.createElement("div");
    legendItem.className = "legend-item";
    
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.backgroundColor = color;

    const text = document.createElement("span");
    text.className = "legend-text";
    text.textContent = `${emotion} ${Math.round(percent)}%`;

    legendItem.appendChild(dot);
    legendItem.appendChild(text);
    resultDistributionLegend.appendChild(legendItem);

    cumulativePercent += percent;
  });

  resultDistributionContainer.hidden = false;
}

function hideResult() {
  window.clearTimeout(resultRevealTimer);
  resultRevealTimer = null;
  cameraStage.classList.remove("is-result-revealed");
  videoFrame.hidden = false;
  result.hidden = true;
  resultTitle.textContent = "Listening closely...";
  resultCopy.textContent = "";
  if (resultMoodContainer) {
    resultMoodContainer.hidden = true;
  }
  if (resultMoodValue) {
    resultMoodValue.textContent = "";
  }
  if (resultDistributionContainer) {
    resultDistributionContainer.hidden = true;
  }
  resetResultFrameCapture();
}

function hideKnowledgeCards() {
  knowledgeCards.hidden = true;
  knowledgeCardButtons.forEach((card) => {
    card.classList.remove("is-flipped");
    card.setAttribute("aria-pressed", "false");
  });
}

function showKnowledgeCards(petType) {
  const availableCards = PET_KNOWLEDGE[petType] || PET_KNOWLEDGE.dog;
  const cards = [...availableCards]
    .sort(() => Math.random() - 0.5)
    .slice(0, knowledgeCardButtons.length);

  knowledgeCardButtons.forEach((card, index) => {
    const knowledge = cards[index];
    card.querySelector(".knowledge-card-title").textContent = knowledge.title;
    card.querySelector(".knowledge-card-copy").textContent = knowledge.copy;
    card.classList.remove("is-flipped");
    card.setAttribute("aria-pressed", "false");
  });

  knowledgeCards.hidden = false;
}

function wireKnowledgeCards() {
  const knowledgeDialog = document.querySelector("#knowledge-dialog");
  const knowledgeDialogTitle = document.querySelector("#knowledge-dialog-title");
  const knowledgeDialogCopy = document.querySelector("#knowledge-dialog-copy");
  const knowledgeDialogClose = document.querySelector("#knowledge-dialog-close");

  knowledgeCardButtons.forEach((card) => {
    card.addEventListener("click", () => {
      // 触发翻转样式
      const isFlipped = card.classList.toggle("is-flipped");
      card.setAttribute("aria-pressed", String(isFlipped));

      // 在移动端或小屏上，直接打开放大弹窗
      // 用户反映"现在卡片样式不变，但用户点击卡片后出现一个放大的卡片，能够显示全文字，用户再次点击卡片或者卡片外部，卡片自动缩放回原始大小和位置"
      // 我们可以让手机/桌面下，点击都能优雅地弹窗并以过渡效果铺满，这样文字才能100%看全。
      const title = card.querySelector(".knowledge-card-title").textContent;
      const copy = card.querySelector(".knowledge-card-copy").textContent;

      if (knowledgeDialog && knowledgeDialogTitle && knowledgeDialogCopy) {
        knowledgeDialogTitle.textContent = title;
        knowledgeDialogCopy.textContent = copy;

        // 打开 dialog
        knowledgeDialog.showModal();
        knowledgeDialog.classList.add("is-visible");
      }
    });
  });

  if (knowledgeDialog) {
    // 再次点击卡片或点击卡片外部，自动缩放回
    knowledgeDialog.addEventListener("click", (e) => {
      // 如果点击的是 dialog 本身（即背景层 backdrop）
      if (e.target === knowledgeDialog) {
        closeKnowledgeDialog();
      }
    });

    if (knowledgeDialogClose) {
      knowledgeDialogClose.addEventListener("click", () => {
        closeKnowledgeDialog();
      });
    }
  }

  function closeKnowledgeDialog() {
    knowledgeDialog.classList.remove("is-visible");
    // 等待缩放和淡出动画完成后再 close
    setTimeout(() => {
      knowledgeDialog.close();
    }, 200);
  }
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
  hideKnowledgeCards();
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
    isCameraPreviewMirrored()
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
  capturePendingResultFrame(requestId);

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
    scorePendingResultFrame(null, requestId);
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

  scorePendingResultFrame(pet, requestId);
  detectionInFlight = false;
  activeDetectionRequestId = null;

  if (!isPetTrackingState()) {
    return;
  }

  updateBirdTracking(pet);

  if (pet?.label) {
    currentPetType = pet.label;
  }

  if (resumeBirdsAfterCameraSwitch && appState === STATES.ANALYZING && pet?.box) {
    resumeBirdsAfterCameraSwitch = false;
    activateBirdPlayground();
  }

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

  console.warn("Worker pet detector unavailable; switching to browser main thread fallback.", workerError);
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
      console.log("Main Thread: Loading ONNX Runtime script (/vendor/ort.min.js)...");
      const ort = await loadOnnxRuntime();
      console.log("Main Thread: ONNX Runtime script loaded successfully.");
      
      ort.env.wasm.wasmPaths = {
        mjs: "/vendor/ort-wasm-simd-threaded.jsep.js",
        wasm: "/vendor/ort-wasm-simd-threaded.jsep.wasm"
      };
      ort.env.wasm.numThreads = 1;
      console.log("Main Thread: setup env.wasm.wasmPaths as:", JSON.stringify(ort.env.wasm.wasmPaths));

      console.log("Main Thread: Creating InferenceSession for /yolo26n.onnx ...");
      const startCreate = performance.now();
      mainDetectorSession = await ort.InferenceSession.create("/yolo26n.onnx", {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all"
      });
      console.log(`Main Thread: InferenceSession loaded successfully in ${(performance.now() - startCreate).toFixed(1)}ms.`);
      
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
  console.log("Initializing Worker Pet Detector. Posting init config payload...");
  detectorReady = false;
  detectorFallback = false;
  mainDetectorSession = null;
  mainDetectorInitialization = null;

  if (!window.Worker || !window.createImageBitmap) {
    console.warn("Web Worker or createImageBitmap is not supported in this browser. Falling back to Main Thread detector.");
    detectorMode = null;
    initializeMainThreadDetector(new Error("Web Worker camera frames are unavailable."));
    return;
  }

  detectorMode = "worker";
  
  try {
    detectorWorker = new Worker("/pet-detector-worker.js");
  } catch (err) {
    console.error("Failed to create Web Worker: /pet-detector-worker.js", err);
    initializeMainThreadDetector(err);
    return;
  }

  detectorWorker.addEventListener("message", (event) => {


    if (event.data?.type === "ready") {
      console.log("Worker reported: initialization finished gracefully (READY).");
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
      console.error("Worker reported error status:", event.data.message);
      if (
        event.data.requestId !== undefined &&
        event.data.requestId !== activeDetectionRequestId
      ) {
        return;
      }

      scorePendingResultFrame(null, event.data.requestId);
      detectionInFlight = false;
      activeDetectionRequestId = null;
      handleDetectorFailure(new Error(event.data.message));
    }
  });
  detectorWorker.addEventListener("error", (event) => {
    console.error("Worker process error triggered:", event.message || "Pet detector worker failed.");
    scorePendingResultFrame(null, activeDetectionRequestId);
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
  resumeBirdsAfterCameraSwitch = false;
  currentVideoBlob = null;
  currentPetType = null;
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

function createCameraConstraints(facingMode, exact = false) {
  return {
    video: {
      facingMode: exact ? { exact: facingMode } : { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 960 }
    },
    audio: false
  };
}

function releaseMediaStream(targetStream) {
  targetStream?.getTracks().forEach((track) => track.stop());
}

function getStreamVideoSettings(targetStream) {
  return targetStream?.getVideoTracks()[0]?.getSettings?.() || {};
}

function getReportedFacingMode(targetStream, fallbackFacingMode) {
  const reportedFacingMode = getStreamVideoSettings(targetStream).facingMode;
  return ["user", "environment"].includes(reportedFacingMode)
    ? reportedFacingMode
    : fallbackFacingMode;
}

function canRelaxCameraConstraint(error) {
  return ["OverconstrainedError", "NotFoundError", "TypeError"].includes(error?.name);
}

function createUnavailableCameraError() {
  const error = new Error("The other camera is not available on this device.");
  error.name = "CameraUnavailableError";
  return error;
}

async function requestCameraStream(facingMode, exact = false) {
  const constraints = createCameraConstraints(facingMode, exact);
  console.log(`Requesting camera stream. Constraints: ${JSON.stringify(constraints)} (facingMode: ${facingMode}, exact: ${exact})`);
  try {
    const resStream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log("Successfully acquired camera stream ID:", resStream.id);
    return resStream;
  } catch (err) {
    console.error(`Failed to acquire camera stream with error name: "${err.name}", message: "${err.message}"`);
    throw err;
  }
}

function ensureCameraStreamChanged(targetStream, targetFacingMode, previousDeviceId) {
  const settings = getStreamVideoSettings(targetStream);
  const reportedFacingMode = settings.facingMode;
  const returnedPreviousCamera =
    Boolean(previousDeviceId) && Boolean(settings.deviceId) && settings.deviceId === previousDeviceId;
  const returnedWrongDirection =
    ["user", "environment"].includes(reportedFacingMode) &&
    reportedFacingMode !== targetFacingMode;

  if (returnedPreviousCamera || returnedWrongDirection) {
    releaseMediaStream(targetStream);
    throw createUnavailableCameraError();
  }

  return targetStream;
}

async function requestCameraForSwitch(targetFacingMode, previousDeviceId) {
  try {
    const exactStream = await requestCameraStream(targetFacingMode, true);
    return ensureCameraStreamChanged(exactStream, targetFacingMode, previousDeviceId);
  } catch (error) {
    if (!canRelaxCameraConstraint(error)) {
      throw error;
    }
  }

  const relaxedStream = await requestCameraStream(targetFacingMode);
  return ensureCameraStreamChanged(relaxedStream, targetFacingMode, previousDeviceId);
}

async function connectCameraStream(nextStream, requestedFacingMode, operationId) {
  if (operationId !== cameraOperationSequence) {
    console.warn("connectCameraStream aborted: operationId mismatch.");
    releaseMediaStream(nextStream);
    return false;
  }

  stream = nextStream;
  camera.srcObject = nextStream;
  
  console.log("Connecting camera stream, waiting for camera.play()...");
  try {
    await camera.play();
    console.log("camera.play() completed successfully. Dimensions:", camera.videoWidth, "x", camera.videoHeight);
  } catch (err) {
    console.warn("camera.play() failed or was interrupted:", err);
  }

  if (operationId !== cameraOperationSequence || stream !== nextStream) {
    console.warn("connectCameraStream connection aborted after camera play check.");
    releaseMediaStream(nextStream);

    if (camera.srcObject === nextStream) {
      camera.srcObject = null;
    }

    return false;
  }

  const videoTrack = nextStream.getVideoTracks()[0];
  if (videoTrack) {
    console.log(`Successfully active video track label: "${videoTrack.label}"`);
    try {
      const settings = videoTrack.getSettings?.() || {};
      console.log("Active video track Settings:", JSON.stringify(settings));
      if (videoTrack.getCapabilities) {
        console.log("Active video track Capabilities:", JSON.stringify(videoTrack.getCapabilities() || {}));
      }
    } catch (e) {
      console.warn("Could not read stream track settings/capabilities:", e);
    }
  } else {
    console.warn("No video track found in the returned media stream.");
  }

  activeCameraFacingMode = getReportedFacingMode(nextStream, requestedFacingMode);
  console.log(`Set activeCameraFacingMode to "${activeCameraFacingMode}" (requested: "${requestedFacingMode}")`);
  emptyState.hidden = true;
  syncCameraPresentation();
  const generation = ++cameraStreamGeneration;
  nextStream.getVideoTracks()[0]?.addEventListener(
    "ended",
    () => {
      if (
        stream !== nextStream ||
        generation !== cameraStreamGeneration ||
        isSwitchingCamera
      ) {
        return;
      }

      console.warn("Camera video track ended stream signal received.");
      stopCamera();
      setStatus("The camera stopped. Open it again when your pet is ready.");
    },
    { once: true }
  );
  refreshControls();
  return true;
}

async function refreshCameraSwitchAvailability() {
  if (!phoneCameraUiEnabled || !navigator.mediaDevices?.enumerateDevices) {
    cameraSwitchAvailable = phoneCameraUiEnabled ? null : false;
    refreshControls();
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameraCount = devices.filter((device) => device.kind === "videoinput").length;
    cameraSwitchAvailable = cameraCount ? cameraCount > 1 : null;
  } catch (error) {
    cameraSwitchAvailable = null;
  }

  refreshControls();
}

function restoreLiveCameraPhase(previousState) {
  if (appState === STATES.SUCCESS) {
    refreshControls();
    return;
  }

  if (previousState === STATES.SEARCHING && appState === STATES.SEARCHING) {
    beginSearching();
    return;
  }

  if (previousState === STATES.LOADING_MODEL && appState === STATES.LOADING_MODEL) {
    if (detectorReady) {
      beginSearching();
    } else {
      petGuide.hidden = false;
      showDetectionPrompt();
      refreshControls();
    }
    return;
  }

  if (previousState === STATES.ANALYZING && appState === STATES.ANALYZING) {
    scheduleDetection(0);
  }

  refreshControls();
}

async function switchCamera() {
  if (
    !phoneCameraUiEnabled ||
    cameraSwitchAvailable === false ||
    isSwitchingCamera ||
    !stream ||
    !isCameraSwitchAllowedState()
  ) {
    return;
  }

  const previousState = appState;
  const previousStream = stream;
  const previousFacingMode = activeCameraFacingMode;
  const previousPreferredFacingMode = preferredCameraFacingMode;
  const previousDeviceId = getStreamVideoSettings(previousStream).deviceId;
  const targetFacingMode = petTracking.getNextCameraFacingMode(previousFacingMode);
  
  console.log(`switchCamera: User triggered camera switch. previousFacingMode=${previousFacingMode}, targetFacingMode=${targetFacingMode}`);
  const operationId = ++cameraOperationSequence;
  let nextStream = null;

  isSwitchingCamera = true;
  refreshControls();
  announceCameraSwitch(`Switching to ${targetFacingMode === "environment" ? "rear" : "front"} camera.`);
  stopDetectionLoop();
  resetDetectionHistory();
  deactivateBirdPlayground({ immediate: true });
  resumeBirdsAfterCameraSwitch = previousState === STATES.ANALYZING;
  pendingResultFrameRequestId = null;
  clearCanvas(pendingResultFrame);
  stream = null;
  camera.srcObject = null;
  cameraStreamGeneration += 1;
  releaseMediaStream(previousStream);

  try {
    nextStream = await requestCameraForSwitch(targetFacingMode, previousDeviceId);

    if (!(await connectCameraStream(nextStream, targetFacingMode, operationId))) {
      console.warn("switchCamera: connectCameraStream returned false; switch operation might have been cancelled.");
      return;
    }

    preferredCameraFacingMode = activeCameraFacingMode;
    await refreshCameraSwitchAvailability();

    if (operationId !== cameraOperationSequence) {
      console.warn("switchCamera: operationId outdated during switch camera execution.");
      return;
    }

    isSwitchingCamera = false;
    syncCameraPresentation();
    refreshControls();
    announceCameraSwitch(
      `${activeCameraFacingMode === "environment" ? "Rear" : "Front"} camera is now active.`
    );
    restoreLiveCameraPhase(previousState);
  } catch (error) {
    console.error("switchCamera error encountered:", error);
    if (operationId !== cameraOperationSequence) {
      releaseMediaStream(nextStream);
      return;
    }

    releaseMediaStream(nextStream);

    if (["CameraUnavailableError", "NotFoundError", "OverconstrainedError"].includes(error?.name)) {
      cameraSwitchAvailable = false;
    }

    let restored = false;

    try {
      console.log(`switchCamera: Attempting to restore the previous camera facingMode: ${previousFacingMode}`);
      const restoredStream = await requestCameraStream(previousFacingMode);
      restored = await connectCameraStream(restoredStream, previousFacingMode, operationId);
    } catch (restoreError) {
      console.error("Could not restore the previous camera:", restoreError);
    }

    if (operationId !== cameraOperationSequence) {
      return;
    }

    preferredCameraFacingMode = previousPreferredFacingMode;
    isSwitchingCamera = false;
    syncCameraPresentation();
    refreshControls();
    announceCameraSwitch("The other camera is unavailable. The previous camera was restored.");

    if (restored) {
      restoreLiveCameraPhase(previousState);
      return;
    }

    stream = null;
    camera.srcObject = null;
    emptyState.hidden = false;
    petGuide.hidden = true;
    detectionPrompt.hidden = true;

    if (![STATES.ANALYZING, STATES.SUCCESS].includes(appState)) {
      setAppState(STATES.ERROR);
      setStatus("The camera could not restart. Tap Open Camera to try again.");
    } else {
      refreshControls();
    }
  }
}

async function startCamera() {
  if (stream || appState === STATES.REQUESTING_CAMERA || isSwitchingCamera) {
    return;
  }

  const operationId = ++cameraOperationSequence;
  let nextStream = null;
  hideResult();
  hideWaitingOverlay();
  deactivateBirdPlayground({ immediate: true });
  resumeBirdsAfterCameraSwitch = false;
  setAppState(STATES.REQUESTING_CAMERA);
  setStatus("Say yes to the camera so Pemi can look for your pet...");

  try {
    nextStream = await requestCameraStream(preferredCameraFacingMode);

    if (!(await connectCameraStream(nextStream, preferredCameraFacingMode, operationId))) {
      return;
    }

    preferredCameraFacingMode = activeCameraFacingMode;
    await refreshCameraSwitchAvailability();

    if (operationId === cameraOperationSequence) {
      beginSearching();
    }
  } catch (error) {
    if (operationId !== cameraOperationSequence) {
      releaseMediaStream(nextStream);
      return;
    }

    releaseMediaStream(nextStream);
    stream = null;
    camera.srcObject = null;
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
  cameraOperationSequence += 1;
  cameraStreamGeneration += 1;
  isSwitchingCamera = false;
  resumeBirdsAfterCameraSwitch = false;
  stopDetectionLoop();
  hideWaitingOverlay();
  deactivateBirdPlayground({ immediate: true });
  releaseMediaStream(stream);
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

function recordPetVideo(seconds, { onStart, onMidpoint } = {}) {
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
    let midpointTimer;

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size > 0) {
        chunks.push(event.data);
      }
    });

    recorder.addEventListener("error", () => {
      window.clearTimeout(stopTimer);
      window.clearTimeout(midpointTimer);
      reject(new Error("Video recording failed."));
    });

    recorder.addEventListener("stop", () => {
      window.clearTimeout(stopTimer);
      window.clearTimeout(midpointTimer);

      if (!chunks.length) {
        reject(new Error("No video data was recorded."));
        return;
      }

      const type = recorder.mimeType || mimeType || "video/webm";
      resolve(new Blob(chunks, { type }));
    });

    recorder.start(250);
    onStart?.();
    midpointTimer = window.setTimeout(() => onMidpoint?.(), (seconds * 1000) / 2);
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
    
    // 给用户展示宠物的心情，也就是 pet_emotion 中的 primary
    if (analysis && analysis.mood && resultMoodContainer && resultMoodValue) {
      resultMoodValue.textContent = analysis.mood;
      resultMoodContainer.hidden = false;
    } else if (resultMoodContainer) {
      resultMoodContainer.hidden = true;
    }

    // 渲染情绪分布图表 (Donut Ring Chart)
    if (analysis && analysis.distribution) {
      renderDistributionChart(analysis.distribution);
    } else if (resultDistributionContainer) {
      resultDistributionContainer.hidden = true;
    }
    
    currentVideoBlob = null;
    hideWaitingOverlay();
    stopDetectionLoop();
    deactivateBirdPlayground();
    resumeBirdsAfterCameraSwitch = false;
    setAppState(STATES.SUCCESS);
    showResult();
    setStatus("Message received! Try another look whenever your pet is ready.");
  } catch (error) {
    console.error(error);
    hideWaitingOverlay();
    stopDetectionLoop();
    deactivateBirdPlayground();
    resumeBirdsAfterCameraSwitch = false;
    resetResultFrameCapture();
    setAppState(STATES.ERROR);
    setStatus(`${error.message || "The message got fuzzy."} Tap Try It Again to start a new reading.`);
  }
}

async function runNewAnalysis() {
  if (!stream || isBusy() || isSwitchingCamera) {
    return;
  }

  hideResult();
  currentVideoBlob = null;
  setAppState(STATES.RECORDING);
  petGuide.hidden = true;
  activateBirdPlayground();
  showKnowledgeCards(currentPetType);
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
    currentVideoBlob = await recordPetVideo(RECORDING_SECONDS, {
      onStart: beginResultFrameCollection,
      onMidpoint: captureFallbackResultFrame
    });
    finishResultFrameCollection();

    if (!stream || appState !== STATES.RECORDING) {
      throw new Error("The camera stopped before the reading was complete.");
    }

    await submitCurrentClip();
  } catch (error) {
    console.error(error);
    hideWaitingOverlay();
    stopDetectionLoop();
    deactivateBirdPlayground();
    resumeBirdsAfterCameraSwitch = false;
    resetResultFrameCapture();
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
  console.log("Pemi system boot sequence initiated.");
  console.log("Navigator details:", JSON.stringify({
    userAgent: navigator.userAgent,
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory || "unknown"
  }));
  console.log("Support signals:", JSON.stringify({
    isSecureContext: window.isSecureContext,
    hasMediaDevices: !!navigator.mediaDevices,
    hasGetUserMedia: !!navigator.mediaDevices?.getUserMedia,
    hasWorker: typeof window.Worker !== "undefined",
    hasCreateImageBitmap: typeof window.createImageBitmap !== "undefined",
    hasOffscreenCanvas: typeof window.OffscreenCanvas !== "undefined",
    hasMediaRecorder: typeof window.MediaRecorder !== "undefined"
  }));

  wirePosterViewer();
  wireKnowledgeCards();
  petGuide.hidden = true;
  birdPlayground.hidden = true;
  detectionPrompt.hidden = true;
  cameraSwitchButton.hidden = true;
  reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  if (!petTracking) {
    console.error("Critical error: PemiPetTracking library was not loaded properly.");
    startButton.disabled = true;
    setStatus("Pemi's pet tracker could not start. Refresh the page to try again.");
    return;
  }

  phoneCameraUiEnabled = petTracking.isLikelyPhoneDevice(
    navigator.userAgent,
    navigator.userAgentData?.mobile
  );
  console.log("Device detection: isLikelyPhone =", phoneCameraUiEnabled);
  document.documentElement.classList.toggle("is-phone-device", phoneCameraUiEnabled);
  syncCameraPresentation();

  if (!isCameraContextAllowed()) {
    console.warn("Security policy warning: Context is not secure (requires HTTPS or localhost).");
    startButton.disabled = true;
    setStatus("Camera access needs HTTPS. Open this page on a secure Pemi link.");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    console.error("Incompatible API error: navigator.mediaDevices.getUserMedia is unavailable in this environment.");
    startButton.disabled = true;
    setStatus("This browser cannot open the camera. Try the latest Safari, Chrome, or Edge.");
    return;
  }

  startButton.addEventListener("click", startCamera);
  retryButton.addEventListener("click", handleRetry);
  cameraSwitchButton.addEventListener("click", switchCamera);
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
  syncResultFrameMinimumHeight();
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      refreshBirdTarget();
      syncResultFrameMinimumHeight();
    }).observe(experienceVisual);
  } else {
    window.addEventListener("resize", () => {
      refreshBirdTarget();
      syncResultFrameMinimumHeight();
    });
  }
  window.addEventListener("pagehide", () => {
    resetResultFrameCapture();
    stopCamera();
  });

  if (window.MediaRecorder) {
    initializeDetector();
  } else {
    detectorFallback = true;
  }

  startCamera();
}

boot();
