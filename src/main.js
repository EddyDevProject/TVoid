const { invoke } = window.__TAURI__.core;
const $ = (s) => document.querySelector(s);

const SUGGESTED = /(analytics|statistic|telemetry|tracking|crashlytics|bugreport|feedback|adservice|\.ads?(\.|$)|advert|promo|demo|partnercustomization|hotelmode|retail)/i;

const st = { pkgs: [], sel: new Set(), filter: "all", q: "", info: null };

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function show(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
}
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}
function busy(btn, on) { btn.classList.toggle("busy", on); btn.disabled = on; }

// ---- connect
$("#connect-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#connect-btn"), msg = $("#connect-msg");
  msg.className = "msg info";
  msg.textContent = "Connessione… se il TV chiede «Consenti debug USB?», accetta.";
  busy(btn, true);
  try {
    st.info = await invoke("connect", { host: $("#host").value });
    msg.textContent = "";
    renderTv();
    show("dash");
    loadPackages();
  } catch (err) {
    msg.className = "msg";
    msg.textContent = String(err);
  } finally { busy(btn, false); }
});

function renderTv() {
  const i = st.info;
  $("#tv-brand").textContent = i.manufacturer || "Android TV";
  $("#tv-model").textContent = i.model || i.host;
  const chips = [`Android ${i.android}`, `SDK ${i.sdk}`, i.build, i.host].filter(Boolean);
  $("#tv-chips").innerHTML = chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("") +
    (i.secure === "0" || !i.secure ? `<span class="chip warn">ro.adb.secure non attivo</span>` : "");
}

$("#disconnect-btn").addEventListener("click", async () => {
  await invoke("disconnect");
  st.pkgs = []; st.sel.clear();
  show("connect");
});

// ---- packages
async function loadPackages() {
  $("#list").innerHTML = `<div class="loading"><span class="spin"></span>Scansione del TV…</div>`;
  try {
    st.pkgs = await invoke("scan");
    st.pkgs.forEach((p) => (p.suggested = SUGGESTED.test(p.name)));
    render();
  } catch (err) {
    $("#list").innerHTML = `<div class="loading">${esc(String(err))}</div>`;
  }
}

function visible() {
  const q = st.q.toLowerCase();
  return st.pkgs.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q)) return false;
    if (st.filter === "suggested") return p.suggested && p.enabled;
    if (st.filter === "enabled") return p.enabled;
    if (st.filter === "disabled") return !p.enabled;
    return true;
  });
}

function render() {
  const rows = visible().map((p) => `
    <div class="row ${st.sel.has(p.name) ? "sel" : ""} ${p.enabled ? "" : "off"}" data-n="${esc(p.name)}">
      <span class="check"></span>
      <span class="name" title="${esc(p.name)}">${esc(p.name)}</span>
      ${p.suggested && p.enabled ? `<span class="tag sug">consigliato</span>` : ""}
      ${p.system ? `<span class="tag sys">sistema</span>` : ""}
      ${p.enabled ? "" : `<span class="tag dis">disabilitato</span>`}
    </div>`).join("");
  $("#list").innerHTML = rows || `<div class="loading">Nessun pacchetto</div>`;
  const n = st.sel.size;
  $("#sel-count").textContent = n;
  $("#review-btn").disabled = n === 0;
  $("#sel-hint").textContent = n ? "· verranno controllati prima dell'applicazione" : "";
}

$("#list").addEventListener("click", (e) => {
  const row = e.target.closest(".row");
  if (!row) return;
  const n = row.dataset.n;
  st.sel.has(n) ? st.sel.delete(n) : st.sel.add(n);
  row.classList.toggle("sel");
  $("#sel-count").textContent = st.sel.size;
  $("#review-btn").disabled = st.sel.size === 0;
  $("#sel-hint").textContent = st.sel.size ? "· verranno controllati prima dell'applicazione" : "";
});
$("#search").addEventListener("input", (e) => { st.q = e.target.value; render(); });
$("#filters").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  st.filter = b.dataset.f;
  document.querySelectorAll("#filters button").forEach((x) => x.classList.toggle("on", x === b));
  render();
});
$("#import").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const names = await invoke("parse_list", { text: await f.text() });
    const known = new Set(st.pkgs.map((p) => p.name));
    let hit = 0;
    names.forEach((n) => { if (known.has(n)) { st.sel.add(n); hit++; } });
    render();
    toast(`${hit} pacchetti selezionati su ${names.length} nella lista`);
  } catch (err) { toast(String(err)); }
  e.target.value = "";
});

