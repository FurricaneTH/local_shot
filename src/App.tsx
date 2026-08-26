import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Aperture from "lucide-react/dist/esm/icons/aperture.js";
import Check from "lucide-react/dist/esm/icons/check.js";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.js";
import CircleStop from "lucide-react/dist/esm/icons/circle-stop.js";
import Clipboard from "lucide-react/dist/esm/icons/clipboard.js";
import Crop from "lucide-react/dist/esm/icons/crop.js";
import FileText from "lucide-react/dist/esm/icons/file-text.js";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open.js";
import Highlighter from "lucide-react/dist/esm/icons/highlighter.js";
import ImageIcon from "lucide-react/dist/esm/icons/image.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import Maximize2 from "lucide-react/dist/esm/icons/maximize-2.js";
import Mic from "lucide-react/dist/esm/icons/mic.js";
import Monitor from "lucide-react/dist/esm/icons/monitor.js";
import MousePointer2 from "lucide-react/dist/esm/icons/mouse-pointer-2.js";
import Play from "lucide-react/dist/esm/icons/play.js";
import Plus from "lucide-react/dist/esm/icons/plus.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import Save from "lucide-react/dist/esm/icons/save.js";
import Scissors from "lucide-react/dist/esm/icons/scissors.js";
import Sparkles from "lucide-react/dist/esm/icons/sparkles.js";
import Square from "lucide-react/dist/esm/icons/square.js";
import Timer from "lucide-react/dist/esm/icons/timer.js";
import Video from "lucide-react/dist/esm/icons/video.js";
import Volume2 from "lucide-react/dist/esm/icons/volume-2.js";
import X from "lucide-react/dist/esm/icons/x.js";
import { backend } from "./lib/backend";
import { blobBytes, recordVideo, takeScreenshot, webScreenCaptureAvailable } from "./lib/capture";
import { clampRegion, formatDuration, pathName, safeFileName, validateRecipe } from "./lib/format";
import type { Annotation, CaptureKind, CaptureSource, EditRecipe, ExportFormat, MediaItem, Region } from "./types";
import { DEFAULT_RECIPE } from "./types";
import "./styles.css";

type Notice = { tone: "success" | "error" | "info"; message: string; action?: () => void; actionLabel?: string } | null;

const initialRegion: Region = { x: 10, y: 10, width: 80, height: 80 };

function mediaUrl(path: string) {
  return "__TAURI_INTERNALS__" in window ? convertFileSrc(path) : path;
}

function CaptureButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button className={`segmented-button ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function NoticeBar({ notice, close }: { notice: Notice; close: () => void }) {
  if (!notice) return null;
  return (
    <div className={`notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
      {notice.tone === "success" ? <Check size={17} /> : notice.tone === "error" ? <RefreshCw size={17} /> : <Sparkles size={17} />}
      <span>{notice.message}</span>
      {notice.action && <button onClick={notice.action}>{notice.actionLabel ?? "Retry"}</button>}
      <button className="icon-button" aria-label="Bildirimi kapat" onClick={close}><X size={16} /></button>
    </div>
  );
}

