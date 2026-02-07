/* Homework Tracker - Static (GitHub Pages)
   - Data stored in localStorage
   - Demo accounts: teacher + students
   - Teacher can create assignments, view dashboard, generate student QR, scan QR to mark submissions
*/

const LS_KEY = "hw_tracker_v1";

const $ = (id) => document.getElementById(id);

function nowISO() { return new Date().toISOString(); }
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
}
function uid(prefix="id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function seedData() {
  return {
    version: 1,
    users: [
      { id:"t1", role:"teacher", name:"ครูน้ำ", classId:"c1" },
      { id:"s1", role:"student", name:"นักเรียน เอ", classId:"c1", studentNo:1 },
      { id:"s2", role:"student", name:"นักเรียน บี", classId:"c1", studentNo:2 },
      { id:"s3", role:"student", name:"นักเรียน ซี", classId:"c1", studentNo:3 },
    ],
    classes: [
      { id:"c1", name:"ป.6/1" }
    ],
    assignments: [
      {
        id:"a1",
        classId:"c1",
        title:"การบ้านวิทย์: สรุปเรื่องเมฆ",
        detail:"สรุปชนิดของเมฆ 3 ชนิด พร้อมวาดภาพประกอบในสมุด",
        dueAt: new Date(Date.now()+3*24*3600*1000).toISOString(),
        createdAt: nowISO(),
        createdBy:"t1"
      }
    ],
    submissions: [
      // { id, assignmentId, studentId, status:"SUBMITTED", submittedAt, method:"QR" }
    ],
    session: null
  };
}

