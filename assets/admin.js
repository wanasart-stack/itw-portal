/* หน้าผู้ดูแลระบบ: อ่าน ZIP -> เข้ารหัส -> commit ไฟล์ data/ ขึ้น GitHub */
(function () {
"use strict";
const $ = id => document.getElementById(id);
const esc = ITW.esc;
const LS = "itw-admin-gh";
let parsed = null;     // { fileName, students }
let built = null;      // { key, files, meta }

/* ---------- การตั้งค่า GitHub ---------- */
function loadSettings() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(LS) || "null"); } catch {}
  if (s) {
    $("ghOwner").value = s.owner || ""; $("ghRepo").value = s.repo || "";
    $("ghBranch").value = s.branch || "main"; $("ghToken").value = s.token || "";
    $("ghRemember").checked = true;
  } else {
    // เดาจาก URL ของ GitHub Pages: https://<owner>.github.io/<repo>/
    const m = /^([^.]+)\.github\.io$/i.exec(location.hostname);
    if (m) {
      $("ghOwner").value = m[1];
      const seg = location.pathname.split("/").filter(Boolean)[0];
      $("ghRepo").value = seg && !/\.html$/.test(seg) ? seg : m[1] + ".github.io";
    }
  }
}
function settings() {
  const s = { owner: $("ghOwner").value.trim(), repo: $("ghRepo").value.trim(), branch: $("ghBranch").value.trim() || "main", token: $("ghToken").value.trim() };
  try {
    if ($("ghRemember").checked) localStorage.setItem(LS, JSON.stringify(s));
    else localStorage.removeItem(LS);
  } catch {}
  return s;
}