// ---- plan & apply
let pending = [];
$("#review-btn").addEventListener("click", async () => {
  const btn = $("#review-btn"); busy(btn, true);
  try {
    const plan = await invoke("plan", { packages: [...st.sel] });
    pending = plan.filter((x) => x.status === "ok").map((x) => x.name);
    const label = { ok: "✓", skip: "⚠", absent: "–", disabled: "–" };
    $("#modal-title").textContent = "Revisione";
    $("#modal-sub").textContent = `${pending.length} verranno disabilitati (mai disinstallati). Registro di ripristino salvato prima di toccare il TV.`;
    $("#plan").innerHTML = plan.map((x) => `
      <div class="item ${x.status === "ok" ? "ok" : x.status === "skip" ? "skip" : "muted"}">
        <span>${label[x.status]}</span><code>${esc(x.name)}</code><span>${esc(x.reason)}</span>
      </div>`).join("");
    $("#modal-go").disabled = pending.length === 0;
    $("#modal-go").textContent = `Disabilita ${pending.length}`;
    $("#modal-go").onclick = doApply;
    $("#modal").hidden = false;
  } catch (err) { toast(String(err)); }
  finally { busy(btn, false); st.sel.size || (btn.disabled = true); }
});
$("#modal-cancel").addEventListener("click", () => ($("#modal").hidden = true));

async function doApply() {
  const go = $("#modal-go"); busy(go, true);
  try {
    const res = await invoke("apply", { packages: pending });
    const ok = res.filter((r) => r.ok).length;
    $("#modal").hidden = true;
    st.sel.clear();
    toast(`${ok}/${res.length} disabilitati`);
    loadPackages();
  } catch (err) { toast(String(err)); }
  finally { busy(go, false); }
}

// ---- restore
$("#restore-btn").addEventListener("click", async () => {
  let info;
  try { info = await invoke("recovery_info"); } catch (err) { return toast(String(err)); }
  if (!info || info.to_enable.length === 0) return toast("Niente da ripristinare per questo TV");
  $("#modal-title").textContent = "Ripristino";
  $("#modal-sub").textContent = `Riabilita ${info.to_enable.length} pacchetti, la Home e le animazioni com'erano.`;
  $("#plan").innerHTML = info.to_enable.map((n) => `<div class="item ok"><span>↺</span><code>${esc(n)}</code></div>`).join("");
  $("#modal-go").disabled = false;
  $("#modal-go").textContent = "Ripristina tutto";
  $("#modal-go").onclick = async () => {
    const go = $("#modal-go"); busy(go, true);
    try {
      const res = await invoke("restore");
      $("#modal").hidden = true;
      toast(`${res.filter((r) => r.ok).length} pacchetti riabilitati`);
      loadPackages();
    } catch (err) { toast(String(err)); }
    finally { busy(go, false); }
  };
  $("#modal").hidden = false;
});

// ---- launcher
let apkBytes = null;
async function openLauncher() {
  let s;
  try { s = await invoke("launcher_status"); } catch (err) { return toast(String(err)); }
  const line = (ok, txt) => `<div class="item ${ok ? "ok" : "muted"}"><span>${ok ? "✓" : "–"}</span><code>${esc(txt)}</code></div>`;
  $("#modal-title").textContent = "Launcher";
  $("#modal-sub").textContent = "Installa la schermata Home alternativa. Il launcher stock viene solo disabilitato e «Ripristina» lo rimette com'era.";
  const render = (apkName) => {
    $("#plan").innerHTML =
      line(s.sdk_ok, s.sdk_ok ? "Android compatibile (SDK 26+)" : "Android troppo vecchio per il launcher") +
      line(s.installed, s.installed ? "Launcher già installato" : "Launcher non installato") +
      line(s.is_home, `Home attuale: ${s.home || "sconosciuta"}`) +
      line(s.stock !== null, s.stock ? `Launcher stock da disabilitare: ${s.stock}` : "Nessun launcher stock noto: la Home verrà solo impostata") +
      line(s.has_apk || apkName, apkName ? `APK scelto: ${apkName}` : s.has_apk ? "APK pronto in ~/.tvoid/launcher.apk" : "Nessun APK: scegline uno (vedi README)");
    $("#modal-go").disabled = !s.sdk_ok || !(s.has_apk || apkBytes);
  };
  apkBytes = null; render(null);
  $("#apk-pick").hidden = false;
  $("#apk-file").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    apkBytes = Array.from(new Uint8Array(await f.arrayBuffer()));
    render(f.name);
  };
  $("#modal-go").textContent = s.installed ? "Reinstalla" : "Installa";
  $("#modal-go").onclick = async () => {
    const go = $("#modal-go"); busy(go, true);
    try {
      const log = await invoke("launcher_install", { apk: apkBytes });
      $("#plan").innerHTML = log.map((l) => line(true, l)).join("");
      toast("Launcher installato");
      $("#modal-go").disabled = true;
      loadPackages();
    } catch (err) { toast(String(err)); }
    finally { busy(go, false); }
  };
  $("#modal").hidden = false;
}
$("#launcher-btn").addEventListener("click", openLauncher);
// hide the APK picker for the other dialogs
new MutationObserver(() => { if ($("#modal").hidden) $("#apk-pick").hidden = true; }).observe($("#modal"), { attributes: true, attributeFilter: ["hidden"] });
