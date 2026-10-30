const { invoke } = window.__TAURI__.core;
const $ = (s) => document.querySelector(s);

const SUGGESTED = /(analytics|statistic|telemetry|tracking|crashlytics|bugreport|feedback|adservice|\.ads?(\.|$)|advert|promo|demo|partnercustomization|hotelmode|retail)/i;

const st = { pkgs: [], sel: new Set(), filter: "all", q: "", info: null, connected: false };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function show(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
}
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}
const toastErr = (err) => toast(tErr(err));
function busy(btn, on) { btn.classList.toggle("busy", on); btn.disabled = on; }

// ---- language
(function initLang() {
  const sel = $("#lang");
  sel.innerHTML = Object.entries(I18N).map(([k, v]) => `<option value="${k}">${v._name}</option>`).join("");
  sel.value = lang;
  applyStatic();
  sel.addEventListener("change", () => {
    setLang(sel.value);
    $("#modal").hidden = true;
    if (st.connected) { renderTv(); render(); }
  });
})();

// ---- connect
$("#connect-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#connect-btn"), msg = $("#connect-msg");
  msg.className = "msg info";
  msg.textContent = t("connecting");
  busy(btn, true);
  try {
    st.info = await invoke("connect", { host: $("#host").value });
    st.connected = true;
    msg.textContent = "";
    renderTv();
    show("dash");
    loadPackages();
  } catch (err) {
    msg.className = "msg";
    msg.textContent = tErr(err);
  } finally { busy(btn, false); }
});

function renderTv() {
  const i = st.info;
  $("#tv-brand").textContent = i.manufacturer || "Android TV";
  $("#tv-model").textContent = i.model || i.host;
  const chips = [`Android ${i.android}`, `SDK ${i.sdk}`, i.build, i.host].filter(Boolean);
  $("#tv-chips").innerHTML = chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("") +
    (i.secure === "0" || !i.secure ? `<span class="chip warn">${esc(t("adbNotSecure"))}</span>` : "");
}

$("#disconnect-btn").addEventListener("click", async () => {
  await invoke("disconnect");
  st.pkgs = []; st.sel.clear(); st.connected = false;
  show("connect");
});