async function gh(s, path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}${path}`, {
    ...opts,
    headers: { "Authorization": "Bearer " + s.token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.body ? { "Content-Type": "application/json" } : {}) }
  });
  if (!r.ok) {
    let detail = ""; try { detail = (await r.json()).message || ""; } catch {}
    const e = new Error(detail || ("HTTP " + r.status)); e.status = r.status; throw e;
  }
  return r.status === 204 ? null : r.json();
}
function ghError(e) {
  if (e.status === 401) return "Token ไม่ถูกต้องหรือหมดอายุ สร้าง token ใหม่แล้วลองอีกครั้ง";
  if (e.status === 403) return "Token ไม่มีสิทธิ์เขียนไฟล์ ตั้งค่า Contents เป็น Read and write (" + e.message + ")";
  if (e.status === 404) return "ไม่พบ repository หรือ branch นี้ หรือ token ไม่ได้รับสิทธิ์เข้าถึง repository นี้";
  if (e.status === 409) return "Repository ยังว่างอยู่ อัปโหลดไฟล์ของระบบ (index.html ฯลฯ) ขึ้นไปก่อน";
  return "ติดต่อ GitHub ไม่สำเร็จ: " + (e.message || e);
}
async function testConn() {
  const s = settings(), log = $("ghLog");
  if (!s.owner || !s.repo || !s.token) { log.textContent = "กรอกชื่อบัญชี ชื่อ repository และ token ให้ครบ"; return false; }
  log.textContent = "กำลังตรวจสอบ…";
  try {
    const repo = await gh(s, "");
    await gh(s, `/git/ref/heads/${encodeURIComponent(s.branch)}`);
    if (repo.permissions && !repo.permissions.push) { log.textContent = "Token นี้อ่านได้อย่างเดียว ต้องให้สิทธิ์ Contents: Read and write"; return false; }
    log.textContent = `เชื่อมต่อ ${repo.full_name} (branch ${s.branch}) สำเร็จ`;
    return true;
  } catch (e) { log.textContent = ghError(e); return false; }
}

/* ---------- ข้อมูลปัจจุบัน ---------- */
async function refreshInfo() {
  const el = $("curInfo");
  try {
    const r = await fetch("data/meta.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw 0;
    const m = await r.json(), lv = m.byLevel || {};
    const old = (m.appVersion || 0) < ITW.VERSION;
    el.innerHTML = `ไฟล์ <b>${esc(m.fileName)}</b> · อัปเดตเมื่อ ${esc(ITW.fmtThaiDate(m.updatedAt))}<br>
      นักศึกษาที่เข้าระบบได้ ${Number(m.total).toLocaleString("th-TH")} คน (ประถม ${lv["1"] || 0} · ม.ต้น ${lv["2"] || 0} · ม.ปลาย ${lv["3"] || 0})<br>
      สร้างด้วยโปรแกรมเวอร์ชัน ${esc(m.appVersion || "เก่า")}` +
      (old ? `<div class="msg err">ข้อมูลนี้สร้างจากโปรแกรมเวอร์ชันเก่า ยังไม่มีตารางสอบและผลประเมินคุณธรรม กรุณาอัปโหลดไฟล์ ZIP แล้วกดอัปเดตขึ้น GitHub ใหม่</div>` : "");
  } catch { el.textContent = "ยังไม่มีข้อมูลในระบบ อัปโหลดไฟล์ ZIP เพื่อเริ่มใช้งาน"; }
}

/* ---------- อ่าน ZIP ---------- */
function plog(t, f) { $("parseLog").textContent = t; if (f != null) $("parseBar").style.width = (f * 100) + "%"; }
async function handleZip(file) {
  $("parseBox").classList.remove("hidden"); $("summary").classList.add("hidden");
  $("pubLog").textContent = ""; $("pushBtn").disabled = $("dlBtn").disabled = true;
  parsed = built = null;
  try {
    parsed = { fileName: file.name, students: await ITW.parseZip(file, plog) };
    updateSummary();
    $("summary").classList.remove("hidden");
    $("pushBtn").disabled = $("dlBtn").disabled = false;
  } catch (e) { plog("อ่านไฟล์ไม่สำเร็จ: " + (e.message || e), 0); }
}
function selected() {
  return parsed.students.filter(s => !s.fin && s.pw.length >= 5);
}
function updateSummary() {
  if (!parsed) return;
  const pool = parsed.students.filter(s => !s.fin);
  const ok = selected();
  const by = { "1": 0, "2": 0, "3": 0 }; ok.forEach(s => by[s.data.lv]++);
  const kv = [
    ["นักศึกษาที่กำลังศึกษา (เข้าระบบได้)", ok.length.toLocaleString("th-TH")],
    ["ประถมศึกษา", by["1"]], ["ม.ต้น", by["2"]], ["ม.ปลาย", by["3"]],
    ["ใช้เลข G", ok.filter(s => s.pw.startsWith("G")).length],
    ["ไม่มีเลขบัตร (เข้าระบบไม่ได้)", pool.length - ok.length],
    ["จบ/พ้นสภาพ (ไม่นำขึ้นระบบ)", (parsed.students.length - pool.length).toLocaleString("th-TH")],
  ];
  $("sumKv").innerHTML = kv.map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("");
}

/* ---------- เข้ารหัส (ทำครั้งเดียวต่อการเลือก) ---------- */
async function ensureBuilt() {
  const key = parsed.fileName;
  if (built && built.key === key) return built;
  const list = selected(), bar = $("pubBar"), log = $("pubLog");
  $("pubProg").classList.remove("hidden");
  log.textContent = "กำลังเข้ารหัสข้อมูลนักศึกษา…";
  const t0 = Date.now();
  const { files, meta } = await ITW.buildFiles(list, parsed.fileName, (d, n) => {
    bar.style.width = (d / n * 60) + "%";
    const eta = d > 50 ? Math.round((Date.now() - t0) / d * (n - d) / 1000) : null;
    log.textContent = `กำลังเข้ารหัสข้อมูลนักศึกษา ${d.toLocaleString("th-TH")} / ${n.toLocaleString("th-TH")} คน` + (eta != null ? ` (เหลืออีกประมาณ ${Math.ceil(eta / 60)} นาที)` : "");
  });
  built = { key, files, meta };
  return built;
}

/* ---------- commit ขึ้น GitHub ในครั้งเดียว ---------- */
async function pushToGitHub() {
  const btns = [$("pushBtn"), $("dlBtn")]; btns.forEach(b => b.disabled = true);
  const bar = $("pubBar"), log = $("pubLog");
  try {
    if (!(await testConn())) { log.textContent = "ตรวจสอบการเชื่อมต่อ GitHub ในขั้นที่ 1 ก่อน"; return; }
    const s = settings();
    const { files, meta } = await ensureBuilt();
    log.textContent = "กำลังส่งไฟล์ขึ้น GitHub…";
    const ref = await gh(s, `/git/ref/heads/${encodeURIComponent(s.branch)}`);
    const head = await gh(s, `/git/commits/${ref.object.sha}`);
    const paths = Object.keys(files);
    const tree = [];
    let n = 0;
    await ITW.pool(paths, 4, async p => {
      let blob, tries = 0;
      for (;;) {
        try { blob = await gh(s, "/git/blobs", { method: "POST", body: JSON.stringify({ content: files[p], encoding: "utf-8" }) }); break; }
        catch (e) { if (++tries > 4 || (e.status && e.status < 500 && e.status !== 403)) throw e; await new Promise(r => setTimeout(r, 1000 * 2 ** tries)); }
      }
      tree.push({ path: p, mode: "100644", type: "blob", sha: blob.sha });
      bar.style.width = (60 + (++n / paths.length) * 35) + "%";
      log.textContent = `กำลังส่งไฟล์ขึ้น GitHub ${n} / ${paths.length}`;
    });
    const newTree = await gh(s, "/git/trees", { method: "POST", body: JSON.stringify({ base_tree: head.tree.sha, tree }) });
    const commit = await gh(s, "/git/commits", { method: "POST", body: JSON.stringify({
      message: `อัปเดตข้อมูลนักศึกษาจาก ${meta.fileName} (${meta.total} คน)`, tree: newTree.sha, parents: [ref.object.sha] }) });
    await gh(s, `/git/refs/heads/${encodeURIComponent(s.branch)}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) });
    bar.style.width = "100%";
    log.textContent = `บันทึกขึ้น GitHub เรียบร้อย (${meta.total.toLocaleString("th-TH")} คน) หน้าเว็บจะแสดงข้อมูลใหม่ภายในประมาณ 1–10 นาที หลัง GitHub Pages สร้างหน้าเว็บเสร็จ`;
  } catch (e) {
    log.textContent = e.status ? ghError(e) : ("บันทึกไม่สำเร็จ: " + (e.message || e));
  } finally { btns.forEach(b => b.disabled = !parsed); }
}