function loadDB() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) {
    const db = seedData();
    localStorage.setItem(LS_KEY, JSON.stringify(db));
    return db;
  }
  try { return JSON.parse(raw); }
  catch {
    const db = seedData();
    localStorage.setItem(LS_KEY, JSON.stringify(db));
    return db;
  }
}
function saveDB(db) {
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

let db = loadDB();

function setSession(userId) {
  db.session = { userId, at: nowISO() };
  saveDB(db);
}
function clearSession() {
  db.session = null;
  saveDB(db);
}
function getMe() {
  if (!db.session?.userId) return null;
  return db.users.find(u => u.id === db.session.userId) || null;
}
function getClassById(classId) {
  return db.classes.find(c => c.id === classId);
}
function getStudentsInClass(classId) {
  return db.users.filter(u => u.role==="student" && u.classId===classId).sort((a,b)=>a.studentNo-b.studentNo);
}
function getTeacherClass(teacher) {
  return getClassById(teacher.classId);
}
function getAssignments(classId) {
  return db.assignments.filter(a => a.classId===classId).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
}
function getSubmission(assignmentId, studentId) {
  return db.submissions.find(s => s.assignmentId===assignmentId && s.studentId===studentId) || null;
}
function upsertSubmission({assignmentId, studentId, method="QR"}) {
  let s = getSubmission(assignmentId, studentId);
  if (!s) {
    s = { id: uid("sub"), assignmentId, studentId, status:"SUBMITTED", submittedAt: nowISO(), method };
    db.submissions.push(s);
  } else {
    s.status = "SUBMITTED";
    s.submittedAt = nowISO();
    s.method = method;
  }
  saveDB(db);
  return s;
}

/* ---------------- UI routing ---------------- */

const views = {
  login: $("viewLogin"),
  teacher: $("viewTeacher"),
  student: $("viewStudent"),
};
function showOnly(which) {
  Object.entries(views).forEach(([k, el]) => el.style.display = (k===which ? "" : "none"));
}

function setWho(text) { $("who").textContent = text; }

function refreshLoginSelect() {
  const sel = $("demoUser");
  sel.innerHTML = "";
  db.users.forEach(u => {
    const opt = document.createElement("option");
    opt.value = u.id;
    opt.textContent = `${u.role==="teacher" ? "👩‍🏫" : "👩‍🎓"} ${u.name} (${u.id})`;
    sel.appendChild(opt);
  });
}

$("loginBtn").addEventListener("click", () => {
  const userId = $("demoUser").value;
  setSession(userId);
  boot();
});

$("resetBtn").addEventListener("click", () => {
  localStorage.removeItem(LS_KEY);
  db = loadDB();
  refreshLoginSelect();
  boot();
  alert("รีเซ็ตข้อมูลเดโมแล้ว");
});

$("logoutBtn").addEventListener("click", () => {
  stopScanner();
  clearSession();
  boot();
});

/* ---------------- Teacher navigation ---------------- */

let teacherTab = "dashboard"; // dashboard | tasks | qr | scan

$("navTeacherDashboard").addEventListener("click", ()=>{ teacherTab="dashboard"; renderTeacher(); });
$("navTeacherTasks").addEventListener("click", ()=>{ teacherTab="tasks"; renderTeacher(); });
$("navTeacherQR").addEventListener("click", ()=>{ teacherTab="qr"; renderTeacher(); });
$("navTeacherScan").addEventListener("click", ()=>{ teacherTab="scan"; renderTeacher(); });

/* ---------------- Student navigation ---------------- */

let studentTab = "home"; // home | profile
$("navStudentHome").addEventListener("click", ()=>{ studentTab="home"; renderStudent(); });
$("navStudentProfile").addEventListener("click", ()=>{ studentTab="profile"; renderStudent(); });

/* ---------------- Teacher screens ---------------- */

function teacherQuickSummary(teacher) {
  const classId = teacher.classId;
  const students = getStudentsInClass(classId);
  const assignments = getAssignments(classId);
  const totalCells = students.length * assignments.length;
  let submitted=0;
  for (const a of assignments) {
    for (const s of students) {
      if (getSubmission(a.id, s.id)) submitted++;
    }
  }
  const pending = totalCells - submitted;
  const pct = totalCells ? Math.round((submitted/totalCells)*100) : 0;

  $("teacherQuick").innerHTML = `
    <div class="row sp">
      <div>
        <div class="muted tiny">ห้อง</div>
        <div style="font-weight:800;font-size:18px">${getClassById(classId)?.name || "-"}</div>
      </div>
      <div class="right">
        <div class="muted tiny">อัปเดต</div>
        <div class="tiny">${fmtDate(nowISO())}</div>
      </div>
    </div>
    <div class="hr"></div>
    <div class="row sp">
      <div class="badge"><span class="dot ok"></span>ส่งแล้ว: <b>${submitted}</b></div>
      <div class="badge"><span class="dot bad"></span>ค้าง: <b>${pending}</b></div>
      <div class="badge"><span class="dot warn"></span>ความคืบหน้า: <b>${pct}%</b></div>
    </div>
    <div style="margin-top:10px" class="progress"><div class="bar" style="width:${pct}%"></div></div>
    <div class="muted tiny" style="margin-top:8px">*นับรวมทุกงาน x นักเรียนในห้อง</div>
  `;
}

function renderTeacherDashboard(teacher) {
  const classId = teacher.classId;
  const students = getStudentsInClass(classId);
  const assignments = getAssignments(classId);

  const rows = students.map(st => {
    let done=0;
    for (const a of assignments) if (getSubmission(a.id, st.id)) done++;
    const pending = assignments.length - done;
    return { st, done, pending };
  }).sort((a,b)=> b.pending-a.pending);

  let html = `
    <h3>ภาพรวมรายคน</h3>
    <table>
      <thead>
        <tr>
          <th>นักเรียน</th>
          <th class="right">ส่งแล้ว</th>
          <th class="right">ค้าง</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r=>`
          <tr>
            <td>${r.st.studentNo}. ${r.st.name}</td>
            <td class="right">${r.done}/${assignments.length}</td>
            <td class="right"><b style="color:${r.pending>0?'#ffcc66':'#44d19d'}">${r.pending}</b></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <div class="hr"></div>
    <h3>ตารางสถานะ (นักเรียน x งาน)</h3>
    <div class="muted tiny">คลิก “สแกนส่งงาน” เพื่อบันทึกส่งแบบรวดเร็ว</div>
  `;

  // matrix table
  html += `
    <div style="overflow:auto;margin-top:10px;border:1px solid var(--line);border-radius:14px">
      <table>
        <thead>
          <tr>
            <th style="min-width:160px">นักเรียน</th>
            ${assignments.map(a=>`<th style="min-width:180px">${a.title}<div class="muted tiny">Due: ${fmtDate(a.dueAt)}</div></th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${students.map(st=>{
            return `
              <tr>
                <td><b>${st.studentNo}. ${st.name}</b></td>
                ${assignments.map(a=>{
                  const sub = getSubmission(a.id, st.id);
                  if (sub) {
                    return `<td><span class="badge"><span class="dot ok"></span>ส่งแล้ว<div class="muted tiny">(${sub.method} • ${fmtDate(sub.submittedAt)})</div></span></td>`;
                  }
                  const late = new Date() > new Date(a.dueAt);
                  return `<td><span class="badge"><span class="dot ${late?'bad':'warn'}"></span>${late?'ค้าง (เลยกำหนด)':'ค้าง'}</span></td>`;
                }).join("")}
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;

  $("teacherPanel").innerHTML = html;
}

function renderTeacherTasks(teacher) {
  const classId = teacher.classId;
  const assignments = getAssignments(classId);

  $("teacherPanel").innerHTML = `
    <h3>สร้างงานใหม่</h3>
    <div class="two">
      <div>
        <label>ชื่องาน</label>
        <input id="newTitle" placeholder="เช่น การบ้านคณิต: แบบฝึกหัดหน้า 12" />
      </div>
      <div>
        <label>กำหนดส่ง</label>
        <input id="newDue" type="datetime-local" />
      </div>
    </div>
    <label>รายละเอียด</label>
    <textarea id="newDetail" placeholder="คำอธิบายงาน / วิธีส่ง / เกณฑ์ตรวจ ฯลฯ"></textarea>
    <div class="row" style="margin-top:10px">
      <button id="createTaskBtn">สร้างงาน</button>
      <button id="clearAllSubsBtn" class="danger">ล้างสถานะการส่งทั้งหมด (เดโม)</button>
    </div>

    <div class="hr"></div>
    <h3>งานทั้งหมด</h3>
    <table>
      <thead>
        <tr>
          <th>งาน</th>
          <th>กำหนดส่ง</th>
          <th class="right">การจัดการ</th>
        </tr>
      </thead>
      <tbody>
        ${assignments.map(a=>`
          <tr>
            <td><b>${a.title}</b><div class="muted tiny">${a.detail || ""}</div></td>
            <td>${fmtDate(a.dueAt)}</td>
            <td class="right">
              <button class="secondary" data-del="${a.id}">ลบ</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  $("createTaskBtn").addEventListener("click", () => {
    const title = $("newTitle").value.trim();
    const detail = $("newDetail").value.trim();
    const dueLocal = $("newDue").value; // "YYYY-MM-DDTHH:mm"
    if (!title) return alert("กรุณาใส่ชื่องาน");
    if (!dueLocal) return alert("กรุณาเลือกกำหนดส่ง");

    const dueAt = new Date(dueLocal).toISOString();
    db.assignments.push({
      id: uid("a"),
      classId,
      title,
      detail,
      dueAt,
      createdAt: nowISO(),
      createdBy: teacher.id
    });
    saveDB(db);
    renderTeacher();
  });

  document.querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-del");
      // delete assignment and its submissions
      db.assignments = db.assignments.filter(a=>a.id!==id);
      db.submissions = db.submissions.filter(s=>s.assignmentId!==id);
      saveDB(db);
      renderTeacher();
    });
  });

  $("clearAllSubsBtn").addEventListener("click", ()=>{
    if (!confirm("ยืนยันล้างสถานะการส่งทั้งหมด?")) return;
    db.submissions = [];
    saveDB(db);
    renderTeacher();
  });
}

