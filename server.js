import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegStaticPath from "ffmpeg-static";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");

  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const onnxRuntimeDistDir = path.join(__dirname, "vendor");
const port = Number(process.env.PORT || 5174);
const maxJsonBodyBytes = 64 * 1024;
const defaultMaxVideoBytes = 30 * 1024 * 1024;

const staticRoutes = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/app.js", "app.js"],
  ["/pet-tracking-utils.js", "pet-tracking-utils.js"],
  ["/pet-detector-worker.js", "pet-detector-worker.js"],
  ["/yolo26n.onnx", "yolo26n.onnx"],
  ["/models/yolo26n.onnx", "yolo26n.onnx"],
  ["/styles.css", "styles.css"]
]);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp4": "video/mp4",
  ".onnx": "application/octet-stream",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".webm": "video/webm"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function getRequestOrigin(request) {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const forwardedHost = request.headers["x-forwarded-host"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
  const resolvedProto = proto || (request.socket.encrypted ? "https" : "http");
  const resolvedHost = host || request.headers.host || `localhost:${port}`;
  return `${resolvedProto}://${resolvedHost}`;
}

function encodeObjectKey(key) {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;

    if (totalBytes > maxJsonBodyBytes) {
      throw new Error("Request body is too large.");
    }

    chunks.push(chunk);
  }

  if (!chunks.length) {
    throw new Error("Request body is missing.");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new Error("Request body must contain valid JSON.");
  }
}

function getS3PublicBaseUrl() {
  return (
    process.env.S3_PUBLIC_BASE_URL || "https://pemi-sticker.s3.us-east-1.amazonaws.com"
  ).replace(/\/$/, "");
}

function getS3PresignHeaders() {
  const apiKey = process.env.S3_PRESIGN_API_KEY || process.env.ALGORITHM_API_KEY;

  if (!apiKey) {
    throw new Error("S3_PRESIGN_API_KEY is not configured.");
  }

  return {
    "content-type": "application/json",
    [process.env.S3_PRESIGN_AUTH_HEADER || "X-API-Key"]: apiKey
  };
}

function sanitizeUploadFilename(filename) {
  const safeName = path
    .basename(String(filename || ""))
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .slice(-120);

  if (!safeName || !/\.(mp4|webm)$/i.test(safeName)) {
    throw new Error("Video filename must end in .mp4 or .webm.");
  }

  return safeName;
}

function validateVideoContentType(contentType) {
  const normalizedType = String(contentType || "").toLowerCase();

  if (!["video/mp4", "video/webm"].includes(normalizedType)) {
    throw new Error("Video Content-Type must be video/mp4 or video/webm.");
  }

  return normalizedType;
}

