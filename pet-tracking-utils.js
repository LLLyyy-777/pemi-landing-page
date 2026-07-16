(function exposePetTrackingUtilities(globalScope) {
  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function getLetterboxMetrics(sourceWidth, sourceHeight, modelSize = 640) {
    if (sourceWidth <= 0 || sourceHeight <= 0 || modelSize <= 0) {
      throw new Error("Letterbox dimensions must be positive numbers.");
    }

    const scale = Math.min(modelSize / sourceWidth, modelSize / sourceHeight);
    const drawWidth = Math.round(sourceWidth * scale);
    const drawHeight = Math.round(sourceHeight * scale);

    return {
      sourceWidth,
      sourceHeight,
      modelSize,
      drawWidth,
      drawHeight,
      offsetX: Math.floor((modelSize - drawWidth) / 2),
      offsetY: Math.floor((modelSize - drawHeight) / 2)
    };
  }

  function normalizeModelBox(modelBox, metrics) {
    const {
      sourceWidth,
      sourceHeight,
      drawWidth,
      drawHeight,
      offsetX,
      offsetY
    } = metrics;
    const xScale = drawWidth / sourceWidth;
    const yScale = drawHeight / sourceHeight;
    const sourceLeft = clamp((modelBox.x1 - offsetX) / xScale, 0, sourceWidth);
    const sourceTop = clamp((modelBox.y1 - offsetY) / yScale, 0, sourceHeight);
    const sourceRight = clamp((modelBox.x2 - offsetX) / xScale, 0, sourceWidth);
    const sourceBottom = clamp((modelBox.y2 - offsetY) / yScale, 0, sourceHeight);
    const left = Math.min(sourceLeft, sourceRight);
    const top = Math.min(sourceTop, sourceBottom);
    const right = Math.max(sourceLeft, sourceRight);
    const bottom = Math.max(sourceTop, sourceBottom);

    return {
      x: left / sourceWidth,
      y: top / sourceHeight,
      width: (right - left) / sourceWidth,
      height: (bottom - top) / sourceHeight
    };
  }

  function mapNormalizedBoxToFrame(
    box,
    videoWidth,
    videoHeight,
    frameWidth,
    frameHeight,
    mirrored = true
  ) {
    if (videoWidth <= 0 || videoHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) {
      return null;
    }

    const coverScale = Math.max(frameWidth / videoWidth, frameHeight / videoHeight);
    const renderedWidth = videoWidth * coverScale;
    const renderedHeight = videoHeight * coverScale;
    const offsetX = (frameWidth - renderedWidth) / 2;
    const offsetY = (frameHeight - renderedHeight) / 2;
    const sourceLeft = clamp(box.x, 0, 1) * videoWidth;
    const sourceTop = clamp(box.y, 0, 1) * videoHeight;
    const sourceRight = clamp(box.x + box.width, 0, 1) * videoWidth;
    const sourceBottom = clamp(box.y + box.height, 0, 1) * videoHeight;
    const rawLeft = offsetX + sourceLeft * coverScale;
    const rawRight = offsetX + sourceRight * coverScale;
    const rawTop = offsetY + sourceTop * coverScale;
    const rawBottom = offsetY + sourceBottom * coverScale;
    const mappedLeft = mirrored ? frameWidth - rawRight : rawLeft;
    const mappedRight = mirrored ? frameWidth - rawLeft : rawRight;
    const left = clamp(Math.min(mappedLeft, mappedRight), 0, frameWidth);
    const right = clamp(Math.max(mappedLeft, mappedRight), 0, frameWidth);
    const top = clamp(Math.min(rawTop, rawBottom), 0, frameHeight);
    const bottom = clamp(Math.max(rawTop, rawBottom), 0, frameHeight);

    return {
      x: left,
      y: top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    };
  }

  function clampPointToFrame(point, frameWidth, frameHeight, padding = 0) {
    const safeHorizontalPadding = Math.min(Math.max(0, padding), frameWidth / 2);
    const safeVerticalPadding = Math.min(Math.max(0, padding), frameHeight / 2);

    return {
      x: clamp(point.x, safeHorizontalPadding, frameWidth - safeHorizontalPadding),
      y: clamp(point.y, safeVerticalPadding, frameHeight - safeVerticalPadding)
    };
  }

  globalScope.PemiPetTracking = Object.freeze({
    clamp,
    clampPointToFrame,
    getLetterboxMetrics,
    mapNormalizedBoxToFrame,
    normalizeModelBox
  });
})(globalThis);