/* ---------- ทางเลือก: ดาวน์โหลดโฟลเดอร์ data ไปอัปโหลดเอง ---------- */
async function downloadData() {
  const btns = [$("pushBtn"), $("dlBtn")]; btns.forEach(b => b.disabled = true);
  const log = $("pubLog");
  try {
    const { files } = await ensureBuilt();
    const zip = new JSZip();
    for (const [p, c] of Object.entries(files)) zip.file(p, c);
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "itw-data.zip";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    $("pubBar").style.width = "100%";
    log.textContent = "ดาวน์โหลด itw-data.zip แล้ว แตกไฟล์ จากนั้นอัปโหลดโฟลเดอร์ data ทั้งโฟลเดอร์ขึ้น repository (Add file › Upload files) แทนที่ของเดิม";
  } catch (e) { log.textContent = "สร้างไฟล์ไม่สำเร็จ: " + (e.message || e); }
  finally { btns.forEach(b => b.disabled = !parsed); }
}

/* ---------- ผูกเหตุการณ์ ---------- */
const drop = $("drop"), fin = $("fileIn");
drop.addEventListener("click", () => fin.click());
drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fin.click(); } });
drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) handleZip(e.dataTransfer.files[0]); });
fin.addEventListener("change", () => { if (fin.files[0]) handleZip(fin.files[0]); fin.value = ""; });
$("ghTest").addEventListener("click", testConn);
$("pushBtn").addEventListener("click", pushToGitHub);
$("dlBtn").addEventListener("click", downloadData);
loadSettings();
refreshInfo();
$("appVer").textContent = "โปรแกรมเวอร์ชัน " + ITW.VERSION;
})();