async function requestS3PresignedUpload(filename, contentType) {
  const presignUrl = process.env.S3_PRESIGN_URL;

  if (!presignUrl) {
    throw new Error("S3_PRESIGN_URL is not configured.");
  }

  const controller = new AbortController();
  const timeoutMs = getPositiveNumber(process.env.S3_PRESIGN_TIMEOUT_MS, 15_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(presignUrl, {
      method: "POST",
      headers: getS3PresignHeaders(),
      body: JSON.stringify({
        filename,
        content_type: contentType
      }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = payload?.detail || payload?.error || payload?.message;
      throw new Error(detail || `S3 presign request failed with ${response.status}.`);
    }

    const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
    const uploadUrl = data?.upload_url;
    const s3Key = data?.s3_key;

    if (!uploadUrl || !s3Key) {
      throw new Error("S3 presign response did not include upload_url and s3_key.");
    }

    const normalizedKey = String(s3Key).replace(/^\/+/, "");

    if (!normalizedKey || normalizedKey.split("/").includes("..")) {
      throw new Error("S3 presign response included an invalid s3_key.");
    }

    const extraHeaders =
      data?.headers && typeof data.headers === "object"
        ? data.headers
        : data?.upload_headers && typeof data.upload_headers === "object"
          ? data.upload_headers
          : {};

    return {
      uploadUrl: String(uploadUrl),
      s3Key: normalizedKey,
      publicUrl: `${getS3PublicBaseUrl()}/${encodeObjectKey(normalizedKey)}`,
      uploadHeaders: extraHeaders,
      contentType
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("S3 presign request timed out.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateS3VideoUrl(videoUrl) {
  let parsedUrl;
  let publicBase;

  try {
    parsedUrl = new URL(String(videoUrl || ""));
    publicBase = new URL(`${getS3PublicBaseUrl()}/`);
  } catch (error) {
    throw new Error("Video URL is invalid.");
  }

  if (parsedUrl.protocol !== "https:" || parsedUrl.origin !== publicBase.origin) {
    throw new Error("Video URL must use the configured public S3 bucket.");
  }

  return parsedUrl.toString();
}

function validateS3WebmUrl(videoUrl) {
  const normalizedUrl = validateS3VideoUrl(videoUrl);
  const parsedUrl = new URL(normalizedUrl);

  if (path.extname(parsedUrl.pathname).toLowerCase() !== ".webm") {
    throw new Error("Only WebM videos can be converted by this endpoint.");
  }

  return normalizedUrl;
}

async function downloadWebmVideoOnce(videoUrl) {
  const timeoutMs = getPositiveNumber(process.env.VIDEO_DOWNLOAD_TIMEOUT_MS, 30_000);
  const maxVideoBytes = getPositiveNumber(process.env.MAX_VIDEO_BYTES, defaultMaxVideoBytes);

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    const request = https.get(videoUrl, (response) => {
      const statusCode = Number(response.statusCode || 0);

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        fail(new Error(`The WebM video could not be downloaded from S3 (${statusCode}).`));
        return;
      }

      const contentType = String(response.headers["content-type"] || "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();

      if (contentType !== "video/webm") {
        response.resume();
        fail(new Error(`The S3 video has an unexpected Content-Type: ${contentType || "missing"}.`));
        return;
      }

      const declaredSize = Number(response.headers["content-length"] || 0);

      if (declaredSize > maxVideoBytes) {
        response.resume();
        fail(new Error("The WebM video is larger than the conversion limit."));
        return;
      }

      const chunks = [];
      let totalBytes = 0;

      response.on("data", (chunk) => {
        totalBytes += chunk.length;

        if (totalBytes > maxVideoBytes) {
          response.destroy(new Error("The WebM video is larger than the conversion limit."));
          return;
        }

        chunks.push(chunk);
      });
      response.on("error", fail);
      response.on("end", () => {
        if (settled) {
          return;
        }

        if (!totalBytes) {
          fail(new Error("The WebM video downloaded from S3 is empty."));
          return;
        }

        settled = true;
        resolve(Buffer.concat(chunks, totalBytes));
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Downloading the WebM video from S3 timed out."));
    });
    request.on("error", fail);
  });
}

async function downloadWebmVideo(videoUrl) {
  const maxAttempts = Math.max(
    1,
    Math.floor(getPositiveNumber(process.env.VIDEO_DOWNLOAD_MAX_ATTEMPTS, 3))
  );
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await downloadWebmVideoOnce(videoUrl);
    } catch (error) {
      lastError = error;

      if (
        attempt === maxAttempts ||
        /larger than|unexpected Content-Type|empty/i.test(error.message || "")
      ) {
        throw error;
      }

      await wait(attempt * 750);
    }
  }

  throw lastError;
}

function getFfmpegPath() {
  const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStaticPath;

  if (!ffmpegPath) {
    throw new Error("FFmpeg is not configured on this server.");
  }

  return ffmpegPath;
}

function runFfmpeg(inputPath, outputPath) {
  const timeoutMs = getPositiveNumber(process.env.VIDEO_TRANSCODE_TIMEOUT_MS, 60_000);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(getFfmpegPath(), [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-an",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "24",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputPath
    ]);
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        ffmpeg.kill("SIGKILL");
        settled = true;
        reject(new Error("Converting the WebM video to MP4 timed out."));
      }
    }, timeoutMs);

    ffmpeg.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });

    ffmpeg.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(new Error(`FFmpeg could not start: ${error.message}`));
    });

    ffmpeg.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`FFmpeg conversion failed${stderr ? `: ${stderr.trim()}` : "."}`));
    });
  });
}

function putBufferToPresignedUrl(uploadUrl, videoBuffer, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (!settled) {
        settled = true;
        error.retryable ??= true;
        reject(error);
      }
    };
    const request = https.request(
      uploadUrl,
      {
        method: "PUT",
        headers: {
          ...headers,
          "content-length": videoBuffer.length
        }
      },
      (response) => {
        response.resume();
        response.on("error", fail);
        response.on("end", () => {
          if (settled) {
            return;
          }

          settled = true;
          const statusCode = Number(response.statusCode || 0);

          if (statusCode >= 200 && statusCode < 300) {
            resolve();
            return;
          }

          const error = new Error(`Uploading the converted MP4 to S3 failed (${statusCode}).`);
          error.retryable = statusCode === 429 || statusCode >= 500;
          reject(error);
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Uploading the converted MP4 to S3 timed out."));
    });
    request.on("error", fail);
    request.end(videoBuffer);
  });
}