function renderTeacherQR(teacher) {
  const classId = teacher.classId;
  const students = getStudentsInClass(classId);

  $("teacherPanel").innerHTML = `
    <h3>QR นักเรียน (แปะสมุด)</h3>
    <div class="muted tiny">QR นี้เป็นแบบ “ประจำสมุด/นักเรียน” (payload = studentId) ครูสามารถพิมพ์หน้านี้แล้วตัดแปะได้</div>
    <div class="hr"></div>
    <div class="qr-box" id="qrList"></div>
    <div class="hr"></div>
    <div class="row">
      <button class="secondary" id="printQR">พิมพ์หน้านี้</button>
    </div>
  `;

  const list = $("qrList");
  list.innerHTML = "";
  students.forEach(st=>{
    const wrap = document.createElement("div");
    wrap.className = "qr-item";
    wrap.innerHTML = `
      <div class="name">${st.studentNo}. ${st.name}</div>
      <div class="muted tiny">Student ID: <span class="mono">${st.id}</span></div>
      <div id="qr_${st.id}" style="margin-top:10px"></div>
      <div class="muted tiny" style="margin-top:8px">*แนะนำพิมพ์แล้วเคลือบ/แปะสมุด</div>
    `;
    list.appendChild(wrap);

    // Generate QR with payload
    const payload = JSON.stringify({ type:"STUDENT", studentId: st.id });
    new QRCode($(`qr_${st.id}`), { text: payload, width: 140, height: 140 });
  });

  $("printQR").addEventListener("click", ()=> window.print());
}

/* ----------- QR SCANNER ----------- */

let scanner = {
  running: false,
  stream: null,
  raf: null,
  currentAssignmentId: null,
};

