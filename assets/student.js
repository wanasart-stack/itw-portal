/* หน้านักศึกษา: เข้าสู่ระบบและแสดงผลการเรียน */
(function () {
"use strict";
const $ = id => document.getElementById(id);
const esc = ITW.esc;
let meta = null;

// ความหมายของระดับผลประเมินคุณธรรม (SUMLEVEL ใน VIRTUE.DBF) ให้งานทะเบียนตรวจสอบและแก้ได้ที่นี่
const VIRTUE_LABELS = { 0: "ปรับปรุง", 1: "พอใช้", 2: "ดี", 3: "ดีมาก" };
const TH_MONTHS = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const TH_DAYS = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];

function msg(kind, text){ const el = $("loginMsg"); el.className = "msg " + kind; el.textContent = text; }
function show(v){
  $("viewLogin").classList.toggle("hidden", v !== "login");
  $("viewStudent").classList.toggle("hidden", v !== "student");
  $("logoutBtn").classList.toggle("hidden", v !== "student");
  window.scrollTo(0, 0);
}

async function loadMeta(){
  try {
    const r = await fetch("data/meta.json?t=" + Date.now(), { cache: "no-store" });
    meta = r.ok ? await r.json() : null;
  } catch { meta = null; }
  $("dataStamp").textContent = meta ? `ข้อมูล ณ ${ITW.fmtThaiDate(meta.updatedAt)}` : "ยังไม่มีข้อมูลในระบบ";
}

async function onLogin(ev){
  ev.preventDefault();
  const id = ITW.normId($("inId").value), pw = ITW.normPw($("inPw").value);
  $("loginMsg").classList.add("hidden");
  if (id.length !== 10){ msg("err", "รหัสนักศึกษาต้องเป็นตัวเลข 10 หลัก"); return; }
  if (pw.length < 5){ msg("err", "กรอกเลขประจำตัวประชาชน 13 หลัก หรือเลข G ให้ครบ"); return; }
  const btn = $("loginBtn"); btn.disabled = true; btn.textContent = "กำลังตรวจสอบ…";
  try {
    if (!meta) await loadMeta();
    if (!meta) throw new Error("nodata");
    const r = await fetch(ITW.bucketFile(await ITW.bucketOf(id)) + "?v=" + encodeURIComponent(meta.version));
    if (!r.ok) throw new Error("nodata");
    const doc = await r.json();
    const { key, lookup } = await ITW.derive(id, pw, doc.salt, doc.iter);
    const blob = doc.e && doc.e[lookup];
    if (!blob) throw new Error("nomatch");
    const data = await ITW.decrypt(key, blob);
    $("inPw").value = "";
    setPwVisible(false);
    renderStudent(data);
    show("student");
  } catch (e) {
    if (e && e.message === "nodata") msg("err", "ยังไม่มีข้อมูลในระบบ กรุณาติดต่อเจ้าหน้าที่ทะเบียน");
    else if (e && e.message === "nomatch") msg("err", "รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง หรือไม่ได้อยู่ในสถานะกำลังศึกษา ตรวจสอบตัวเลขอีกครั้ง หากยังเข้าไม่ได้ให้ติดต่อเจ้าหน้าที่ทะเบียน");
    else msg("err", "เชื่อมต่อระบบไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง");
  } finally { btn.disabled = false; btn.textContent = "เข้าสู่ระบบ"; }
}

/* ---------- ตัวช่วยแสดงผล ---------- */
const NUMERIC = g => /^\d(\.5)?$/.test(g);
function gradeClass(g){
  if (!g) return "wait";
  if (NUMERIC(g)) return +g >= 1 ? "pass" : "fail";
  if (g === "ผ") return "pass";
  return "fail";
}
function gradeText(g){ return g || "รอผล"; }

// วันสอบ "20/09/69" -> { key, text: "เสาร์ 20 ก.ย. 2569" }
function examDate(s){
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s || "");
  if (!m) return { key: 99999999, text: s || "-" };
  const be = 2500 + (+m[3]), d = new Date(be - 543, +m[2] - 1, +m[1]);
  return { key: be * 10000 + (+m[2]) * 100 + (+m[1]), text: `${TH_DAYS[d.getDay()]} ${+m[1]} ${TH_MONTHS[+m[2] - 1]} ${be}` };
}
// เวลา 1240 -> "12.40"
function examTime(n){
  n = +n || 0; if (!n) return "";
  return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;
}

