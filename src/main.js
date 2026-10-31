const { invoke } = window.__TAURI__.core;
const $ = (s) => document.querySelector(s);

const SUGGESTED = /(analytics|statistic|telemetry|tracking|crashlytics|bugreport|feedback|adservice|\.ads?(\.|$)|advert|promo|demo|partnercustomization|hotelmode|retail)/i;

const st = { pkgs: [], sel: new Set(), filter: "all", q: "", info: null, connected: false,
  index: {},      // package -> { c: lists that disable it, n: most common note }
  listNotes: {},  // package -> { note, group } from the model lists the user picked
};

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
  st.pkgs = []; st.sel.clear(); st.listNotes = {}; st.connected = false;
  show("connect");
});

// ---- packages
async function loadPackages() {
  $("#list").innerHTML = `<div class="loading"><span class="spin"></span>${esc(t("scanning"))}</div>`;
  try {
    if (!Object.keys(st.index).length) {
      try { st.index = await (await fetch("packages.json")).json(); } catch (_) { /* notes are optional */ }
    }
    st.pkgs = await invoke("scan");
    st.pkgs.forEach((p) => (p.suggested = SUGGESTED.test(p.name)));
    render();
  } catch (err) {
    $("#list").innerHTML = `<div class="loading">${esc(tErr(err))}</div>`;
  }
}

function noteOf(name) {
  const l = st.listNotes[name] || {};
  return l.note || (st.index[name] && st.index[name].n) || l.group || "";
}

function visible() {
  const q = st.q.toLowerCase();
  return st.pkgs.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q) && !noteOf(p.name).toLowerCase().includes(q)) return false;
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
      <span class="namecol">
        <span class="name" title="${esc(p.name)}">${esc(p.name)}</span>
        ${noteOf(p.name) ? `<span class="note">${esc(noteOf(p.name))}</span>` : ""}
      </span>
      ${st.index[p.name] ? `<span class="tag lists">${esc(t("inLists", { n: st.index[p.name].c }))}</span>` : ""}
      <span class="tag will">${esc(t("willDisable"))}</span>
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
    $("#apk-pick").hidden = true; $("#apk-dl").hidden = true;
    $("#modal-go").disabled = pending.length === 0;
    $("#modal-go").textContent = t("disableN", { n: pending.length });
    $("#modal-go").onclick = doApply;
    $("#modal").hidden = false;
  } catch (err) { toastErr(err); }
  finally { busy(btn, false); updateBar(); }
});
$("#modal-cancel").addEventListener("click", () => ($("#modal").hidden = true));
new MutationObserver(() => {
  if (!$("#modal").hidden) return;
  $("#modal-go").hidden = false;
  $("#apk-pick").hidden = true;
  $("#apk-dl").hidden = true;
  $("#list-search").hidden = true;
}).observe($("#modal"), { attributes: true, attributeFilter: ["hidden"] });

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
  $("#apk-pick").hidden = true; $("#apk-dl").hidden = true;
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
  $("#apk-dl").hidden = false;
  $("#apk-dl").onclick = async () => {
    const b = $("#apk-dl"); busy(b, true);
    try {
      const tag = await invoke("launcher_download");
      toast(t("downloadedTag", { tag }));
      openLauncher();
    } catch (err) { toastErr(err); }
    finally { busy(b, false); }
  };
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

