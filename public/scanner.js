// Scanner du QR code de table : ouvre la caméra arrière et reconnaît la table.
// On lit seulement etage + table dans le code : l'app ne suit jamais le lien d'un QR inconnu.

const SCAN = { stream: null, timer: null, next: null, run: 0, detector: null, canvas: null, badUntil: 0 };
const SCAN_HINT = "Place le QR code de ta table dans le cadre";

const scanMsg = (text, isError = false) => {
  $("scan-msg").textContent = text;
  $("scan-msg").classList.toggle("error", isError);
};

function tableFromQr(text) {
  try {
    const u = new URL(text);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    const etage = u.searchParams.get("etage"), table = u.searchParams.get("table");
    if (!/^\d{1,3}$/.test(etage || "") || !/^\d{1,3}$/.test(table || "")) return null;
    const found = { floorId: Number(etage), table: String(Number(table)), at: Date.now() };
    return validPlace(found) ? found : null;
  } catch { return null; }
}

let jsQrLoading = null;
function loadJsQr() {
  if (window.jsQR) return Promise.resolve();
  if (!jsQrLoading) {
    jsQrLoading = new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = "vendor/jsQR.js?v=21";
      s.onload = ok;
      s.onerror = () => { jsQrLoading = null; ko(new Error("lecteur")); };
      document.head.appendChild(s);
    });
  }
  return jsQrLoading;
}

// Lecteur intégré au téléphone si possible, sinon jsQR
async function prepareDecoder() {
  if (SCAN.detector) return;
  if ("BarcodeDetector" in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes("qr_code")) {
        SCAN.detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        return;
      }
    } catch {}
  }
  await loadJsQr();
}

async function readFrame() {
  const v = $("scan-video");
  if (v.readyState < 2 || !v.videoWidth) return null;
  if (SCAN.detector) {
    const codes = await SCAN.detector.detect(v);
    return codes.length ? codes[0].rawValue : null;
  }
  const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
  const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
  if (!SCAN.canvas) SCAN.canvas = document.createElement("canvas");
  SCAN.canvas.width = w;
  SCAN.canvas.height = h;
  const ctx = SCAN.canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(v, 0, 0, w, h);
  const code = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
  return code ? code.data : null;
}

function acceptCode(text) {
  const found = tableFromQr(text);
  if (!found) {
    SCAN.badUntil = Date.now() + 2500;
    scanMsg("Ce QR code n'est pas une table du 707", true);
    return false;
  }
  place = found;
  store.set(PLACE_KEY, JSON.stringify(found));
  renderPlace();
  const next = SCAN.next;
  closeScanner();
  if (navigator.vibrate) navigator.vibrate(80);
  toast(`${floorName(found.floorId)} · Table ${found.table}`);
  if (next) next();
  return true;
}

async function scanTick(run) {
  if (run !== SCAN.run) return;
  try {
    const text = await readFrame();
    if (run !== SCAN.run) return;
    if (text && acceptCode(text)) return;
    if (!text && SCAN.badUntil && Date.now() > SCAN.badUntil) { SCAN.badUntil = 0; scanMsg(SCAN_HINT); }
  } catch {}
  SCAN.timer = setTimeout(() => scanTick(run), 180);
}

function cameraError(err) {
  if (!window.isSecureContext) return "La caméra marche seulement sur le site en https.";
  if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
    return "Autorise la caméra dans ton navigateur pour scanner ta table.";
  }
  if (err && (err.name === "NotFoundError" || err.name === "OverconstrainedError")) return "Aucune caméra trouvée sur cet appareil.";
  if (err && err.name === "NotReadableError") return "La caméra est utilisée par une autre application.";
  return "Impossible d'ouvrir la caméra.";
}

async function startCamera() {
  const run = ++SCAN.run;
  $("scan-retry").hidden = true;
  scanMsg(SCAN_HINT);
  try {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("camera");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false,
    });
    if (run !== SCAN.run) return stream.getTracks().forEach(t => t.stop());
    SCAN.stream = stream;
    const v = $("scan-video");
    v.srcObject = stream;
    await v.play();
    await prepareDecoder();
    if (run === SCAN.run) scanTick(run);
  } catch (err) {
    if (run !== SCAN.run) return;
    stopCamera();
    scanMsg(cameraError(err), true);
    $("scan-retry").hidden = false;
  }
}

function stopCamera() {
  clearTimeout(SCAN.timer);
  if (SCAN.stream) SCAN.stream.getTracks().forEach(t => t.stop());
  SCAN.stream = null;
  $("scan-video").srcObject = null;
}

function openScanner(next = null) {
  SCAN.next = next;
  SCAN.badUntil = 0;
  closeSheet();
  $("scanner").hidden = false;
  document.body.classList.add("scanning");
  startCamera();
}

function closeScanner() {
  SCAN.run++;
  SCAN.next = null;
  stopCamera();
  $("scanner").hidden = true;
  document.body.classList.remove("scanning");
}

$("scan-btn").addEventListener("click", () => openScanner());
$("scan-close").addEventListener("click", closeScanner);
$("scan-retry").addEventListener("click", startCamera);
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("scanner").hidden) closeScanner(); });
// Téléphone verrouillé ou app quittée : la caméra s'éteint
document.addEventListener("visibilitychange", () => { if (document.hidden && !$("scanner").hidden) closeScanner(); });