function renderTeacherScan(teacher) {
  const classId = teacher.classId;
  const assignments = getAssignments(classId);

  $("teacherPanel").innerHTML = `
    <h3>สแกน QR เพื่อบันทึกการส่งงาน</h3>
    <div class="muted tiny">ขั้นตอน: 1) เลือกงาน 2) กดเริ่มสแกน 3) สแกน QR จากสมุดนักเรียน</div>

    <label>เลือกงาน</label>
    <select id="scanAssignment">
      <option value="">-- เลือกงาน --</option>
      ${assignments.map(a=>`<option value="${a.id}">${a.title} (Due ${fmtDate(a.dueAt)})</option>`).join("")}
    </select>

    <div class="row" style="margin-top:10px">
      <button id="startScanBtn">เริ่มสแกน</button>
      <button id="stopScanBtn" class="secondary" disabled>หยุดสแกน</button>
      <button id="manualBtn" class="secondary">บันทึกแบบใส่ Student ID เอง</button>
    </div>

    <div class="hr"></div>

    <video id="video" playsinline></video>
    <canvas id="canvas"></canvas>

    <div class="hr"></div>
    <div id="scanResult" class="toast tiny">ยังไม่ได้เริ่มสแกน</div>
  `;

  $("startScanBtn").addEventListener("click", async ()=>{
    const aid = $("scanAssignment").value;
    if (!aid) return alert("กรุณาเลือกงานก่อน");
    scanner.currentAssignmentId = aid;
    await startScanner(teacher);
  });

  $("stopScanBtn").addEventListener("click", ()=>{
    stopScanner();
    $("scanResult").innerHTML = "หยุดสแกนแล้ว";
  });

  $("manualBtn").addEventListener("click", ()=>{
    const aid = $("scanAssignment").value;
    if (!aid) return alert("กรุณาเลือกงานก่อน");
    const studentId = prompt("ใส่ Student ID (เช่น s1, s2, s3)");
    if (!studentId) return;
    const student = db.users.find(u=>u.id===studentId && u.role==="student" && u.classId===teacher.classId);
    if (!student) return alert("ไม่พบ Student ID ในห้องนี้");
    const sub = upsertSubmission({ assignmentId: aid, studentId, method:"MANUAL" });
    $("scanResult").innerHTML = `✅ บันทึกส่งแล้ว: <b>${student.name}</b> (${student.id}) เวลา ${fmtDate(sub.submittedAt)}`;
    teacherQuickSummary(teacher);
  });
}

async function startScanner(teacher) {
  if (scanner.running) return;

  const video = $("video");
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });
    scanner.stream = stream;
    video.srcObject = stream;
    await video.play();
    scanner.running = true;

    $("startScanBtn").disabled = true;
    $("stopScanBtn").disabled = false;

    $("scanResult").innerHTML = `กำลังสแกน... (งาน: <b>${db.assignments.find(a=>a.id===scanner.currentAssignmentId)?.title}</b>)`;

    const tick = () => {
      if (!scanner.running) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });

        if (code?.data) {
          const parsed = safeParseQR(code.data);
          if (parsed?.type === "STUDENT" && parsed.studentId) {
            const student = db.users.find(u=>u.id===parsed.studentId && u.role==="student" && u.classId===teacher.classId);
            if (!student) {
              $("scanResult").innerHTML = `⚠️ พบ QR แต่ไม่ใช่นักเรียนในห้องนี้`;
            } else {
              const sub = upsertSubmission({ assignmentId: scanner.currentAssignmentId, studentId: student.id, method:"QR" });
              $("scanResult").innerHTML = `✅ บันทึกส่งแล้ว: <b>${student.studentNo}. ${student.name}</b> เวลา ${fmtDate(sub.submittedAt)} <span class="muted">(สแกนต่อได้)</span>`;
              teacherQuickSummary(teacher);
            }
          } else {
            $("scanResult").innerHTML = `⚠️ QR ไม่ถูกต้องสำหรับระบบนี้`;
          }
        }
      }
      scanner.raf = requestAnimationFrame(tick);
    };
    scanner.raf = requestAnimationFrame(tick);

  } catch (e) {
    console.error(e);
    alert("เปิดกล้องไม่สำเร็จ: กรุณาอนุญาต Permission หรือใช้ HTTPS");
    stopScanner();
  }
}

function stopScanner() {
  scanner.running = false;
  if (scanner.raf) cancelAnimationFrame(scanner.raf);
  scanner.raf = null;

  if (scanner.stream) {
    scanner.stream.getTracks().forEach(t=>t.stop());
    scanner.stream = null;
  }

  const video = $("video");
  if (video) video.srcObject = null;

  const startBtn = $("startScanBtn");
  const stopBtn = $("stopScanBtn");
  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
}