// ---- packages
async function loadPackages() {
  $("#list").innerHTML = `<div class="loading"><span class="spin"></span>${esc(t("scanning"))}</div>`;
  try {
    st.pkgs = await invoke("scan");
    st.pkgs.forEach((p) => (p.suggested = SUGGESTED.test(p.name)));
    render();
  } catch (err) {
    $("#list").innerHTML = `<div class="loading">${esc(tErr(err))}</div>`;
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

function updateBar() {
  const n = st.sel.size;
  $("#sel-count").textContent = n;
  $("#review-btn").disabled = n === 0;
  $("#sel-hint").textContent = n ? t("selHint") : "";
}

function render() {
  const rows = visible().map((p) => `
    <div class="row ${st.sel.has(p.name) ? "sel" : ""} ${p.enabled ? "" : "off"}" data-n="${esc(p.name)}">
      <span class="check"></span>
      <span class="name" title="${esc(p.name)}">${esc(p.name)}</span>
      ${p.suggested && p.enabled ? `<span class="tag sug">${esc(t("suggested"))}</span>` : ""}
      ${p.system ? `<span class="tag sys">${esc(t("system"))}</span>` : ""}
      ${p.enabled ? "" : `<span class="tag dis">${esc(t("disabledTag"))}</span>`}
    </div>`).join("");
  $("#list").innerHTML = rows || `<div class="loading">${esc(t("noPackages"))}</div>`;
  updateBar();
}

$("#list").addEventListener("click", (e) => {
  const row = e.target.closest(".row");
  if (!row) return;
  const n = row.dataset.n;
  st.sel.has(n) ? st.sel.delete(n) : st.sel.add(n);
  row.classList.toggle("sel");
  updateBar();
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
    toast(t("importResult", { hit, total: names.length }));
  } catch (err) { toastErr(err); }
  e.target.value = "";
});

// ---- plan & apply
const line = (cls, mark, txt, extra = "") =>
  `<div class="item ${cls}"><span>${mark}</span><code>${esc(txt)}</code>${extra ? `<span>${esc(extra)}</span>` : ""}</div>`;
let pending = [];

$("#review-btn").addEventListener("click", async () => {
  const btn = $("#review-btn"); busy(btn, true);
  try {
    const plan = await invoke("plan", { packages: [...st.sel] });
    pending = plan.filter((x) => x.status === "ok").map((x) => x.name);
    const mark = { ok: "✓", skip: "⚠", absent: "–", disabled: "–" };
    $("#modal-title").textContent = t("reviewTitle");
    $("#modal-sub").textContent = t("reviewSub", { n: pending.length });
    $("#plan").innerHTML = plan.map((x) =>
      line(x.status === "ok" ? "ok" : x.status === "skip" ? "skip" : "muted", mark[x.status], x.name, x.reason ? t(`r.${x.reason}`) : "")).join("");
    $("#apk-pick").hidden = true;
    $("#modal-go").disabled = pending.length === 0;
    $("#modal-go").textContent = t("disableN", { n: pending.length });
    $("#modal-go").onclick = doApply;
    $("#modal").hidden = false;
  } catch (err) { toastErr(err); }
  finally { busy(btn, false); updateBar(); }
});
$("#modal-cancel").addEventListener("click", () => ($("#modal").hidden = true));

async function doApply() {
  const go = $("#modal-go"); busy(go, true);
  try {
    const res = await invoke("apply", { packages: pending });
    $("#modal").hidden = true;
    st.sel.clear();
    toast(t("appliedN", { ok: res.filter((r) => r.ok).length, total: res.length }));
    loadPackages();
  } catch (err) { toastErr(err); }
  finally { busy(go, false); }
}

// ---- restore
$("#restore-btn").addEventListener("click", async () => {
  let info;
  try { info = await invoke("recovery_info"); } catch (err) { return toastErr(err); }
  if (!info || info.to_enable.length === 0) return toast(t("nothingToRestore"));
  $("#modal-title").textContent = t("restoreTitle");
  $("#modal-sub").textContent = t("restoreSub", { n: info.to_enable.length });
  $("#plan").innerHTML = info.to_enable.map((n) => line("ok", "↺", n)).join("");
  $("#apk-pick").hidden = true;
  $("#modal-go").disabled = false;
  $("#modal-go").textContent = t("restoreAll");
  $("#modal-go").onclick = async () => {
    const go = $("#modal-go"); busy(go, true);
    try {
      const res = await invoke("restore");
      $("#modal").hidden = true;
      toast(t("restoredN", { n: res.filter((r) => r.ok).length }));
      loadPackages();
    } catch (err) { toastErr(err); }
    finally { busy(go, false); }
  };
  $("#modal").hidden = false;
});

// ---- launcher
let apkBytes = null;
async function openLauncher() {
  let s;
  try { s = await invoke("launcher_status"); } catch (err) { return toastErr(err); }
  const row = (ok, txt) => line(ok ? "ok" : "muted", ok ? "✓" : "–", txt);
  $("#modal-title").textContent = t("launcherTitle");
  $("#modal-sub").textContent = t("launcherSub");
  const renderStatus = (apkName) => {
    $("#plan").innerHTML =
      row(s.sdk_ok, t(s.sdk_ok ? "sdkOk" : "sdkBad")) +
      row(s.installed, t(s.installed ? "isInstalled" : "notInstalled")) +
      row(s.is_home, t("currentHome", { home: s.home || t("unknown") })) +
      row(s.stock !== null, s.stock ? t("stockDisable", { pkg: s.stock }) : t("noStock")) +
      row(s.has_apk || apkName, apkName ? t("apkChosen", { name: apkName }) : s.has_apk ? t("apkReady") : t("apkNone"));
    $("#modal-go").disabled = !s.sdk_ok || !(s.has_apk || apkBytes);
  };
  apkBytes = null; renderStatus(null);
  $("#apk-pick").hidden = false;
  $("#apk-file").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    apkBytes = Array.from(new Uint8Array(await f.arrayBuffer()));
    renderStatus(f.name);
  };
  $("#modal-go").textContent = t(s.installed ? "reinstall" : "install");
  $("#modal-go").onclick = async () => {
    const go = $("#modal-go"); busy(go, true);
    try {
      const log = await invoke("launcher_install", { apk: apkBytes });
      $("#plan").innerHTML = log.map((l) => row(true, tLog(l))).join("");
      toast(t("launcherDone"));
      go.classList.remove("busy"); go.disabled = true;
      loadPackages();
    } catch (err) { toastErr(err); busy(go, false); }
  };
  $("#modal").hidden = false;
}
$("#launcher-btn").addEventListener("click", openLauncher);
