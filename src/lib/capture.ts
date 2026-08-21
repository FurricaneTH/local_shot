import type { CaptureOptions, Region } from "../types";

interface CaptureResult {
  blob: Blob;
  durationMs: number;
  extension: "png" | "webm" | "mp4";
}

export function webScreenCaptureAvailable() {
  return Boolean(navigator.mediaDevices?.getDisplayMedia);
}

function regionPixels(video: HTMLVideoElement, region?: Region) {
  const value = region ?? { x: 0, y: 0, width: 100, height: 100 };
  return {
    sx: Math.round((video.videoWidth * value.x) / 100),
    sy: Math.round((video.videoHeight * value.y) / 100),
    sw: Math.max(2, Math.round((video.videoWidth * value.width) / 100)),
    sh: Math.max(2, Math.round((video.videoHeight * value.height) / 100))
  };
}

async function loadedVideo(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) await new Promise<void>((resolve) => video.addEventListener("loadedmetadata", () => resolve(), { once: true }));
  return video;
}

async function getStreams(options: CaptureOptions) {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Ekran yakalama API'si bu sistemde kullanılamıyor.");
  const display = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: options.source === "window" ? "window" : "monitor", frameRate: 30 },
    audio: false
  });
  let microphone: MediaStream | undefined;
  if (options.microphone) {
    if (!navigator.mediaDevices.getUserMedia) throw new Error("Mikrofon API'si bu sistemde kullanılamıyor.");
    microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  }
  return { display, microphone };
}

function stopTracks(...streams: Array<MediaStream | undefined>) {
  streams.forEach((stream) => stream?.getTracks().forEach((track) => track.stop()));
}

export async function takeScreenshot(options: CaptureOptions): Promise<CaptureResult> {
  const { display, microphone } = await getStreams({ ...options, microphone: false });
  try {
    const video = await loadedVideo(display);
    const { sx, sy, sw, sh } = regionPixels(video, options.source === "region" ? options.region : undefined);
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d")?.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Görüntü kodlanamadı.")), "image/png")
    );
    return { blob, durationMs: 0, extension: "png" };
  } finally {
    stopTracks(display, microphone);
  }
}

export async function recordVideo(
  options: CaptureOptions,
  onReady: (stop: () => void) => void
): Promise<CaptureResult> {
  if (!window.MediaRecorder) throw new Error("Video kaydı bu sistemin WebView sürümünde kullanılamıyor.");
  let mimeType = "";
  let extension: "webm" | "mp4" = "webm";
  for (const candidate of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus"]) {
    if (MediaRecorder.isTypeSupported(candidate)) { mimeType = candidate; break; }
  }
  if (!mimeType) {
    for (const candidate of ["video/mp4;codecs=h264,aac", "video/mp4"]) {
      if (MediaRecorder.isTypeSupported(candidate)) { mimeType = candidate; extension = "mp4"; break; }
    }
  }
  if (!mimeType) throw new Error("Bu WebView H.264/MP4 veya WebM kaydını desteklemiyor.");
  const { display, microphone } = await getStreams(options);
  let outputStream = display;
  let animation = 0;
  try {
    if (options.source === "region") {
      const video = await loadedVideo(display);
      const pixels = regionPixels(video, options.region);
      const canvas = document.createElement("canvas");
      canvas.width = pixels.sw;
      canvas.height = pixels.sh;
      const context = canvas.getContext("2d");
      const draw = () => {
        context?.drawImage(video, pixels.sx, pixels.sy, pixels.sw, pixels.sh, 0, 0, pixels.sw, pixels.sh);
        animation = requestAnimationFrame(draw);
      };
      draw();
      outputStream = canvas.captureStream(30);
    }
    if (microphone) {
      for (const track of microphone.getAudioTracks()) outputStream.addTrack(track);
    }
    const recorder = new MediaRecorder(outputStream, { mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks: BlobPart[] = [];
    const started = performance.now();
    const complete = new Promise<CaptureResult>((resolve, reject) => {
      recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
      recorder.addEventListener("error", () => reject(new Error("Kayıt sırasında medya kodlayıcı hatası oluştu.")));
      recorder.addEventListener("stop", () => resolve({
        blob: new Blob(chunks, { type: mimeType }),
        durationMs: performance.now() - started,
        extension
      }));
    });
    const videoTrack = display.getVideoTracks()[0];
    videoTrack?.addEventListener("ended", () => { if (recorder.state !== "inactive") recorder.stop(); });
    recorder.start(1000);
    onReady(() => { if (recorder.state !== "inactive") recorder.stop(); });
    return await complete;
  } finally {
    cancelAnimationFrame(animation);
    stopTracks(display, microphone, outputStream);
  }
}

export async function blobBytes(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}