async function uploadConvertedVideo(videoBuffer, filename) {
  const maxVideoBytes = getPositiveNumber(process.env.MAX_VIDEO_BYTES, defaultMaxVideoBytes);

  if (!videoBuffer.length || videoBuffer.length > maxVideoBytes) {
    throw new Error("The converted MP4 is empty or larger than the upload limit.");
  }

  const upload = await requestS3PresignedUpload(filename, "video/mp4");
  const timeoutMs = getPositiveNumber(process.env.S3_UPLOAD_TIMEOUT_MS, 45_000);
  const maxAttempts = Math.max(
    1,
    Math.floor(getPositiveNumber(process.env.S3_UPLOAD_MAX_ATTEMPTS, 3))
  );
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await putBufferToPresignedUrl(
        upload.uploadUrl,
        videoBuffer,
        {
          ...(upload.uploadHeaders || {}),
          "Content-Type": "video/mp4"
        },
        timeoutMs
      );
      return upload;
    } catch (error) {
      lastError = error;

      if (!error.retryable || attempt === maxAttempts) {
        throw error;
      }

      await wait(attempt * 750);
    }
  }

  throw lastError;
}

async function convertWebmUrlToMp4(videoUrl) {
  const sourceUrl = validateS3WebmUrl(videoUrl);
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "pemi-transcode-"));
  const inputPath = path.join(tempDirectory, "input.webm");
  const outputPath = path.join(tempDirectory, "output.mp4");

  try {
    const webmBuffer = await downloadWebmVideo(sourceUrl);
    await writeFile(inputPath, webmBuffer);
    await runFfmpeg(inputPath, outputPath);
    const mp4Buffer = await readFile(outputPath);
    const filename = `pemi-converted-${Date.now()}.mp4`;
    return await uploadConvertedVideo(mp4Buffer, filename);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function normalizeAlgorithmResult(payload) {
  const result = payload?.result && typeof payload.result === "object" ? payload.result : {};
  const outputs = payload?.outputs || result?.outputs || result || {};

  const title =
    outputs?.title ||
    payload?.title ||
    result.title ||
    payload?.mood ||
    payload?.label ||
    payload?.emotion ||
    "Pemi's reading";

  const copy =
    outputs?.comment ||
    outputs?.suggestion ||
    outputs?.pet_behavior ||
    payload?.copy ||
    payload?.text ||
    payload?.message ||
    payload?.analysis ||
    payload?.description ||
    result.copy ||
    result.text ||
    result.message ||
    result.analysis ||
    result.comment ||
    result.suggestion ||
    result.pet_behavior;

  if (!copy) {
    throw new Error("Algorithm response did not include readable analysis text.");
  }

  // 提取宠物的心情，即 pet_emotion 中的 primary
  let primaryEmotion = "";
  if (Array.isArray(outputs?.pet_emotion) && outputs.pet_emotion.length > 0) {
    primaryEmotion = outputs.pet_emotion[0]?.primary || "";
  } else if (Array.isArray(payload?.pet_emotion) && payload.pet_emotion.length > 0) {
    primaryEmotion = payload.pet_emotion[0]?.primary || "";
  }

  return {
    title: String(title),
    copy: String(copy),
    mood: String(primaryEmotion || "")
  };
}

function getAlgorithmHeaders() {
  const headers = {
    "content-type": "application/json"
  };

  if (process.env.ALGORITHM_API_KEY) {
    const header = process.env.ALGORITHM_AUTH_HEADER || "Authorization";
    const scheme = process.env.ALGORITHM_AUTH_SCHEME ?? "Bearer";
    headers[header] = scheme
      ? `${scheme} ${process.env.ALGORITHM_API_KEY}`
      : process.env.ALGORITHM_API_KEY;
  }

  return headers;
}

function getPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestHttpsJson(url, options, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = options.body || "";
    const headers = {
      ...options.headers,
      ...(body ? { "content-length": Buffer.byteLength(body) } : {})
    };
    let settled = false;
    const fail = (error) => {
      if (!settled) {
        settled = true;
        error.retryable ??= true;
        reject(error);
      }
    };
    const request = https.request(
      url,
      {
        method: options.method || "GET",
        headers
      },
      (response) => {
        const chunks = [];
        let totalBytes = 0;

        response.on("data", (chunk) => {
          totalBytes += chunk.length;

          if (totalBytes > 1024 * 1024) {
            response.destroy(new Error("The API response is too large."));
            return;
          }

          chunks.push(chunk);
        });
        response.on("error", fail);
        response.on("end", () => {
          if (settled) {
            return;
          }

          settled = true;
          const rawBody = Buffer.concat(chunks, totalBytes).toString("utf8");
          let payload = null;

          if (rawBody) {
            try {
              payload = JSON.parse(rawBody);
            } catch (error) {
              resolve({ statusCode: response.statusCode || 0, payload: null });
              return;
            }
          }

          resolve({ statusCode: response.statusCode || 0, payload });
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("The HTTPS request timed out."));
    });
    request.on("error", fail);

    if (body) {
      request.write(body);
    }

    request.end();
  });
}

