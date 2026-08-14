const GAUGE_CIRCUMFERENCE = 251.2;

const statusColor = (status) => {
  if (status === "healthy") return "var(--teal)";
  if (status === "diseased") return "var(--coral)";
  return "var(--amber)";
};
const statusVar = (status) => {
  if (status === "healthy") return "teal";
  if (status === "diseased") return "coral";
  return "amber";
};

// ---------- Nav ----------
const navItems = document.querySelectorAll(".nav-item");
const views = document.querySelectorAll(".view");
navItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    navItems.forEach((b) => b.classList.remove("is-active"));
    views.forEach((v) => v.classList.remove("is-active"));
    btn.classList.add("is-active");
    document.getElementById(`view-${btn.dataset.view}`).classList.add("is-active");
    if (btn.dataset.view === "history") loadHistory();
    if (btn.dataset.view === "stats") loadStats();
  });
});

// ---------- Dropzone ----------
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const dzEmpty = document.getElementById("dz-empty");
const dzPreview = document.getElementById("dz-preview");
const scanFrame = document.getElementById("scan-frame");
const btnAnalyze = document.getElementById("btn-analyze");
const btnClear = document.getElementById("btn-clear");
const modelStatus = document.getElementById("model-status");

let currentFile = null;

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  if (!file.type.startsWith("image/")) return;
  currentFile = file;
  const url = URL.createObjectURL(file);
  dzPreview.src = url;
  dzPreview.hidden = false;
  dzEmpty.hidden = true;
  scanFrame.hidden = true;
  btnAnalyze.disabled = false;
  btnClear.disabled = false;
  resetResult();
}

btnClear.addEventListener("click", () => {
  currentFile = null;
  fileInput.value = "";
  dzPreview.hidden = true;
  dzEmpty.hidden = false;
  scanFrame.hidden = true;
  btnAnalyze.disabled = true;
  btnClear.disabled = true;
  resetResult();
});

// ---------- Result rendering ----------
const resultEmpty = document.getElementById("result-empty");
const resultBody = document.getElementById("result-body");
const gaugeFill = document.getElementById("gauge-fill");
const gaugeValue = document.getElementById("gauge-value");
const verdictStatus = document.getElementById("verdict-status");
const verdictCrop = document.getElementById("verdict-crop");
const verdictCondition = document.getElementById("verdict-condition");
const top3List = document.getElementById("top3-list");
const metaMs = document.getElementById("meta-ms");
const metaId = document.getElementById("meta-id");

function resetResult() {
  resultBody.hidden = true;
  resultEmpty.hidden = false;
  gaugeFill.style.strokeDashoffset = GAUGE_CIRCUMFERENCE;
}

function renderResult(data) {
  const best = data.top3[0];
  const pct = best.confidence;
  const color = statusColor(best.parsed.status);

  resultEmpty.hidden = true;
  resultBody.hidden = false;

  requestAnimationFrame(() => {
    gaugeFill.style.stroke = color;
    gaugeFill.style.strokeDashoffset = GAUGE_CIRCUMFERENCE - (GAUGE_CIRCUMFERENCE * pct) / 100;
  });
  gaugeValue.textContent = `${pct}%`;
  gaugeValue.style.color = color;

  verdictStatus.textContent = best.parsed.status === "healthy" ? "Healthy" : best.parsed.status === "diseased" ? "Disease Detected" : "Uncertain";
  verdictStatus.style.background = `var(--${statusVar(best.parsed.status)}-dim)`;
  verdictStatus.style.color = color;
  verdictCrop.textContent = best.parsed.crop;
  verdictCondition.textContent = best.parsed.condition;

  top3List.innerHTML = "";
  data.top3.forEach((item) => {
    const row = document.createElement("div");
    row.className = "top3-row";
    row.innerHTML = `
      <span class="top3-name">${item.parsed.crop} — ${item.parsed.condition}</span>
      <span class="top3-pct">${item.confidence}%</span>
      <div class="top3-bar-track"><div class="top3-bar-fill" style="width:${item.confidence}%; background:${statusColor(item.parsed.status)}"></div></div>
    `;
    top3List.appendChild(row);
  });

  metaMs.textContent = `${data.infer_ms} ms`;
  metaId.textContent = data.scan_id;
}

// ---------- Analyze ----------
btnAnalyze.addEventListener("click", async () => {
  if (!currentFile) return;
  btnAnalyze.disabled = true;
  btnAnalyze.textContent = "Analyzing…";
  modelStatus.classList.add("busy");
  modelStatus.innerHTML = `<span class="pulse"></span> Running inference`;
  scanFrame.hidden = false;

  const formData = new FormData();
  formData.append("image", currentFile);

  try {
    const res = await fetch("/api/predict", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Prediction failed");
    renderResult(data);
    modelStatus.classList.remove("busy");
    modelStatus.classList.add("ready");
    modelStatus.innerHTML = `<span class="pulse"></span> Model ready`;
  } catch (err) {
    modelStatus.classList.remove("busy");
    modelStatus.innerHTML = `<span class="pulse"></span> ${err.message}`;
  } finally {
    scanFrame.hidden = true;
    btnAnalyze.disabled = false;
    btnAnalyze.textContent = "Run Diagnostic";
  }
});

// ---------- History ----------
async function loadHistory() {
  const res = await fetch("/api/history");
  const rows = await res.json();
  const body = document.getElementById("history-body");

  if (!rows.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="6">No scans yet — run a diagnostic to populate this log.</td></tr>`;
    return;
  }

  body.innerHTML = rows.map((r) => {
    const color = statusColor(r.status);
    const time = new Date(r.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `
      <tr>
        <td>${time}</td>
        <td>${r.crop}</td>
        <td>${r.condition}</td>
        <td><span class="status-chip" style="background:var(--${statusVar(r.status)}-dim); color:${color}">${r.status}</span></td>
        <td>${r.confidence}%</td>
        <td>${r.infer_ms} ms</td>
      </tr>
    `;
  }).join("");
}
document.getElementById("btn-refresh-history").addEventListener("click", loadHistory);

// ---------- Stats ----------
async function loadStats() {
  const res = await fetch("/api/stats");
  const s = await res.json();
  document.getElementById("st-total").textContent = s.total_scans;
  document.getElementById("st-healthy").textContent = s.healthy_count;
  document.getElementById("st-diseased").textContent = s.diseased_count;
  document.getElementById("st-conf").textContent = `${s.avg_confidence}%`;
  document.getElementById("st-latency").textContent = `${s.avg_infer_ms} ms`;
  document.getElementById("st-crop").textContent = s.top_crop;
  document.getElementById("st-condition").textContent = s.top_condition;
  document.getElementById("st-classes").textContent = s.classes_supported;
}

// initial model status ping
(async () => {
  try {
    const res = await fetch("/api/stats");
    if (res.ok) {
      modelStatus.classList.add("ready");
      modelStatus.innerHTML = `<span class="pulse"></span> Model ready`;
    }
  } catch {
    modelStatus.innerHTML = `<span class="pulse"></span> Server unreachable`;
  }
})();