// ---- model lists
let listsCache = null;
async function loadLists() {
  if (listsCache) return listsCache;
  const res = await fetch("lists.json");
  listsCache = await res.json();
  return listsCache;
}
const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
// whole-word form, so "kara" does not match "karat"
const words = (x) => " " + String(x || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(" ") + " ";
const GENERIC = new Set(["generic", "android", "androidtv", "tv", "box", "smarttv", "unknown", "full", "atv"]);

function score(list) {
  const hay = words(`${list.tv} ${list.id} ${list.hint}`);
  const has = (v) => {
    const w = words(v).trim();
    return norm(v).length >= 4 && !GENERIC.has(norm(v)) && hay.includes(` ${w} `);
  };
  let sc = 0;
  if (has(st.info.model)) sc += 3;
  if (has(st.info.device)) sc += 2;
  if (sc && norm(list.brand) === norm(st.info.manufacturer)) sc += 0.5;
  return sc;
}

async function openLists() {
  let lists;
  try { lists = await loadLists(); } catch (err) { return toast(String(err)); }
  const installed = new Set(st.pkgs.filter((p) => p.enabled).map((p) => p.name));
  const scored = lists.map((l) => ({ l, sc: score(l), n: l.packages.filter((p) => installed.has(p)).length }));

  $("#modal-title").textContent = t("listsTitle");
  $("#modal-sub").textContent = t("listsSub");
  $("#modal-go").hidden = true;
  $("#apk-pick").hidden = true; $("#apk-dl").hidden = true;
  const search = $("#list-search");
  search.hidden = false; search.value = "";

  const pick = ({ l, n }, best) => `
    <div class="item pick ${best ? "best" : ""}" data-id="${esc(l.id)}">
      <span class="meta"><b>${esc(l.tv)}</b><span class="sub2">${esc([l.brand, l.os].filter(Boolean).join(" · "))}</span></span>
      <span class="sub2">${esc(t("listCount", { n, total: l.packages.length }))}</span>
    </div>`;

  const draw = () => {
    const q = norm(search.value);
    let html = "";
    if (!q) {
      const best = scored.filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 5);
      if (best.length) html += `<div class="group">${esc(t("detected"))}</div>` + best.map((x) => pick(x, true)).join("");
      html += `<div class="group">${esc(t("allModels"))}</div>`;
    }
    const rows = scored
      .filter((x) => !q || norm(`${x.l.brand} ${x.l.tv} ${x.l.id}`).includes(q))
      .sort((a, b) => a.l.tv.localeCompare(b.l.tv));
    html += rows.map((x) => pick(x, false)).join("") || `<div class="item muted">${esc(t("noMatch"))}</div>`;
    $("#plan").innerHTML = html;
  };
  draw();
  search.oninput = draw;
  $("#plan").onclick = (e) => {
    const row = e.target.closest(".pick");
    if (!row) return;
    const l = lists.find((x) => x.id === row.dataset.id);
    let n = 0;
    l.packages.forEach((p, i) => {
      if (!installed.has(p)) return;
      st.sel.add(p); n++;
      const g = l.g && l.g[i] >= 0 ? l.groups[l.g[i]] : "";
      const own = (l.notes && l.notes[p]) || "";
      if (own || g) st.listNotes[p] = { note: own, group: g };
    });
    $("#modal").hidden = true;
    $("#plan").onclick = null;
    render();
    toast(t("listApplied", { n, tv: l.tv }));
  };
  $("#modal").hidden = false;
}
$("#lists-btn").addEventListener("click", openLists);

// ---- updates: checked once at startup, silent when offline or when there is no release yet
(async function checkForUpdate() {
  const updater = window.__TAURI__.updater;
  if (!updater) return;
  let update;
  try { update = await updater.check(); } catch (_) { return; }
  if (!update) return;

  const box = $("#update"), text = $("#update-text"), go = $("#update-go"), later = $("#update-later");
  const label = () => {
    text.textContent = t("updateAvail", { v: update.version });
    go.textContent = t("updateInstall");
    later.textContent = t("updateLater");
  };
  label();
  $("#lang").addEventListener("change", () => { if (!go.disabled) label(); });
  box.hidden = false;
  later.onclick = () => (box.hidden = true);
  go.onclick = async () => {
    go.disabled = true; later.hidden = true;
    let total = 0, got = 0;
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength || 0;
        if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          text.textContent = t("updateDownloading", { pct: total ? Math.min(100, Math.round((got / total) * 100)) : "…" });
        }
      });
      await window.__TAURI__.process.relaunch();
    } catch (err) {
      text.textContent = t("updateFailed", { msg: String(err) });
      go.disabled = false; later.hidden = false; go.textContent = t("updateInstall");
    }
  };
})();