function computeStats(d){
  const sub = d.sub || {};
  const best = {};
  for (const [, code, , , , g] of d.gr){
    const b = best[code] || (best[code] = {num:null, pass:false});
    if (NUMERIC(g)){ const n=+g; if (b.num===null || n>b.num) b.num=n; if (n>=1) b.pass=true; }
    else if (g === "ผ") b.pass = true;
  }
  let pts=0, cr=0; const earned={req:0,elec:0};
  for (const [code,b] of Object.entries(best)){
    const [, credit=0, type=2] = sub[code] || [];
    if (b.num !== null){ pts += b.num*credit; cr += credit; }
    if (b.pass) earned[type===1?"req":"elec"] += credit;
  }
  for (const [, code] of d.rem){
    if (best[code] && best[code].pass) continue;
    const [, credit=0, type=2] = sub[code] || [];
    earned[type===1?"req":"elec"] += credit;
  }
  const hours = d.act.reduce((a,x)=>a+(+x[2]||0),0);
  const sems = new Set(d.gr.map(x => x[0]).filter(Boolean)).size;
  return { gpax: cr ? pts/cr : null, earned, hours, sems };
}

function renderStudent(d){
  const st = computeStats(d);
  const rule = Object.assign({ req:0, elec:0, act:200, tim:4 }, d.rule || {});
  const v = $("viewStudent");
  const lvl = ITW.LEVELS[d.lv] || "";
  const active = d.st === "กำลังศึกษา";
  const pct = (a,b) => b ? Math.min(100, a/b*100) : 0;
  const vir = {}; for (const [s, lv] of (d.vir || [])) vir[s] = lv;

  /* สรุปคุณสมบัติการจบ */
  const checks = [
    ["หน่วยกิตวิชาบังคับ", st.earned.req, rule.req, "หน่วยกิต"],
    ["หน่วยกิตวิชาเลือก", st.earned.elec, rule.elec, "หน่วยกิต"],
    ["ชั่วโมง กพช.", st.hours, rule.act, "ชั่วโมง"],
    ["จำนวนภาคเรียนที่เรียน", st.sems, rule.tim, "ภาคเรียน"],
  ].map(([label, have, need, unit]) => {
    const ok = have >= need;
    return { ok, label, value: `${have} / ${need} ${unit}`, note: ok ? "ครบแล้ว" : `ขาดอีก ${need - have} ${unit}` };
  });
  checks.push(d.nt
    ? { ok: true, label: "การเข้าสอบ N-NET", value: `เข้าสอบแล้ว ${ITW.semLabel(d.nt)}`, note: "ครบแล้ว" }
    : { ok: false, label: "การเข้าสอบ N-NET", value: "ยังไม่มีข้อมูลการเข้าสอบ", note: "ต้องเข้าสอบก่อนจบ" });
  const doneCount = checks.filter(c => c.ok).length;
  const checkHtml = `
    <section class="card checklist" aria-label="สรุปคุณสมบัติการจบ">
      <div class="ck-head"><h2>สรุปคุณสมบัติการจบ</h2><span class="ck-count">ผ่าน ${doneCount} จาก ${checks.length} ข้อ</span></div>
      <ul>${checks.map(c => `
        <li class="${c.ok ? "ok" : "todo"}">
          <span class="ck-icon" aria-hidden="true">${c.ok ? "✓" : ""}</span>
          <span class="ck-label">${esc(c.label)}</span>
          <span class="ck-value">${esc(c.value)}</span>
          <span class="ck-note">${esc(c.note)}</span>
        </li>`).join("")}</ul>
      <p class="legend">เป็นการสรุปจากข้อมูลในระบบทะเบียนเพื่อใช้ติดตามความก้าวหน้า การอนุมัติจบเป็นไปตามการตรวจสอบของงานทะเบียน</p>
    </section>`;

  /* ตารางสอบ */
  let examHtml = "";
  if (d.exam && d.exam.length){
    const rows = d.exam.map(([code, day, s, e]) => ({ code, date: examDate(day), s, e }))
      .sort((a,b) => a.date.key - b.date.key || (+a.s) - (+b.s));
    examHtml = `
    <section class="card exam" aria-label="ตารางสอบปลายภาค">
      <h2>ตารางสอบปลายภาค <span class="sub">${esc(ITW.semLabel(d.examSem))}</span></h2>
      <div class="scroll" style="border-top:none;margin-top:10px"><table>
        <thead><tr><th>วันสอบ</th><th>เวลา</th><th>รหัสวิชา</th><th>ชื่อวิชา</th></tr></thead>
        <tbody>${rows.map(r => {
          const [name = r.code] = d.sub[r.code] || [];
          const t = examTime(r.s) ? `${examTime(r.s)}${examTime(r.e) ? "–" + examTime(r.e) : ""} น.` : "-";
          return `<tr><td class="nowrap"><b>${esc(r.date.text)}</b></td><td class="nowrap">${esc(t)}</td><td class="code">${esc(r.code)}</td><td>${esc(name)}</td></tr>`;
        }).join("")}</tbody></table></div>
      <p class="legend">ตรวจสอบห้องสอบและรายละเอียดเพิ่มเติมกับครูที่ปรึกษา</p>
    </section>`;
  }

  /* ผลการเรียนรายภาคเรียน */
  const bySem = {};
  for (const r of d.gr) (bySem[r[0]] ||= []).push(r);
  const sems = Object.keys(bySem).sort((a,b)=>ITW.semKey(b)-ITW.semKey(a));
  const semHtml = sems.map((s,i) => {
    const rows = bySem[s].sort((a,b)=>a[1].localeCompare(b[1],"th"));
    let p=0,c=0,reg=0;
    for (const r of rows){ const [,credit=0] = d.sub[r[1]]||[]; reg+=credit; if (NUMERIC(r[5])){ p+=(+r[5])*credit; c+=credit; } }
    const gpa = c ? (p/c).toFixed(2) : "-";
    const vl = vir[s];
    const virText = vl === undefined ? "" : ` · คุณธรรม <b>${esc(VIRTUE_LABELS[vl] ?? ("ระดับ " + vl))}</b>`;
    return `<details class="sem"${i===0?" open":""}>
      <summary><h3>${esc(ITW.semLabel(s))}</h3><div class="s-meta">${rows.length} วิชา · ${reg} หน่วยกิต<br>เกรดเฉลี่ยภาคเรียน <b>${gpa}</b>${virText}</div></summary>
      <div class="scroll"><table>
        <thead><tr><th>รหัสวิชา</th><th>ชื่อวิชา</th><th class="num">หน่วยกิต</th><th class="num">ระหว่างภาค</th><th class="num">ปลายภาค</th><th class="num">รวม</th><th class="num">ผลการเรียน</th></tr></thead>
        <tbody>${rows.map(r=>{
          const [name=r[1], credit="", type] = d.sub[r[1]]||[];
          const pending = !r[5];
          // วิชาที่ยังรอผล ไม่แสดงคะแนน 0 เพื่อไม่ให้เข้าใจผิด
          const n = x => (x===null||x===undefined||x===""||(pending && +x===0))?"-":x;
          return `<tr><td class="code">${esc(r[1])}</td><td>${esc(name)} ${type===1?'<span class="tag">บังคับ</span>':'<span class="tag">เลือก</span>'}</td>
            <td class="num">${esc(credit)}</td><td class="num">${esc(n(r[2]))}</td><td class="num">${esc(n(r[3]))}</td><td class="num">${esc(n(r[4]))}</td>
            <td class="num"><span class="grade ${gradeClass(r[5])}">${esc(gradeText(r[5]))}</span></td></tr>`;
        }).join("")}</tbody></table></div></details>`;
  }).join("");

  const acts = [...d.act].sort((a,b)=>ITW.semKey(b[0])-ITW.semKey(a[0]));
  const actHtml = acts.length ? `<div class="card" style="padding:0;overflow:hidden"><div class="scroll" style="border-top:none"><table>
      <thead><tr><th>ภาคเรียน</th><th>กิจกรรม</th><th class="num">ชั่วโมง</th></tr></thead>
      <tbody>${acts.map(a=>`<tr><td class="code">${esc(ITW.semLabel(a[0]))}</td><td>${esc(a[1])}</td><td class="num">${esc(a[2])}</td></tr>`).join("")}</tbody>
      </table></div></div>` : `<div class="empty">ยังไม่มีการบันทึกชั่วโมงกิจกรรม กพช.</div>`;

  const remHtml = d.rem.length ? `<div class="card" style="padding:0;overflow:hidden"><div class="scroll" style="border-top:none"><table>
      <thead><tr><th>ภาคเรียน</th><th>รหัสวิชา</th><th>ชื่อวิชา</th><th class="num">หน่วยกิต</th><th>เทียบโอนจาก</th></tr></thead>
      <tbody>${d.rem.map(r=>{ const [name=r[1],credit=""] = d.sub[r[1]]||[];
        return `<tr><td class="code">${esc(ITW.semLabel(r[0]))}</td><td class="code">${esc(r[1])}</td><td>${esc(name)}</td><td class="num">${esc(credit)}</td><td>${esc(r[2]||"-")}</td></tr>`;}).join("")}</tbody>
      </table></div></div>` : `<div class="empty">ไม่มีรายวิชาเทียบโอน</div>`;

  /* ไม้บรรทัดชั่วโมง กพช. */
  const req = rule.act || 200;
  const max = Math.max(req, st.hours);
  let ticks = "";
  for (let h=0; h<=max; h+=10){
    const x = h/max*100, major = h%50===0;
    ticks += `<span class="tick${major?" major":""}" style="left:${x}%"></span>`;
    if (major) ticks += `<span class="lbl" style="left:${x}%">${h}</span>`;
  }
  if (max > req) ticks += `<span class="goal" style="left:${req/max*100}%"><b>เกณฑ์ ${req}</b></span>`;
  const remain = Math.max(0, req - st.hours);

  v.innerHTML = `
    <section class="who">
      <div>
        <h1>${esc([d.pn,d.fn,d.ln].filter(Boolean).join(" "))}</h1>
        <div class="meta">รหัสนักศึกษา <b>${esc(d.id)}</b> · ระดับ <b>${esc(lvl)}</b></div>
        <div class="meta">กลุ่ม <b>${esc(d.grpName || d.grp || "-")}</b>${d.adv?` · ครูที่ปรึกษา <b>${esc(d.adv)}</b>`:""}</div>
      </div>
      <span class="status${active?"":" off"}">${esc(d.st)}</span>
    </section>

    <section class="stats" aria-label="สรุปผลการเรียน">
      <div class="stat"><div class="k">เกรดเฉลี่ยสะสม</div><div class="v">${st.gpax===null?"-":st.gpax.toFixed(2)}</div></div>
      <div class="stat"><div class="k">หน่วยกิตวิชาบังคับ</div><div class="v">${st.earned.req}<small> / ${rule.req}</small></div>
        <div class="creditbar"><i class="${st.earned.req>=rule.req?"done":""}" style="width:${pct(st.earned.req,rule.req)}%"></i></div></div>
      <div class="stat"><div class="k">หน่วยกิตวิชาเลือก</div><div class="v">${st.earned.elec}<small> / ${rule.elec}</small></div>
        <div class="creditbar"><i class="${st.earned.elec>=rule.elec?"done":""}" style="width:${pct(st.earned.elec,rule.elec)}%"></i></div></div>
    </section>

    <section class="ruler" aria-label="ชั่วโมงกิจกรรมพัฒนาคุณภาพชีวิต">
      <div class="ruler-head">
        <h2>ชั่วโมง กพช.</h2>
        <div class="big">${st.hours}<small> / ${req} ชั่วโมง</small></div>
      </div>
      <div class="track" role="img" aria-label="สะสมแล้ว ${st.hours} จาก ${req} ชั่วโมง">
        <span class="rail"></span><span class="fill" id="fill" style="width:0"></span>${ticks}
      </div>
      <p class="note">${remain>0?`ต้องสะสมอีก ${remain} ชั่วโมง จึงครบเกณฑ์จบหลักสูตร`:"สะสมครบตามเกณฑ์จบหลักสูตรแล้ว"}</p>
    </section>

    ${examHtml}
    ${checkHtml}

    <nav class="tabs" role="tablist">
      <button class="tab" role="tab" aria-selected="true" data-p="pGrades">ผลการเรียนรายวิชา</button>
      <button class="tab" role="tab" aria-selected="false" data-p="pAct">กิจกรรม กพช. (${acts.length})</button>
      <button class="tab" role="tab" aria-selected="false" data-p="pRem">วิชาเทียบโอน (${d.rem.length})</button>
    </nav>
    <section class="panel" id="pGrades">${semHtml || '<div class="empty">ยังไม่มีผลการเรียน</div>'}
      <p class="legend">ข = ขาดสอบ · ม = ไม่มีสิทธิ์สอบ · ผ = ผ่าน · รอผล = ยังไม่ได้บันทึกผลการเรียน · เกรดเฉลี่ยสะสมคำนวณจากผลการเรียนที่ดีที่สุดของแต่ละวิชา</p></section>
    <section class="panel hidden" id="pAct">${actHtml}</section>
    <section class="panel hidden" id="pRem">${remHtml}</section>
    <p class="legend">${meta?`ข้อมูล ณ ${esc(ITW.fmtThaiDate(meta.updatedAt))} · `:""}หากข้อมูลไม่ถูกต้อง ติดต่อเจ้าหน้าที่ทะเบียน</p>`;

  v.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
    v.querySelectorAll(".tab").forEach(x => x.setAttribute("aria-selected", x===t));
    ["pGrades","pAct","pRem"].forEach(p => $(p).classList.toggle("hidden", p!==t.dataset.p));
  }));
  requestAnimationFrame(() => requestAnimationFrame(() => { const f=$("fill"); if (f) f.style.width = (st.hours/max*100)+"%"; }));
}

/* ปุ่มรูปตา: แสดง/ซ่อนรหัสผ่าน */
function setPwVisible(on){
  $("inPw").type = on ? "text" : "password";
  const eye = $("pwEye");
  eye.setAttribute("aria-pressed", on);
  eye.setAttribute("aria-label", on ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน");
  eye.title = on ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน";
  eye.classList.toggle("on", on);
}
$("pwEye").addEventListener("click", () => { setPwVisible($("inPw").type === "password"); $("inPw").focus(); });

$("loginForm").addEventListener("submit", onLogin);
$("logoutBtn").addEventListener("click", () => { $("viewStudent").innerHTML = ""; show("login"); $("inId").focus(); });
loadMeta();
})();
