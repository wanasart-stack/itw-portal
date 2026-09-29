/* ส่วนกลาง: เข้ารหัส/ถอดรหัส, อ่านไฟล์ DBF ของ ITW51, สร้างไฟล์ข้อมูล */
(function (g) {
  "use strict";

  const VERSION = 4;         // เวอร์ชันโปรแกรม (ใช้ตรวจว่าข้อมูลสร้างจากโปรแกรมรุ่นล่าสุดหรือไม่)
  const BUCKETS = 64;        // จำนวนไฟล์ข้อมูลใน data/b/
  const ITER = 100000;       // รอบ PBKDF2 (ยิ่งมากยิ่งเดารหัสยาก)
  const LEVELS = { "1": "ประถมศึกษา", "2": "มัธยมศึกษาตอนต้น", "3": "มัธยมศึกษาตอนปลาย" };
  const te = new TextEncoder();

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const hex = u8 => Array.from(u8, b => b.toString(16).padStart(2, "0")).join("");

  function normId(s) {
    let d = String(s || "").replace(/\D/g, "");
    if (d.length === 20) d = d.slice(10);   // STD_CODE 20 หลัก -> รหัส 10 หลัก
    return d;
  }
  function normPw(s) { return String(s || "").replace(/[\s\-]/g, "").toUpperCase(); }

  async function bucketOf(id) {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode("itw-bucket|" + id)));
    return ((h[0] << 8) | h[1]) % BUCKETS;
  }
  const bucketFile = n => "data/b/" + String(n).padStart(2, "0") + ".json";

  async function derive(id, pw, saltB64, iter) {
    const base = await crypto.subtle.importKey("raw", te.encode(id + "|" + pw), "PBKDF2", false, ["deriveBits"]);
    const salt = new Uint8Array([...unb64(saltB64), ...te.encode(id)]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, 384));
    const key = await crypto.subtle.importKey("raw", bits.slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]);
    return { key, lookup: hex(bits.slice(32, 48)) };
  }
  async function gz(str) {
    const s = new Blob([te.encode(str)]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function gunz(u8) {
    const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(s).text();
  }
  async function encrypt(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await gz(JSON.stringify(obj))));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
    return b64(out);
  }
  async function decrypt(key, s) {
    const u = unb64(s);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(0, 12) }, key, u.slice(12));
    return JSON.parse(await gunz(new Uint8Array(pt)));
  }

  function semKey(s) { const m = /^(\d{2})\/(\d)$/.exec(s || ""); return m ? (+m[1]) * 10 + (+m[2]) : 0; }
  function semLabel(s) { const m = /^(\d{2})\/(\d)$/.exec(s || ""); return m ? `ภาคเรียนที่ ${m[2]}/25${m[1]}` : (s || "-"); }
  function fmtThaiDate(iso) { try { return new Date(iso).toLocaleString("th-TH", { dateStyle: "long", timeStyle: "short" }); } catch { return iso; } }

  /* ---------- อ่าน DBF (FoxPro, TIS-620) ---------- */
  const tis = new TextDecoder("windows-874");
  function readDBF(buf, want) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    const n = dv.getUint32(4, true), hl = dv.getUint16(8, true), rl = dv.getUint16(10, true);
    const fields = []; let p = 32, off = 1;
    while (p + 32 <= hl && u8[p] !== 0x0D) {
      let name = ""; for (let i = 0; i < 11 && u8[p + i]; i++) name += String.fromCharCode(u8[p + i]);
      const f = { name: name.toUpperCase(), type: String.fromCharCode(u8[p + 11]), off, len: u8[p + 16] };
      fields.push(f); off += f.len; p += 32;
    }
    const use = fields.filter(f => want.includes(f.name));
    const out = [];
    for (let r = 0; r < n; r++) {
      const base = hl + r * rl;
      if (base + rl > u8.length) break;
      if (u8[base] === 0x2A) continue; // ระเบียนที่ถูกลบ
      const rec = {};
      for (const f of use) {
        const a = base + f.off, b = a + f.len;
        let ascii = true; for (let i = a; i < b; i++) if (u8[i] >= 0x80) { ascii = false; break; }
        let s = ascii ? String.fromCharCode.apply(null, u8.subarray(a, b)) : tis.decode(u8.subarray(a, b));
        s = s.replace(/[\s\0]+$/, "").replace(/^\s+/, "");
        rec[f.name] = (f.type === "N" || f.type === "F") ? (s === "" ? null : +s) : s;
      }
      out.push(rec);
    }
    return out;
  }

  /* ---------- อ่าน ZIP ของ ITW51 -> รายชื่อนักศึกษาพร้อมข้อมูล ---------- */
  async function parseZip(file, log) {
    log = log || (() => {});
    const tick = () => new Promise(r => setTimeout(r, 0));
    log("กำลังเปิดไฟล์ ZIP…", 0.02);
    const zip = await JSZip.loadAsync(file);
    const find = re => { let hit = null; zip.forEach((path, f) => { if (!f.dir && re.test(path)) hit = hit || f; }); return hit; };
    const read = async (f, want) => readDBF(await f.async("arraybuffer"), want);

    const groups = {};
    const grpFile = find(/(^|\/)group\.dbf$/i);
    if (grpFile) for (const x of await read(grpFile, ["GRP_CODE", "GRP_NAME", "GRP_ADVIS"])) groups[x.GRP_CODE] = [x.GRP_NAME, x.GRP_ADVIS];

    const students = [];
    const lvs = ["1", "2", "3"];
    for (let li = 0; li < lvs.length; li++) {
      const lv = lvs[li];
      const lf = name => find(new RegExp(`(^|/)${lv}/${name}\\.dbf$`, "i"));
      const sf = lf("student");
      if (!sf) continue;
      const step = (k, f) => log(`ระดับ${LEVELS[lv]}: กำลังอ่าน${k}…`, (li + f) / 3);

      step("ข้อมูลนักศึกษา", 0.1); await tick();
      const S = await read(sf, ["ID", "STD_CODE", "PRENAME", "NAME", "SURNAME", "GRP_CODE", "CARDID", "FIN_CAUSE", "NT_SEM"]);
      step("ผลการเรียน", 0.3); await tick();
      const G = lf("grade") ? await read(lf("grade"), ["STD_CODE", "SEMESTRY", "SUB_CODE", "MIDTERM", "FINAL", "TOTAL", "GRADE"]) : [];
      step("กิจกรรม กพช.", 0.6); await tick();
      const A = lf("activity") ? await read(lf("activity"), ["STD_CODE", "ACTIVITY", "SEMESTRY", "HOUR"]) : [];
      step("รายวิชา", 0.8); await tick();
      const SU = lf("subject") ? await read(lf("subject"), ["SUB_CODE", "SUB_NAME", "SUB_TYPE", "SUB_CREDIT"]) : [];
      const R = lf("rem") ? await read(lf("rem"), ["STD_CODE", "SEMESTRY", "SUB_CODE", "SCHOOL"]) : [];
      const RU = lf("rule") ? (await read(lf("rule"), ["FIN_REQ", "FIN_ELEC", "FIN_ACT", "FIN_ACT2", "FIN_TIM"]))[0] : null;
      step("ตารางสอบและผลประเมินคุณธรรม", 0.9); await tick();
      const SC = lf("schedule") ? await read(lf("schedule"), ["SEMESTRY", "SUB_CODE", "EXAM_DAY", "EXAM_START", "EXAM_END"]) : [];
      const V = lf("virtue") ? await read(lf("virtue"), ["STD_CODE", "SEMESTER", "SUMLEVEL"]) : [];

      // นักศึกษาที่เข้าเรียนก่อนภาคเรียนที่ 2/2556 ใช้เกณฑ์ กพช. เดิม (FIN_ACT2)
      const ruleNew = { req: RU?.FIN_REQ ?? 0, elec: RU?.FIN_ELEC ?? 0, act: RU?.FIN_ACT ?? 200, tim: RU?.FIN_TIM || 4 };
      const ruleOld = { ...ruleNew, act: RU?.FIN_ACT2 || ruleNew.act };
      const entryKey = id => (+id.slice(0, 2)) * 10 + (+id.slice(2, 3));

      const subj = {}; for (const s of SU) subj[s.SUB_CODE] = [s.SUB_NAME, s.SUB_CREDIT || 0, s.SUB_TYPE === 1 ? 1 : 2];
      const gi = {}, ai = {}, ri = {};
      for (const x of G) (gi[x.STD_CODE] ||= []).push([x.SEMESTRY, x.SUB_CODE, x.MIDTERM, x.FINAL, x.TOTAL, x.GRADE]);
      for (const x of A) (ai[x.STD_CODE] ||= []).push([x.SEMESTRY, x.ACTIVITY, x.HOUR || 0]);
      for (const x of R) (ri[x.STD_CODE] ||= []).push([x.SEMESTRY, x.SUB_CODE, x.SCHOOL]);
      // ตารางสอบ: ภาคเรียน -> รหัสวิชา -> [วันสอบ, เวลาเริ่ม, เวลาสิ้นสุด]
      const sched = {};
      for (const x of SC) if (x.EXAM_DAY) (sched[x.SEMESTRY] ||= {})[x.SUB_CODE] = [x.EXAM_DAY, x.EXAM_START || 0, x.EXAM_END || 0];
      // ภาคเรียนปัจจุบัน = ภาคเรียนล่าสุดที่มีการลงทะเบียนในระดับนี้ (แสดงตารางสอบเฉพาะภาคเรียนนี้)
      let curSem = "";
      for (const x of G) if (semKey(x.SEMESTRY) > semKey(curSem)) curSem = x.SEMESTRY;
      const vi = {};
      for (const x of V) if (x.SEMESTER && x.SUMLEVEL !== null) (vi[x.STD_CODE] ||= []).push([x.SEMESTER, x.SUMLEVEL]);

      for (const s of S) {
        const gr = gi[s.STD_CODE] || [], rem = ri[s.STD_CODE] || [];
        const sub = {};
        for (const c of [...gr.map(x => x[1]), ...rem.map(x => x[1])]) if (subj[c]) sub[c] = subj[c];
        const gp = groups[s.GRP_CODE] || [];
        // ตารางสอบ เฉพาะนักศึกษาที่ลงทะเบียนในภาคเรียนปัจจุบัน
        let lastSem = "";
        for (const x of gr) if (semKey(x[0]) > semKey(lastSem)) lastSem = x[0];
        const exam = [];
        if (lastSem === curSem && sched[lastSem]) for (const x of gr) if (x[0] === lastSem && sched[lastSem][x[1]]) exam.push([x[1], ...sched[lastSem][x[1]]]);
        const fc = s.FIN_CAUSE;
        students.push({
          pw: normPw(s.CARDID),
          fin: fc !== null && fc !== 0,
          data: {
            v: 2, id: s.ID, lv, pn: s.PRENAME, fn: s.NAME, ln: s.SURNAME,
            grp: s.GRP_CODE, grpName: gp[0] || "", adv: gp[1] || "",
            st: fc === 1 ? "จบการศึกษา" : (fc === null || fc === 0) ? "กำลังศึกษา" : "พ้นสภาพนักศึกษา",
            sub, gr, act: ai[s.STD_CODE] || [], rem,
            nt: s.NT_SEM || "", vir: vi[s.STD_CODE] || [], examSem: exam.length ? lastSem : "", exam,
            rule: entryKey(s.ID) < 562 ? ruleOld : ruleNew
          }
        });
      }
    }
    if (!students.length) throw new Error("ไม่พบไฟล์ student.dbf ในโฟลเดอร์ระดับชั้น 1, 2 หรือ 3 ตรวจสอบว่าเป็นไฟล์ที่ส่งออกจาก ITW51");
    log(`อ่านไฟล์ ${file.name} เรียบร้อย`, 1);
    return students;
  }

  async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
  }

  /* ---------- เข้ารหัสทั้งหมด -> { "data/b/00.json": "...", ..., "data/meta.json": "..." } ---------- */
  async function buildFiles(list, fileName, onProgress) {
    const buckets = Array.from({ length: BUCKETS }, () => ({ salt: b64(crypto.getRandomValues(new Uint8Array(16))), iter: ITER, e: {} }));
    let done = 0;
    await pool(list, 12, async s => {
      const b = buckets[await bucketOf(s.data.id)];
      const { key, lookup } = await derive(s.data.id, s.pw, b.salt, b.iter);
      b.e[lookup] = await encrypt(key, s.data);
      if (++done % 25 === 0 || done === list.length) onProgress && onProgress(done, list.length);
    });
    const files = {};
    buckets.forEach((b, i) => { files[bucketFile(i)] = JSON.stringify(b); });
    const byLevel = { "1": 0, "2": 0, "3": 0 }; list.forEach(s => byLevel[s.data.lv]++);
    const meta = { appVersion: VERSION, version: Date.now().toString(36), updatedAt: new Date().toISOString(), fileName, total: list.length, byLevel, buckets: BUCKETS };
    files["data/meta.json"] = JSON.stringify(meta, null, 2);
    return { files, meta };
  }

  g.ITW = { VERSION, BUCKETS, ITER, LEVELS, esc, normId, normPw, bucketOf, bucketFile, derive, encrypt, decrypt, semKey, semLabel, fmtThaiDate, readDBF, parseZip, buildFiles, pool };
})(window);