function safeParseQR(text) {
  // allow JSON payload only
  try {
    const obj = JSON.parse(text);
    return obj;
  } catch {
    return null;
  }
}

/* ---------------- Student screens ---------------- */

function renderStudentHome(student) {
  const assignments = getAssignments(student.classId);

  const items = assignments.map(a=>{
    const sub = getSubmission(a.id, student.id);
    const isLate = !sub && new Date() > new Date(a.dueAt);
    const status = sub ? { label:"ส่งแล้ว", cls:"ok", detail:`${sub.method} • ${fmtDate(sub.submittedAt)}` }
                      : isLate ? { label:"ค้าง (เลยกำหนด)", cls:"bad", detail:`Due ${fmtDate(a.dueAt)}` }
                               : { label:"ค้าง", cls:"warn", detail:`Due ${fmtDate(a.dueAt)}` };
    return `
      <tr>
        <td>
          <b>${a.title}</b>
          <div class="muted tiny">${a.detail || ""}</div>
        </td>
        <td><span class="badge"><span class="dot ${status.cls}"></span>${status.label}</span><div class="muted tiny">${status.detail}</div></td>
      </tr>
    `;
  }).join("");

  $("studentPanel").innerHTML = `
    <h3>รายการงาน</h3>
    <table>
      <thead>
        <tr><th>งาน</th><th>สถานะ</th></tr>
      </thead>
      <tbody>${items || `<tr><td colspan="2" class="muted">ยังไม่มีงาน</td></tr>`}</tbody>
    </table>
    <div class="hr"></div>
    <div class="toast tiny"><b>หมายเหตุ:</b> การส่งแบบ QR จะถูกบันทึกเมื่อครูสแกนจากสมุด/หน้าปะ</div>
  `;
}

function renderStudentProfile(student) {
  const cls = getClassById(student.classId);
  $("studentPanel").innerHTML = `
    <h3>โปรไฟล์</h3>
    <div class="toast">
      <div><b>ชื่อ:</b> ${student.name}</div>
      <div><b>เลขที่:</b> ${student.studentNo}</div>
      <div><b>ห้อง:</b> ${cls?.name || "-"}</div>
      <div><b>Student ID:</b> ${student.id}</div>
    </div>
  `;
}

function renderStudentProgress(student) {
  const assignments = getAssignments(student.classId);
  const total = assignments.length;
  let done = 0;
  for (const a of assignments) if (getSubmission(a.id, student.id)) done++;
  const pending = total - done;
  const pct = total ? Math.round((done/total)*100) : 0;

  $("studentProgress").innerHTML = `
    <div class="row sp">
      <div class="badge"><span class="dot ok"></span>ส่งแล้ว: <b>${done}</b></div>
      <div class="badge"><span class="dot warn"></span>ค้าง: <b>${pending}</b></div>
      <div class="badge"><span class="dot"></span>รวม: <b>${total}</b></div>
    </div>
    <div style="margin-top:10px" class="progress"><div class="bar" style="width:${pct}%"></div></div>
    <div class="muted tiny" style="margin-top:8px">${pct}% ของงานทั้งหมด</div>
  `;
}

/* ---------------- render main ---------------- */

function renderTeacher() {
  const teacher = getMe();
  if (!teacher) return;
  teacherQuickSummary(teacher);

  if (teacherTab === "dashboard") renderTeacherDashboard(teacher);
  if (teacherTab === "tasks") { stopScanner(); renderTeacherTasks(teacher); }
  if (teacherTab === "qr") { stopScanner(); renderTeacherQR(teacher); }
  if (teacherTab === "scan") renderTeacherScan(teacher);
}

function renderStudent() {
  const student = getMe();
  if (!student) return;
  stopScanner();
  renderStudentProgress(student);

  if (studentTab === "home") renderStudentHome(student);
  if (studentTab === "profile") renderStudentProfile(student);
}

function boot() {
  db = loadDB();
  refreshLoginSelect();

  const me = getMe();
  if (!me) {
    setWho("ยังไม่ได้ล็อกอิน");
    $("logoutBtn").style.display = "none";
    showOnly("login");
    return;
  }

  $("logoutBtn").style.display = "";
  const cls = me.classId ? getClassById(me.classId)?.name : "";
  setWho(`${me.role==="teacher" ? "👩‍🏫" : "👩‍🎓"} ${me.name} • ${cls || ""}`);

  if (me.role === "teacher") {
    showOnly("teacher");
    renderTeacher();
  } else {
    showOnly("student");
    renderStudent();
  }
}

window.addEventListener("beforeunload", ()=> stopScanner());
boot();