function LibraryCard({ item, active, onClick }: { item: MediaItem; active: boolean; onClick: () => void }) {
  return (
    <button className={`library-card ${active ? "active" : ""}`} onClick={onClick}>
      <div className="thumb">
        {item.kind === "video" ? <Video className="thumb-fallback" size={20} /> : <ImageIcon className="thumb-fallback" size={20} />}
        {item.posterPath && <img src={mediaUrl(item.posterPath)} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
        {item.kind === "video" && <span className="duration">{formatDuration(item.durationMs)}</span>}
      </div>
      <div className="card-copy"><strong>{item.title}</strong><span>{new Date(item.createdAt).toLocaleDateString("tr-TR", { day: "numeric", month: "short" })} · {item.source}</span></div>
      <ChevronRight size={16} />
    </button>
  );
}

function Editor({ item, onChanged, notify }: { item: MediaItem; onChanged: (value: MediaItem) => void; notify: (value: Notice) => void }) {
  const [recipe, setRecipe] = useState<EditRecipe>(item.recipe ?? DEFAULT_RECIPE);
  const [title, setTitle] = useState(item.title);
  const [annotationText, setAnnotationText] = useState("");
  const [currentMs, setCurrentMs] = useState(0);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => { setRecipe(item.recipe ?? DEFAULT_RECIPE); setTitle(item.title); setPreviewFailed(false); }, [item]);

  const updateCrop = (key: keyof Region, value: number) => setRecipe((current) => ({ ...current, crop: clampRegion({ ...current.crop, [key]: value }) }));
  const addAnnotation = (kind: Annotation["kind"], x = 50, y = 50) => {
    const text = kind === "text" ? annotationText.trim() : "Key moment";
    if (!text) return notify({ tone: "error", message: "Note text cannot be empty." });
    const annotation: Annotation = { id: crypto.randomUUID(), kind, text, x, y, startMs: currentMs, endMs: currentMs + 3000 };
    setRecipe((current) => ({ ...current, annotations: [...current.annotations, annotation] }));
    setAnnotationText("");
  };
  const save = async () => {
    const cleanTitle = safeFileName(title);
    if (!cleanTitle) return;
    setSaving(true);
    try {
      const valid = validateRecipe(recipe);
      await backend.updateRecipe(item.id, cleanTitle, valid);
      onChanged({ ...item, title: cleanTitle, recipe: valid });
      notify({ tone: "success", message: "Non-destructive edits saved." });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "Could not save edits.", action: save });
    } finally { setSaving(false); }
  };
  const exportItem = async (format: ExportFormat) => {
    setExporting(format);
    try {
      await save();
      const result = await backend.exportMedia(item.id, safeFileName(title), format);
      notify({ tone: "success", message: `Exported: ${pathName(result.mediaPath)}` });
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "Render failed.", action: () => exportItem(format) });
    } finally { setExporting(null); }
  };
  const previewClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!recipe.cursorHighlight) return;
    const rect = event.currentTarget.getBoundingClientRect();
    addAnnotation("spotlight", Math.round(((event.clientX - rect.left) / rect.width) * 100), Math.round(((event.clientY - rect.top) / rect.height) * 100));
  };

  return (
    <main className="workspace">
      <div className="editor-topbar">
        <div><span className="eyebrow">PREVIEW</span><input aria-label="Recording title" value={title} maxLength={96} onChange={(event) => setTitle(event.target.value)} /></div>
        <div className="top-actions">
          <button className="secondary" onClick={save} disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} Save</button>
          <div className="export-group">
            <button onClick={() => exportItem("h264")} disabled={!!exporting}>{exporting === "h264" ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />} Export MP4</button>
            <button className="format-button" aria-label="Export WebM" onClick={() => exportItem("webm")} disabled={!!exporting}>WebM</button>
          </div>
        </div>
      </div>

      <div className="editor-grid">
        <section className="stage-card">
          <div className="stage" onClick={previewClick}>
            {previewFailed ? (
              <div className="media-error">
                <ImageIcon size={30} />
                <strong>Preview unavailable</strong>
                <span>The file was saved. Open its location in Finder.</span>
                <button onClick={(event) => { event.stopPropagation(); void backend.revealPath(item.mediaPath); }}><FolderOpen size={15} /> Show in Finder</button>
              </div>
            ) : item.kind === "video" ? (
              <video ref={videoRef} src={mediaUrl(item.mediaPath)} controls onError={() => setPreviewFailed(true)} onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)} />
            ) : <img src={mediaUrl(item.mediaPath)} alt={item.title} onError={() => setPreviewFailed(true)} />}
            {recipe.annotations.filter((note) => currentMs >= note.startMs && currentMs <= note.endMs).map((note) => (
              <div key={note.id} className={note.kind === "spotlight" ? "spotlight" : "text-note"} style={{ left: `${note.x}%`, top: `${note.y}%` }}>{note.kind === "text" && note.text}</div>
            ))}
          </div>
          <div className="stage-meta">
            {item.kind === "video" ? <span><Timer size={15} /> {formatDuration(currentMs)} / {formatDuration(item.durationMs)}</span> : <span />}
            <span><Scissors size={15} /> Original preserved</span>
          </div>
        </section>

        <aside className="inspector">
          <div className="inspector-heading"><strong>Edit</strong><span>Optional</span></div>
          <section>
            <h3><Maximize2 size={17} /> Zoom</h3>
            <label className="range-label"><input aria-label="Zoom" type="range" min="1" max="4" step="0.1" value={recipe.zoom} onChange={(event) => setRecipe({ ...recipe, zoom: Number(event.target.value) })} /><strong>{recipe.zoom.toFixed(1)}×</strong></label>
          </section>
          <section>
            <h3><Highlighter size={17} /> Highlight & note</h3>
            <label className="toggle-row"><span>Click the preview to highlight</span><input type="checkbox" checked={recipe.cursorHighlight} onChange={(event) => setRecipe({ ...recipe, cursorHighlight: event.target.checked })} /></label>
            <div className="annotation-input"><input aria-label="Note text" placeholder="Add a short note…" maxLength={500} value={annotationText} onChange={(event) => setAnnotationText(event.target.value)} /><button aria-label="Add note" onClick={() => addAnnotation("text")}><Plus size={18} /></button></div>
            <div className="annotation-list">
              {recipe.annotations.length === 0 ? <p>No notes yet.</p> : recipe.annotations.map((note) => <button key={note.id} onClick={() => setRecipe({ ...recipe, annotations: recipe.annotations.filter((item) => item.id !== note.id) })}><span>{formatDuration(note.startMs)} · {note.text}</span><X size={14} /></button>)}
            </div>
          </section>
          <details className="advanced-panel">
            <summary><span><Crop size={16} /> Crop settings</span><ChevronRight size={15} /></summary>
            <div className="field-grid">
              {(["x", "y", "width", "height"] as const).map((key) => <label key={key}><span>{key === "width" ? "Genişlik" : key === "height" ? "Yükseklik" : key.toUpperCase()} (%)</span><input type="number" min="0" max="100" value={recipe.crop[key]} onChange={(event) => updateCrop(key, Number(event.target.value))} /></label>)}
            </div>
          </details>
          <details className="advanced-panel companion-files">
            <summary><span><FileText size={16} /> Companion files</span><ChevronRight size={15} /></summary>
            <button onClick={() => backend.revealPath(item.transcriptPath)}><span>Transcript</span><FolderOpen size={15} /></button>
            <button onClick={() => backend.revealPath(item.summaryPath)}><span>Markdown summary</span><FolderOpen size={15} /></button>
          </details>
        </aside>
      </div>
    </main>
  );
}