async function fetchAlgorithmJsonOnce(url, options = {}) {
  const requestTimeoutMs = getPositiveNumber(process.env.ALGORITHM_REQUEST_TIMEOUT_MS, 45_000);

  try {
    const { statusCode, payload } = await requestHttpsJson(
      url,
      {
        method: options.method,
        body: options.body,
        headers: {
          ...getAlgorithmHeaders(),
          ...options.headers
        }
      },
      requestTimeoutMs
    );

    if (statusCode < 200 || statusCode >= 300) {
      const detail = payload?.detail || payload?.error || payload?.message;
      const error = new Error(detail || `Algorithm request failed with ${statusCode}.`);
      error.retryable = statusCode === 429 || statusCode >= 500;
      throw error;
    }

    if (!payload || typeof payload !== "object") {
      throw new Error("Algorithm returned an unreadable response.");
    }

    return payload;
  } catch (error) {
    if (/timed out/i.test(error.message || "")) {
      const timeoutError = new Error("The algorithm request timed out.");
      timeoutError.retryable = true;
      throw timeoutError;
    }

    throw error;
  }
}

async function fetchAlgorithmJson(url, options = {}) {
  const maxAttempts = Math.max(
    1,
    Math.floor(getPositiveNumber(process.env.ALGORITHM_REQUEST_MAX_ATTEMPTS, 3))
  );
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchAlgorithmJsonOnce(url, options);
    } catch (error) {
      lastError = error;

      if (!error.retryable || attempt === maxAttempts) {
        throw error;
      }

      await wait(attempt * 750);
    }
  }

  throw lastError;
}

async function createAlgorithmTask(videoUrl) {
  const createUrl = process.env.ALGORITHM_CREATE_URL || process.env.ALGORITHM_API_URL;

  if (!createUrl) {
    throw new Error("ALGORITHM_CREATE_URL is not configured.");
  }

  const payload = await fetchAlgorithmJson(createUrl, {
    method: "POST",
    body: JSON.stringify({
      url: videoUrl
    })
  });

  if (!payload.task_id) {
    throw new Error("The algorithm did not return a task ID.");
  }

  return String(payload.task_id);
}

function getAlgorithmResultUrl(taskId) {
  const template = process.env.ALGORITHM_RESULT_URL_TEMPLATE;

  if (!template || !template.includes("{task_id}")) {
    throw new Error("ALGORITHM_RESULT_URL_TEMPLATE must include {task_id}.");
  }

  return template.replace("{task_id}", encodeURIComponent(taskId));
}

async function waitForAlgorithmResult(taskId) {
  const pollIntervalMs = getPositiveNumber(process.env.ALGORITHM_POLL_INTERVAL_MS, 3_000);
  const maxWaitMs = getPositiveNumber(process.env.ALGORITHM_MAX_WAIT_MS, 180_000);
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxWaitMs) {
    const payload = await fetchAlgorithmJson(getAlgorithmResultUrl(taskId), {
      method: "GET"
    });
    const status = String(payload.status || "").toLowerCase();

    if (["succeed", "succeeded", "success", "completed"].includes(status)) {
      return normalizeAlgorithmResult(payload);
    }

    if (["failed", "failure", "error"].includes(status)) {
      throw new Error(payload.detail || payload.error || "Pet analysis failed.");
    }

    if (!["pending", "processing", "running", "queued"].includes(status)) {
      throw new Error(`Unknown algorithm task status: ${payload.status || "missing"}.`);
    }

    await wait(pollIntervalMs);
  }

  throw new Error("Pet analysis is taking too long. Please try again.");
}