export default function App() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [kind, setKind] = useState<CaptureKind>("video");
  const [source, setSource] = useState<CaptureSource>("screen");
  const [microphone, setMicrophone] = useState(true);
  const [region, setRegion] = useState(initialRegion);
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const stopRef = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await backend.listMedia();
      setItems(result);
      setSelectedId((current) => current && result.some((item) => item.id === current) ? current : result[0]?.id ?? null);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Could not load recordings.", action: load });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (recordingSince === null) return;
    const timer = window.setInterval(() => setElapsed(performance.now() - recordingSince), 200);
    return () => clearInterval(timer);
  }, [recordingSince]);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void listen("capture://stop-requested", () => stopRef.current?.()).then((value) => { unlisten = value; });
    return () => unlisten?.();
  }, []);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const persistCapture = async (blob: Blob, durationMs: number, extension: "png" | "webm" | "mp4") => {
    const title = `${kind === "video" ? "Recording" : "Screenshot"} ${new Date().toLocaleString("en-US")}`;
    const item = await backend.saveCapture({ bytes: await blobBytes(blob), extension, title, kind, source, durationMs: Math.round(durationMs) });
    setItems((current) => [item, ...current]);
    setSelectedId(item.id);
    setNotice({ tone: "success", message: `${item.title} saved locally.` });
  };
  const acceptNativeCapture = (item: MediaItem) => {
    setItems((current) => [item, ...current.filter((value) => value.id !== item.id)]);
    setSelectedId(item.id);
    setNotice({ tone: "success", message: `${item.title} saved locally.` });
  };
  const startCapture = async () => {
    setNotice({ tone: "info", message: "Opening the system capture picker…" });
    const options = { kind, source, microphone: kind === "video" && microphone, region };
    const title = `${kind === "video" ? "Recording" : "Screenshot"} ${new Date().toLocaleString("en-US")}`;
    const nativeCapture = "__TAURI_INTERNALS__" in window && !webScreenCaptureAvailable();
    try {
      if (nativeCapture && kind === "screenshot") {
        acceptNativeCapture(await backend.nativeScreenshot({ title, source, microphone: false }));
        return;
      }
      if (nativeCapture) {
        await backend.nativeStartRecording({ title, source, microphone });
        setRecordingSince(performance.now());
        stopRef.current = () => {
          if (!stopRef.current) return;
          stopRef.current = null;
          void backend.nativeStopRecording().then(acceptNativeCapture).catch((error) => {
            setNotice({ tone: "error", message: error instanceof Error ? error.message : "Local recording could not be completed.", action: startCapture });
          }).finally(() => {
            setRecordingSince(null);
            setElapsed(0);
          });
        };
        setNotice({ tone: "info", message: source === "screen" ? "Local screen recording started." : "Choose an area in the macOS picker." });
        return;
      }
      if (kind === "screenshot") {
        const result = await takeScreenshot(options);
        await persistCapture(result.blob, result.durationMs, result.extension);
      } else {
        setRecordingSince(performance.now());
        const result = await recordVideo(options, (stop) => { stopRef.current = stop; });
        stopRef.current = null;
        setRecordingSince(null);
        setElapsed(0);
        await persistCapture(result.blob, result.durationMs, result.extension);
      }
    } catch (error) {
      stopRef.current = null;
      setRecordingSince(null);
      const message = error instanceof DOMException && error.name === "NotAllowedError" ? "Screen or microphone permission was denied. Allow it in System Settings and try again." : error instanceof Error ? error.message : "Could not start capture.";
      const needsSettings = message.includes("System Settings") || message.includes("screen recording permission");
      setNotice({
        tone: "error",
        message,
        action: needsSettings ? () => { void backend.openScreenCaptureSettings(); } : startCapture,
        actionLabel: needsSettings ? "Open Settings" : "Retry"
      });
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand"><div className="brand-mark"><Aperture size={20} /></div><div><strong>LocalCut</strong><span>Your captures stay on this Mac</span></div></div>
        <div className="privacy-pill"><span /> Local &amp; private</div>
      </header>
      <NoticeBar notice={notice} close={() => setNotice(null)} />
      {recordingSince !== null && (
        <div className="recording-pill" role="timer"><span className="recording-dot" /><strong>KAYIT</strong><time>{formatDuration(elapsed)}</time><button onClick={() => stopRef.current?.()}><CircleStop size={17} /> Durdur</button></div>
      )}
      <div className="app-body">
        <aside className="sidebar">
          <section className="capture-panel">
            <span className="eyebrow">CAPTURE</span>
            <div className="kind-switch"><CaptureButton icon={<Video size={17} />} label="Video" active={kind === "video"} onClick={() => setKind("video")} /><CaptureButton icon={<ImageIcon size={17} />} label="Screenshot" active={kind === "screenshot"} onClick={() => setKind("screenshot")} /></div>
            <label className="field-label">Capture source</label>
            <div className="source-grid">
              <CaptureButton icon={<Monitor size={17} />} label="Screen" active={source === "screen"} onClick={() => setSource("screen")} />
              <CaptureButton icon={<Square size={17} />} label="Window" active={source === "window"} onClick={() => setSource("window")} />
              <CaptureButton icon={<Crop size={17} />} label="Region" active={source === "region"} onClick={() => setSource("region")} />
            </div>
            {source === "region" && <div className="region-fields">{(["x", "y", "width", "height"] as const).map((key) => <label key={key}>{key[0].toUpperCase()}<input aria-label={`Region ${key}`} type="number" min="0" max="100" value={region[key]} onChange={(event) => setRegion(clampRegion({ ...region, [key]: Number(event.target.value) }))} /></label>)}</div>}
            <label className={`mic-row ${kind === "screenshot" ? "disabled" : ""}`}><span><Mic size={17} /><span><strong>Microphone</strong><small>{kind === "screenshot" ? "Not available for screenshots" : "Optional audio"}</small></span></span><input type="checkbox" disabled={kind === "screenshot"} checked={microphone} onChange={(event) => setMicrophone(event.target.checked)} /></label>
            <button className="capture-cta" onClick={startCapture} disabled={recordingSince !== null}>{kind === "video" ? <><span className="record-icon" /> Start recording</> : <><Aperture size={18} /> Take screenshot</>}</button>
          </section>
          <div className="library-heading"><span className="eyebrow">RECORDINGS</span><span>{items.length}</span></div>
          <div className="library-list">
            {loading ? Array.from({ length: 3 }).map((_, index) => <div className="skeleton-card" key={index}><i /><span /></div>) : items.length === 0 ? <div className="empty-library"><div><Volume2 size={21} /></div><strong>No recordings yet</strong><p>Your first screenshot or video will appear here.</p></div> : items.map((item) => <LibraryCard key={item.id} item={item} active={item.id === selectedId} onClick={() => setSelectedId(item.id)} />)}
          </div>
        </aside>
        {selected ? <Editor item={selected} notify={setNotice} onChanged={(value) => setItems((current) => current.map((item) => item.id === value.id ? value : item))} /> : (
          <main className="welcome-state"><div className="welcome-art"><div className="frame frame-one" /><div className="frame frame-two" /><MousePointer2 size={26} /></div><h1>Capture your screen.</h1><p>Choose a screenshot or video on the left. Then crop it, add notes, and save it locally.</p><button onClick={startCapture}><Aperture size={18} /> Start your first capture</button></main>
        )}
      </div>
      <footer><span>Never uploaded to the cloud.</span>{selected && <div><button onClick={() => backend.copyPath(selected.mediaPath)}><Clipboard size={14} /> Copy location</button><button onClick={() => backend.revealPath(selected.mediaPath)}><FolderOpen size={14} /> Show in Finder</button></div>}</footer>
    </div>
  );
}