function getMockAnalysis(videoUrl) {
  return {
    title: "\"I have thoughts. Many snack-related thoughts.\"",
    copy: `Pemi received the 5-second clip and generated a test video URL successfully: ${videoUrl}. Connect ALGORITHM_CREATE_URL when the algorithm service is ready.`
  };
}

async function callAlgorithm(videoUrl) {
  if (process.env.MOCK_ALGORITHM === "true") {
    return getMockAnalysis(videoUrl);
  }

  const taskId = await createAlgorithmTask(videoUrl);
  return waitForAlgorithmResult(taskId);
}

async function handlePresignPetVideo(request, response) {
  try {
    const body = await readJsonBody(request);
    const filename = sanitizeUploadFilename(body.filename);
    const contentType = validateVideoContentType(body.content_type);
    const upload = await requestS3PresignedUpload(filename, contentType);

    sendJson(response, 200, upload);
  } catch (error) {
    const detail = error?.message || "Unknown error";
    console.error("S3 presign request failed:", detail);
    const configurationError = /not configured/i.test(detail);

    sendJson(response, configurationError ? 503 : 502, {
      error: configurationError
        ? "Video storage is not configured yet."
        : "Pemi could not prepare the video upload. Tap Try It Again.",
      detail
    });
  }
}

async function handleAnalyzePetUrl(request, response) {
  try {
    const body = await readJsonBody(request);
    const videoUrl = validateS3VideoUrl(body.video_url);
    const analysis = await callAlgorithm(videoUrl);

    sendJson(response, 200, {
      ...analysis,
      videoUrl
    });
  } catch (error) {
    const detail = error?.message || "Unknown error";
    console.error("Pet URL analysis failed:", detail);

    sendJson(response, 502, {
      error: "Pemi could not analyze this clip. Keep your pet visible and tap Try It Again.",
      detail
    });
  }
}

async function handleTranscodePetVideo(request, response) {
  try {
    const body = await readJsonBody(request);
    const upload = await convertWebmUrlToMp4(body.video_url);

    sendJson(response, 200, {
      videoUrl: upload.publicUrl,
      s3Key: upload.s3Key,
      contentType: "video/mp4"
    });
  } catch (error) {
    const detail = error?.message || "Unknown error";
    console.error("Pet video conversion failed:", detail);
    const configurationError = /not configured|could not start/i.test(detail);

    sendJson(response, configurationError ? 503 : 502, {
      error: configurationError
        ? "Video conversion is not configured on this server."
        : "Pemi could not prepare this clip for analysis. Tap Try It Again.",
      detail
    });
  }
}

function safeStaticPath(urlPath) {
  if (staticRoutes.has(urlPath)) {
    return path.join(__dirname, staticRoutes.get(urlPath));
  }

  if (urlPath.startsWith("/vendor/")) {
    const relativePath = decodeURIComponent(urlPath.slice("/vendor/".length));
    const filePath = path.resolve(onnxRuntimeDistDir, relativePath);

    if (filePath.startsWith(`${onnxRuntimeDistDir}${path.sep}`)) {
      return filePath;
    }
  }

  if (urlPath.startsWith("/assets/") || urlPath.startsWith("/uploads/")) {
    const decodedPath = decodeURIComponent(urlPath);
    const filePath = path.normalize(path.join(__dirname, decodedPath));

    if (filePath.startsWith(__dirname)) {
      return filePath;
    }
  }

  return null;
}

async function serveStatic(request, response) {
  const url = new URL(request.url, getRequestOrigin(request));
  const filePath = safeStaticPath(url.pathname);

  if (!filePath) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  try {
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      "content-type": contentTypes[ext] || "application/octet-stream",
      "content-length": fileStat.size
    };

    if (url.pathname.startsWith("/vendor/")) {
      headers["cache-control"] = "public, max-age=31536000, immutable";
    } else if (["/yolo26n.onnx", "/models/yolo26n.onnx"].includes(url.pathname)) {
      headers["cache-control"] = "public, max-age=86400";
    }

    response.writeHead(200, headers);

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/presign-pet-video") {
    await handlePresignPetVideo(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/analyze-pet-url") {
    await handleAnalyzePetUrl(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/transcode-pet-video") {
    await handleTranscodePetVideo(request, response);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    await serveStatic(request, response);
    return;
  }

  response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
  response.end("Method not allowed");
});

server.listen(port, () => {
  console.log(`Pemi demo is running at http://localhost:${port}`);
  console.log("Video storage: browser direct upload to Amazon S3");
});
