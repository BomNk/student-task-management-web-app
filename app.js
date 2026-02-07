import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs,
  query, orderBy, where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================
   0) PUT YOUR firebaseConfig
   ========================= */
const firebaseConfig = {
  // PASTE_HERE
 apiKey: "AIzaSyCwRebNtj7kO5HjT6lTrd6TB4RiF2GaXrQ",
  authDomain: "student-task-managment-10db2.firebaseapp.com",
  projectId: "student-task-managment-10db2",
  storageBucket: "student-task-managment-10db2.firebasestorage.app",
  messagingSenderId: "842785693250",
  appId: "1:842785693250:web:3ee013db1cdb791f0697db",
  measurementId: "G-C5C1LETW6M"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);

const views = {
  login: $("viewLogin"),
  teacher: $("viewTeacher"),
  student: $("viewStudent")
};
function showOnly(which) {
  Object.entries(views).forEach(([k, el]) => (el.style.display = (k === which ? "" : "none")));
}
function setWho(text) { $("who").textContent = text; }

function errMsg(e) {
  const m = (e?.message || String(e));
  if (m.includes("auth/invalid-credential")) return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  if (m.includes("auth/email-already-in-use")) return "อีเมลนี้ถูกใช้แล้ว";
  if (m.includes("auth/weak-password")) return "รหัสผ่านสั้นเกินไป (อย่างน้อย 6 ตัว)";
  if (m.includes("auth/unauthorized-domain")) return "unauthorized-domain: เพิ่มโดเมน GitHub Pages ใน Authorized domains";
  if (m.includes("permission-denied")) return "permission-denied: Firestore Rules ไม่อนุญาต";
  return m;
}
function fmtDateTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleString(undefined, { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
}
function safe(v){ return (v===undefined || v===null) ? "" : String(v); }

/* =========================
   1) Auth UI
   ========================= */
$("loginBtn").addEventListener("click", async () => {
  $("loginMsg").textContent = "";
  const email = $("email").value.trim();
  const pass = $("pass").value;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    $("loginMsg").textContent = "❌ " + errMsg(e);
  }
});

$("signupBtn").addEventListener("click", async () => {
  $("loginMsg").textContent = "";
  const email = $("email").value.trim();
  const pass = $("pass").value;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, "users", cred.user.uid), {
      email,
      name: "",
      role: "student",
      classId: "",
      studentNo: null,
      createdAt: Date.now()
    }, { merge: true });
  } catch (e) {
    $("loginMsg").textContent = "❌ " + errMsg(e);
  }
});

$("logoutBtn").addEventListener("click", async () => {
  stopScanner();
  await signOut(auth);
});

/* =========================
   2) Profile
   ========================= */
async function getMyProfile(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { uid, ...snap.data() };
}

/* =========================
   3) Caches + student state
   ========================= */
let cacheClasses = [];
let cacheUsers = [];
let cacheAssignments = [];
let cacheSubmissions = [];

let studentFilter = "all";        // all | pending | submitted | late | dueSoon
const DUE_SOON_HOURS = 24;

async function loadClasses() {
  // ใช้ orderBy ได้ ถ้าติด index เปลี่ยนเป็น getDocs(collection(...)) แล้ว sort client-side
  const qs = await getDocs(query(collection(db, "classes"), orderBy("name")));
  cacheClasses = qs.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function loadUsers() {
  // ไม่ใช้ orderBy เพื่อลดปัญหา index
  const qs = await getDocs(collection(db, "users"));
  cacheUsers = qs.docs.map(d => ({ uid: d.id, ...d.data() }));
  cacheUsers.sort((a,b)=>{
    const ra = a.role || "", rb = b.role || "";
    if (ra !== rb) return ra.localeCompare(rb);
    const ca = a.classId || "", cb = b.classId || "";
    if (ca !== cb) return ca.localeCompare(cb);
    return (Number(a.studentNo||9999) - Number(b.studentNo||9999));
  });
}

// teacher: all assignments, student: where classId==myClass
async function loadAssignmentsFor(role, classId) {
  if (role === "teacher") {
    const qs = await getDocs(query(collection(db, "assignments"), orderBy("createdAt", "desc")));
    cacheAssignments = qs.docs.map(d => ({ id: d.id, ...d.data() }));
    return;
  }
  const qs = await getDocs(query(
    collection(db, "assignments"),
    where("classId", "==", classId),
    orderBy("createdAt", "desc")
  ));
  cacheAssignments = qs.docs.map(d => ({ id: d.id, ...d.data() }));
}

// teacher: all submissions, student: where studentUid==me
async function loadSubmissionsFor(role, studentUid) {
  if (role === "teacher") {
    const qs = await getDocs(query(collection(db, "submissions"), orderBy("submittedAt", "desc")));
    cacheSubmissions = qs.docs.map(d => ({ id: d.id, ...d.data() }));
    return;
  }
  const qs = await getDocs(query(
    collection(db, "submissions"),
    where("studentUid", "==", studentUid),
    orderBy("submittedAt", "desc")
  ));
  cacheSubmissions = qs.docs.map(d => ({ id: d.id, ...d.data() }));
}

function classNameOf(id) {
  const c = cacheClasses.find(x => x.id === id);
  return c ? `${c.name} (${c.id})` : (id || "-");
}
function getAssignmentsForClass(classId) {
  return cacheAssignments.filter(a => a.classId === classId);
}
function findSubmission(assignmentId, studentUid) {
  return cacheSubmissions.find(s => s.assignmentId === assignmentId && s.studentUid === studentUid) || null;
}
async function upsertSubmission({ assignmentId, studentUid, classId, method, scannedBy }) {
  const id = `${assignmentId}_${studentUid}`;
  await setDoc(doc(db, "submissions", id), {
    assignmentId,
    studentUid,
    classId,
    status: "SUBMITTED",
    submittedAt: Date.now(),
    method,
    scannedBy: scannedBy || null
  }, { merge: true });
}
async function deleteSubmission(assignmentId, studentUid) {
  const id = `${assignmentId}_${studentUid}`;
  await deleteDoc(doc(db, "submissions", id));
}

/* =========================
   4) Teacher navigation
   ========================= */
let teacherTab = "dashboard";

$("navTeacherDashboard").addEventListener("click", () => { stopScanner(); teacherTab = "dashboard"; renderTeacher(); });
$("navTeacherTasks").addEventListener("click", () => { stopScanner(); teacherTab = "tasks"; renderTeacher(); });
$("navTeacherQR").addEventListener("click", () => { stopScanner(); teacherTab = "qr"; renderTeacher(); });
$("navTeacherScan").addEventListener("click", () => { teacherTab = "scan"; renderTeacher(); });
$("navTeacherUsers").addEventListener("click", () => { stopScanner(); teacherTab = "users"; renderTeacher(); });
$("navTeacherClasses").addEventListener("click", () => { stopScanner(); teacherTab = "classes"; renderTeacher(); });

/* =========================
   5) Teacher Quick
   ========================= */
function renderTeacherQuick(me) {
  const totalUsers = cacheUsers.length;
  const teachers = cacheUsers.filter(u => u.role === "teacher").length;
  const students = cacheUsers.filter(u => u.role === "student").length;

  $("teacherQuick").innerHTML = `
    <div class="row sp">
      <div class="badge"><span class="dot ok"></span>Teachers: <b>${teachers}</b></div>
      <div class="badge"><span class="dot warn"></span>Students: <b>${students}</b></div>
      <div class="badge"><span class="dot"></span>Total users: <b>${totalUsers}</b></div>
    </div>
    <div class="hr"></div>
    <div class="muted tiny">
      ล็อกอินเป็น: <b>${me.email || "-"}</b><br>
      uid: ${me.uid}
    </div>
  `;
}

/* =========================
   6) Teacher - Classes
   ========================= */
function renderClasses(me) {
  $("teacherPanel").innerHTML = `
    <div class="row sp">
      <h3>Classes</h3>
      <button id="refreshClassesBtn" class="secondary">รีเฟรช</button>
    </div>

    <div class="two">
      <div>
        <label>ชื่อห้อง</label>
        <input id="c_name" placeholder="เช่น ป.6/1" />
      </div>
      <div>
        <label>หมายเหตุ</label>
        <input id="c_note" placeholder="optional" />
      </div>
    </div>
    <div class="row" style="margin-top:10px">
      <button id="addClassBtn">เพิ่ม Class</button>
    </div>

    <div class="hr"></div>

    <div style="overflow:auto;border:1px solid var(--line);border-radius:14px">
      <table>
        <thead><tr><th>Class</th><th>Note</th></tr></thead>
        <tbody>
          ${cacheClasses.map(c=>`
            <tr>
              <td><b>${c.name}</b><div class="muted tiny">id: ${c.id}</div></td>
              <td>${c.note || "-"}</td>
            </tr>
          `).join("") || `<tr><td colspan="2" class="muted">ยังไม่มี class</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  $("refreshClassesBtn").addEventListener("click", async ()=>{
    await loadClasses();
    renderClasses(me);
  });

  $("addClassBtn").addEventListener("click", async ()=>{
    try{
      const name = $("c_name").value.trim();
      const note = $("c_note").value.trim();
      if (!name) throw new Error("กรุณาใส่ชื่อห้อง");

      const ref = await addDoc(collection(db, "classes"), { name, note, createdAt: Date.now() });

      $("c_name").value = "";
      $("c_note").value = "";
      await loadClasses();
      renderClasses(me);
      alert("✅ เพิ่ม class แล้ว (id: "+ref.id+")");
    } catch(e) {
      alert("❌ " + errMsg(e));
    }
  });
}

/* =========================
   7) Teacher - Tasks
   ========================= */
async function renderTeacherTasks(me) {
  await loadAssignmentsFor("teacher");

  const classOptions = cacheClasses.map(c => `<option value="${c.id}">${c.name} (${c.id})</option>`).join("");

  $("teacherPanel").innerHTML = `
    <h3>Tasks / Assignments</h3>
    <div class="toast tiny">สร้างงาน → ครูสแกน/Barcode/Manual เพื่อบันทึกส่ง (นักเรียนอ่านอย่างเดียว)</div>
    <div class="hr"></div>

    <h3>สร้างงานใหม่</h3>
    <div class="two">
      <div>
        <label>Class</label>
        <select id="t_classId">${classOptions || `<option value="">ไม่มี class</option>`}</select>
      </div>
      <div>
        <label>กำหนดส่ง</label>
        <input id="t_due" type="datetime-local"/>
      </div>
    </div>

    <label>ชื่องาน</label>
    <input id="t_title" placeholder="เช่น การบ้านวิทย์: สรุปเรื่องเมฆ" />

    <label>รายละเอียด</label>
    <textarea id="t_detail" placeholder="รายละเอียดงาน / วิธีทำ / เกณฑ์ตรวจ"></textarea>

    <div class="row" style="margin-top:10px">
      <button id="createTaskBtn">สร้างงาน</button>
      <button id="reloadTasksBtn" class="secondary">รีเฟรช</button>
    </div>

    <div class="hr"></div>
    <h3>งานทั้งหมด</h3>
    <div style="overflow:auto;border:1px solid var(--line);border-radius:14px">
      <table>
        <thead>
          <tr>
            <th style="min-width:260px">งาน</th>
            <th style="min-width:200px">Class</th>
            <th style="min-width:180px">Due</th>
            <th class="right" style="min-width:120px">Action</th>
          </tr>
        </thead>
        <tbody>
          ${cacheAssignments.map(a => `
            <tr>
              <td><b>${a.title}</b><div class="muted tiny">${a.detail || ""}</div></td>
              <td>${classNameOf(a.classId)}</td>
              <td>${fmtDateTime(a.dueAt)}</td>
              <td class="right">
                <button class="danger" data-del-task="${a.id}">ลบ</button>
              </td>
            </tr>
          `).join("") || `<tr><td colspan="4" class="muted">ยังไม่มีงาน</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  $("reloadTasksBtn").addEventListener("click", async ()=>{
    await loadAssignmentsFor("teacher");
    await renderTeacherTasks(me);
  });

  $("createTaskBtn").addEventListener("click", async ()=>{
    try{
      const classId = $("t_classId").value;
      const dueLocal = $("t_due").value;
      const title = $("t_title").value.trim();
      const detail = $("t_detail").value.trim();

      if (!classId) throw new Error("กรุณาเลือก Class");
      if (!dueLocal) throw new Error("กรุณาเลือกกำหนดส่ง");
      if (!title) throw new Error("กรุณาใส่ชื่องาน");

      const dueAt = new Date(dueLocal).getTime();

      await addDoc(collection(db, "assignments"), {
        classId,
        title,
        detail,
        dueAt,
        createdAt: Date.now(),
        createdBy: me.uid
      });

      $("t_title").value = "";
      $("t_detail").value = "";
      await loadAssignmentsFor("teacher");
      await renderTeacherTasks(me);
      alert("✅ สร้างงานแล้ว");
    } catch(e) {
      alert("❌ " + errMsg(e));
    }
  });

  document.querySelectorAll("[data-del-task]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.getAttribute("data-del-task");
      if (!confirm("ยืนยันลบงานนี้?")) return;
      await deleteDoc(doc(db, "assignments", id));
      await loadAssignmentsFor("teacher");
      await renderTeacherTasks(me);
    });
  });
}

/* =========================
   8) Teacher - QR generate
   ========================= */
async function renderTeacherQR(me) {
  await loadUsers();
  await loadClasses();

  const classOptions = cacheClasses.map(c=>`<option value="${c.id}">${c.name} (${c.id})</option>`).join("");

  $("teacherPanel").innerHTML = `
    <h3>QR นักเรียน</h3>
    <div class="toast tiny">พิมพ์ QR แปะสมุด (payload = {type:"STUDENT", uid:"..."})</div>

    <label>เลือก Class</label>
    <select id="qr_class">${classOptions || `<option value="">ไม่มี class</option>`}</select>

    <div class="hr"></div>
    <div id="qrList" style="display:flex;gap:14px;flex-wrap:wrap"></div>
    <div class="hr"></div>
    <button id="printQR" class="secondary">พิมพ์หน้านี้</button>
  `;

  const renderList = (classId) => {
    const list = $("qrList");
    list.innerHTML = "";
    const students = cacheUsers
      .filter(u=>u.role==="student" && u.classId===classId)
      .sort((a,b)=>(a.studentNo||999)-(b.studentNo||999));

    students.forEach(st=>{
      const box = document.createElement("div");
      box.style.width="220px";
      box.style.padding="12px";
      box.style.border="1px solid var(--line)";
      box.style.borderRadius="16px";
      box.style.background="#0c152b";
      box.innerHTML = `
        <div style="font-weight:800">${st.studentNo ?? "-"} . ${st.name || "-"}</div>
        <div class="muted tiny">${st.email || ""}</div>
        <div id="qr_${st.uid}" style="margin-top:10px"></div>
        <div class="muted tiny" style="margin-top:8px">uid: ${st.uid}</div>
      `;
      list.appendChild(box);

      const payload = JSON.stringify({ type:"STUDENT", uid: st.uid });
      new window.QRCode(document.getElementById(`qr_${st.uid}`), { text: payload, width: 140, height: 140 });
    });
  };

  const sel = $("qr_class");
  if (sel.value) renderList(sel.value);
  sel.addEventListener("change", ()=>renderList(sel.value));

  $("printQR").addEventListener("click", ()=>window.print());
}

/* =========================
   9) Teacher - Dashboard รายคนในห้อง
   ========================= */
async function renderTeacherDashboard(me) {
  await loadClasses();
  await loadUsers();
  await loadAssignmentsFor("teacher");
  await loadSubmissionsFor("teacher");

  const classOptions = cacheClasses.map(c => `<option value="${c.id}">${c.name} (${c.id})</option>`).join("");
  const firstClassId = cacheClasses[0]?.id || "";

  $("teacherPanel").innerHTML = `
    <div class="row sp">
      <h3>Dashboard รายคน</h3>
      <div class="row"><button id="dashReload" class="secondary">รีเฟรช</button></div>
    </div>

    <div class="two">
      <div>
        <label>เลือก Class</label>
        <select id="dashClass">${classOptions || `<option value="">ไม่มี class</option>`}</select>
      </div>
      <div>
        <label>ดูรายละเอียดนักเรียน</label>
        <select id="dashStudent"><option value="">-- เลือกนักเรียน --</option></select>
      </div>
    </div>

    <div class="hr"></div>
    <div id="dashTable"></div>

    <div class="hr"></div>
    <div id="dashDetail" class="toast tiny">ยังไม่ได้เลือกนักเรียน</div>
  `;

  $("dashClass").value = firstClassId;

  const render = (classId) => {
    const students = cacheUsers
      .filter(u => u.role === "student" && u.classId === classId)
      .sort((a,b)=>(a.studentNo||999)-(b.studentNo||999));

    const assigns = cacheAssignments
      .filter(a => a.classId === classId)
      .sort((a,b)=>(a.dueAt||0)-(b.dueAt||0));

    const sSel = $("dashStudent");
    sSel.innerHTML = `<option value="">-- เลือกนักเรียน --</option>` + students.map(s =>
      `<option value="${s.uid}">${s.studentNo ?? "-"} . ${s.name || s.email}</option>`
    ).join("");

    const rows = students.map(s => {
      let done = 0, late = 0, pending = 0;
      for (const a of assigns) {
        const sub = findSubmission(a.id, s.uid);
        if (sub) done++;
        else {
          pending++;
          if (Date.now() > (a.dueAt||0)) late++;
        }
      }
      const total = assigns.length;
      const pct = total ? Math.round((done/total)*100) : 0;

      return `
        <tr>
          <td><b>${s.studentNo ?? "-"} . ${s.name || "-"}</b><div class="muted tiny">${s.email || ""}</div></td>
          <td class="right">${done}/${total}</td>
          <td class="right">${pending}</td>
          <td class="right"><b style="color:${late>0?'#ff6b6b':'#44d19d'}">${late}</b></td>
          <td class="right"><b>${pct}%</b></td>
          <td class="right"><button class="secondary" data-view="${s.uid}">ดูรายละเอียด</button></td>
        </tr>
      `;
    }).join("");

    $("dashTable").innerHTML = `
      <div class="toast tiny">
        งานในห้องนี้ทั้งหมด: <b>${assigns.length}</b> • นักเรียน: <b>${students.length}</b>
      </div>
      <div class="hr"></div>
      <div style="overflow:auto;border:1px solid var(--line);border-radius:14px">
        <table>
          <thead>
            <tr>
              <th style="min-width:260px">นักเรียน</th>
              <th class="right" style="min-width:90px">ส่งแล้ว</th>
              <th class="right" style="min-width:70px">ค้าง</th>
              <th class="right" style="min-width:90px">เลยกำหนด</th>
              <th class="right" style="min-width:90px">Progress</th>
              <th class="right" style="min-width:120px">Action</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="6" class="muted">ยังไม่มีนักเรียน/งาน</td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    const renderDetail = (studentUid) => {
      const student = cacheUsers.find(u => u.uid === studentUid);
      const items = assigns.map(a=>{
        const sub = findSubmission(a.id, studentUid);
        const lateFlag = !sub && Date.now() > (a.dueAt||0);
        const badge = sub
          ? `<span class="badge"><span class="dot ok"></span>ส่งแล้ว</span>`
          : lateFlag
            ? `<span class="badge"><span class="dot bad"></span>ค้าง (เลยกำหนด)</span>`
            : `<span class="badge"><span class="dot warn"></span>ค้าง</span>`;
        const detail = sub ? `บันทึกแล้ว • ${fmtDateTime(sub.submittedAt)} (${sub.method || "-"})` : `Due ${fmtDateTime(a.dueAt)}`;
        return `<li style="margin:8px 0">
          ${badge} <b>${a.title}</b>
          <div class="muted tiny">${detail}${a.detail ? " • " + a.detail : ""}</div>
        </li>`;
      }).join("");

      $("dashDetail").innerHTML = `
        <div><b>รายละเอียด:</b> ${student?.studentNo ?? "-"} . ${student?.name || student?.email || studentUid}</div>
        <div class="hr"></div>
        <ul style="margin:0;padding-left:18px">${items || "<li class='muted'>ยังไม่มีงาน</li>"}</ul>
      `;
    };

    document.querySelectorAll("[data-view]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const uid = btn.getAttribute("data-view");
        sSel.value = uid;
        renderDetail(uid);
      });
    });

    sSel.onchange = () => {
      const uid = sSel.value;
      if (!uid) $("dashDetail").textContent = "ยังไม่ได้เลือกนักเรียน";
      else renderDetail(uid);
    };

    $("dashDetail").textContent = "ยังไม่ได้เลือกนักเรียน";
  };

  $("dashReload").addEventListener("click", async ()=>{
    await loadClasses();
    await loadUsers();
    await loadAssignmentsFor("teacher");
    await loadSubmissionsFor("teacher");
    render($("dashClass").value);
  });

  $("dashClass").addEventListener("change", ()=> render($("dashClass").value));
  render($("dashClass").value);
}

/* =========================
   10) Teacher - USERS (FULL CRUD)
   ========================= */
let usersSelectedUid = "";
let usersFilterRole = "all"; // all | teacher | student
let usersFilterClass = "all";
let usersSearch = "";

function roleBadge(role){
  if (role==="teacher") return `<span class="badge"><span class="dot ok"></span>teacher</span>`;
  return `<span class="badge"><span class="dot warn"></span>student</span>`;
}
function classChip(classId){
  const c = cacheClasses.find(x=>x.id===classId);
  return `<span class="chip">${c?c.name: (classId||"-")}</span>`;
}
function toIntOrNull(v){
  const t = String(v||"").trim();
  if (!t) return null;
  const n = Number(t);
  if (Number.isNaN(n)) return null;
  return n;
}

async function upsertUserProfile(uid, data) {
  await setDoc(doc(db, "users", uid), { ...data, updatedAt: Date.now() }, { merge: true });
}

async function renderTeacherUsers(me) {
  await loadClasses();
  await loadUsers();

  const roleOptions = `
    <option value="all">ทุก role</option>
    <option value="teacher">teacher</option>
    <option value="student">student</option>
  `;
  const classOptions = `<option value="all">ทุกห้อง</option>` +
    cacheClasses.map(c=>`<option value="${c.id}">${c.name} (${c.id})</option>`).join("");

  // list filtered
  const filtered = cacheUsers.filter(u=>{
    if (usersFilterRole!=="all" && (u.role||"student")!==usersFilterRole) return false;
    if (usersFilterClass!=="all" && (u.classId||"")!==usersFilterClass) return false;
    if (usersSearch) {
      const s = usersSearch.toLowerCase();
      const hay = `${u.uid} ${u.email||""} ${u.name||""} ${u.classId||""} ${u.studentNo||""}`.toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });

  // select default if not exist
  if (!usersSelectedUid && filtered.length) usersSelectedUid = filtered[0].uid;
  if (usersSelectedUid && !cacheUsers.find(x=>x.uid===usersSelectedUid)) usersSelectedUid = "";

  const selected = usersSelectedUid ? cacheUsers.find(x=>x.uid===usersSelectedUid) : null;

  const rows = filtered.map(u=>{
    const active = u.uid===usersSelectedUid ? "style='outline:2px solid #7cc2ff'" : "";
    return `
      <tr ${active}>
        <td>
          <b>${u.name || "-"}</b>
          <div class="muted tiny">${u.email || "-"}</div>
          <div class="muted tiny">uid: ${u.uid}</div>
        </td>
        <td>${roleBadge(u.role || "student")}</td>
        <td>${classChip(u.classId || "")}</td>
        <td class="right">${u.studentNo ?? "-"}</td>
        <td class="right">
          <button class="secondary" data-pick="${u.uid}">แก้ไข</button>
        </td>
      </tr>
    `;
  }).join("");

  $("teacherPanel").innerHTML = `
    <div class="row sp">
      <h3>Users</h3>
      <div class="row">
        <button id="usersReload" class="secondary">รีเฟรช</button>
      </div>
    </div>

    <div class="toast tiny">
      <b>สำคัญ:</b> การ “Add User” ที่นี่คือสร้าง/แก้ไขโปรไฟล์ใน Firestore เท่านั้น (ไม่สร้างบัญชี Auth)
      <div class="hr"></div>
      แนะนำ workflow: นักเรียน Sign up → ครูมา assign ห้อง/เลขที่ ที่หน้านี้
    </div>

    <div class="hr"></div>

    <div class="panel2">
      <div>
        <div class="row sp">
          <div class="row">
            <select id="usersRoleFilter" style="max-width:160px">${roleOptions}</select>
            <select id="usersClassFilter" style="max-width:220px">${classOptions}</select>
            <input id="usersSearch" placeholder="ค้นหา name/email/uid/เลขที่..." style="max-width:260px" />
          </div>
          <div class="chip">ทั้งหมดที่แสดง: <b>${filtered.length}</b></div>
        </div>

        <div class="hr"></div>

        <div style="overflow:auto;border:1px solid var(--line);border-radius:14px">
          <table>
            <thead>
              <tr>
                <th style="min-width:280px">ผู้ใช้</th>
                <th style="min-width:110px">Role</th>
                <th style="min-width:160px">Class</th>
                <th class="right" style="min-width:80px">เลขที่</th>
                <th class="right" style="min-width:120px">Action</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="5" class="muted">ไม่พบ users</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div class="toast tiny">
          <b>เพิ่ม/แก้ไข User</b>
          <div class="muted">เลือกจากตาราง หรือกรอก UID เพื่อเพิ่มโปรไฟล์</div>
        </div>

        <div class="hr"></div>

        <label>UID (ต้องตรงกับ Firebase Auth UID)</label>
        <input id="u_uid" placeholder="วาง uid ที่นี่" value="${safe(selected?.uid || "")}" />

        <label>Email</label>
        <input id="u_email" placeholder="name@example.com" value="${safe(selected?.email || "")}" />

        <label>ชื่อ-สกุล</label>
        <input id="u_name" placeholder="ชื่อจริง" value="${safe(selected?.name || "")}" />

        <div class="two">
          <div>
            <label>Role</label>
            <select id="u_role">
              <option value="student">student</option>
              <option value="teacher">teacher</option>
            </select>
          </div>
          <div>
            <label>เลขที่</label>
            <input id="u_no" placeholder="เช่น 12" value="${safe(selected?.studentNo ?? "")}" />
          </div>
        </div>

        <label>Class</label>
        <select id="u_class">
          <option value="">-- ไม่ระบุ --</option>
          ${cacheClasses.map(c=>`<option value="${c.id}">${c.name} (${c.id})</option>`).join("")}
        </select>

        <div class="row" style="margin-top:12px">
          <button id="usersSaveBtn">💾 Save</button>
          <button id="usersNewBtn" class="secondary">🧹 New</button>
          <button id="usersDeleteBtn" class="danger">🗑️ Delete Profile</button>
        </div>

        <div class="hr"></div>

        <div class="toast tiny">
          <b>Tip:</b> ถ้าเด็กสมัครแล้วแต่ยังไม่อยู่ห้อง → หา email ในตาราง → เลือก class + เลขที่ → Save
        </div>
      </div>
    </div>
  `;

  // set selects
  $("usersRoleFilter").value = usersFilterRole;
  $("usersClassFilter").value = usersFilterClass;
  $("usersSearch").value = usersSearch;

  $("u_role").value = (selected?.role || "student");
  $("u_class").value = (selected?.classId || "");

  // events
  $("usersReload").onclick = async ()=>{
    await loadUsers();
    await loadClasses();
    renderTeacherUsers(me);
  };

  $("usersRoleFilter").onchange = (e)=>{ usersFilterRole = e.target.value; usersSelectedUid = ""; renderTeacherUsers(me); };
  $("usersClassFilter").onchange = (e)=>{ usersFilterClass = e.target.value; usersSelectedUid = ""; renderTeacherUsers(me); };
  $("usersSearch").oninput = (e)=>{ usersSearch = e.target.value.trim(); usersSelectedUid = ""; renderTeacherUsers(me); };

  document.querySelectorAll("[data-pick]").forEach(btn=>{
    btn.onclick = ()=>{
      usersSelectedUid = btn.getAttribute("data-pick");
      renderTeacherUsers(me);
    };
  });

  $("usersNewBtn").onclick = ()=>{
    usersSelectedUid = "";
    $("u_uid").value = "";
    $("u_email").value = "";
    $("u_name").value = "";
    $("u_role").value = "student";
    $("u_class").value = "";
    $("u_no").value = "";
  };

  $("usersSaveBtn").onclick = async ()=>{
    try{
      const uid = $("u_uid").value.trim();
      const email = $("u_email").value.trim();
      const name = $("u_name").value.trim();
      const role = $("u_role").value;
      const classId = $("u_class").value;
      const studentNo = toIntOrNull($("u_no").value);

      if (!uid) throw new Error("ต้องใส่ UID ก่อน (ให้ตรงกับ Auth UID)");
      if (!email) throw new Error("แนะนำให้ใส่ Email (เพื่อค้นหาได้ง่าย)");

      await upsertUserProfile(uid, {
        email, name, role,
        classId: role==="teacher" ? "" : classId,
        studentNo: role==="teacher" ? null : studentNo,
        createdAt: selected?.createdAt || Date.now()
      });

      usersSelectedUid = uid;
      await loadUsers();
      renderTeacherUsers(me);
      alert("✅ Save สำเร็จ");
    }catch(e){
      alert("❌ " + errMsg(e));
    }
  };

  $("usersDeleteBtn").onclick = async ()=>{
    try{
      const uid = $("u_uid").value.trim();
      if (!uid) throw new Error("ใส่ UID ก่อน");
      if (!confirm("ลบโปรไฟล์ Firestore ของ user นี้? (ไม่ลบบัญชี Auth)")) return;

      await deleteDoc(doc(db, "users", uid));
      usersSelectedUid = "";
      await loadUsers();
      renderTeacherUsers(me);
      alert("✅ ลบโปรไฟล์แล้ว");
    }catch(e){
      alert("❌ " + errMsg(e));
    }
  };
}

/* =========================
   11) Teacher - SEND (Barcode + Manual + Camera)
   ========================= */
let scanner = { running:false, stream:null, raf:null, assignmentId:null, classId:null };

function stopScanner() {
  scanner.running = false;
  if (scanner.raf) cancelAnimationFrame(scanner.raf);
  scanner.raf = null;
  if (scanner.stream) {
    scanner.stream.getTracks().forEach(t=>t.stop());
    scanner.stream = null;
  }
}

function parseStudentUid(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  if (s.startsWith("{") && s.endsWith("}")) {
    try { const obj = JSON.parse(s); if (obj?.uid) return String(obj.uid); } catch {}
  }
  if (s.startsWith("STU:")) return s.substring(4).trim();
  return s;
}
function isLate(dueAt) { return !!dueAt && Date.now() > dueAt; }

async function renderTeacherScan(me) {
  await loadAssignmentsFor("teacher");
  await loadSubmissionsFor("teacher");
  await loadUsers();
  await loadClasses();

  const classOptions = cacheClasses.map(c=>`<option value="${c.id}">${c.name}</option>`).join("");

  $("teacherPanel").innerHTML = `
    <h3>ส่งงาน (Barcode / Manual / Camera)</h3>
    <div class="toast tiny">
      แนะนำใช้ “เครื่องสแกนปืน”: คลิกช่อง “ยิงสแกน” แล้วสแกนต่อเนื่องได้เลย (Enter = ส่งอัตโนมัติ)
    </div>

    <div class="two">
      <div>
        <label>เลือกห้อง</label>
        <select id="scan_class">${classOptions}</select>
      </div>
      <div>
        <label>เลือกงาน</label>
        <select id="scan_assignment"><option value="">--เลือกงาน--</option></select>
      </div>
    </div>

    <div class="hr"></div>

    <h3>ส่งด้วยเครื่องสแกน (Barcode/QR gun)</h3>
    <label>ยิงสแกนที่นี่ (รองรับ: JSON / STU:uid / uid)</label>
    <input id="scannerInput" placeholder="คลิกที่นี่ แล้วใช้ปืนยิง..." autocomplete="off" />

    <div class="row" style="margin-top:10px">
      <button id="focusScanInputBtn" class="secondary">โฟกัสช่องสแกน</button>
      <button id="toggleAutoSubmitBtn" class="secondary" data-on="1">Auto-submit: ON</button>
      <button id="barcodeSubmitBtn">บันทึกจากช่องสแกน</button>
      <button id="barcodeUnsubmitBtn" class="danger">ยกเลิกส่ง (จากช่องสแกน)</button>
    </div>

    <div class="hr"></div>

    <h3>ส่งแบบ Manual (ไม่ต้องสแกน)</h3>
    <div class="two">
      <div>
        <label>เลือกนักเรียน</label>
        <select id="scan_student"><option value="">--เลือกนักเรียน--</option></select>
      </div>
      <div>
        <label>หรือกรอก UID</label>
        <input id="scan_uid" placeholder="วาง uid นักเรียน" />
      </div>
    </div>

    <div class="row" style="margin-top:10px">
      <button id="manualSendBtn">📤 บันทึกส่ง (Manual)</button>
      <button id="cancelSendBtn" class="danger">❌ ยกเลิกส่ง (Manual)</button>
      <button id="reloadScanBtn" class="secondary">รีเฟรช</button>
    </div>

    <div class="hr"></div>

    <details>
      <summary style="cursor:pointer;color:#cfe1ff;font-weight:700">สแกนด้วยกล้อง (ทางเลือก)</summary>
      <div class="row" style="margin-top:10px">
        <button id="startScanBtn">📷 เริ่มสแกน</button>
        <button id="stopScanBtn" class="secondary">หยุด</button>
      </div>
      <video id="video" playsinline></video>
      <canvas id="canvas" style="display:none"></canvas>
    </details>

    <div class="hr"></div>
    <div id="scanResult" class="toast tiny">สถานะ: -</div>

    <div class="hr"></div>
    <h3>สถานะนักเรียนในห้อง (ตามงานที่เลือก)</h3>
    <div id="scanStatusList" class="muted tiny">ยังไม่ได้เลือกงาน</div>
  `;

  const classSel = $("scan_class");
  const assignSel = $("scan_assignment");
  const studentSel = $("scan_student");
  const uidInput = $("scan_uid");
  const scanInput = $("scannerInput");
  const result = $("scanResult");
  const statusList = $("scanStatusList");

  function fillAssignments() {
    const classId = classSel.value;
    const list = getAssignmentsForClass(classId).slice().sort((a,b)=>(a.dueAt||0)-(b.dueAt||0));
    assignSel.innerHTML =
      `<option value="">--เลือกงาน--</option>` +
      list.map(a=>`<option value="${a.id}">${a.title} (Due ${fmtDateTime(a.dueAt)})</option>`).join("");
  }

  function fillStudents() {
    const classId = classSel.value;
    const list = cacheUsers
      .filter(u=>u.role==="student" && u.classId===classId)
      .sort((a,b)=>(a.studentNo||999)-(b.studentNo||999));
    studentSel.innerHTML =
      `<option value="">--เลือกนักเรียน--</option>` +
      list.map(s=>`<option value="${s.uid}">${s.studentNo||"-"} . ${s.name||s.email}</option>`).join("");
  }

  function renderStatusTable(classId, assignmentId) {
    const assignment = cacheAssignments.find(a => a.id === assignmentId);
    if (!assignment) { statusList.textContent = "ยังไม่ได้เลือกงาน"; return; }

    const students = cacheUsers
      .filter(u => u.role === "student" && u.classId === classId)
      .sort((a,b)=>(a.studentNo||999)-(b.studentNo||999));

    let submitted = 0, pending = 0, late = 0;

    const rows = students.map(s=>{
      const sub = findSubmission(assignmentId, s.uid);
      const lateFlag = !sub && isLate(assignment.dueAt);
      let badge = `<span class="badge"><span class="dot warn"></span>ค้าง</span>`;
      if (sub) { badge = `<span class="badge"><span class="dot ok"></span>ส่งแล้ว</span>`; submitted++; }
      else if (lateFlag) { badge = `<span class="badge"><span class="dot bad"></span>เลยกำหนด</span>`; late++; }
      else { pending++; }

      const detail = sub ? `${fmtDateTime(sub.submittedAt)} • ${sub.method||"-"}` : `Due ${fmtDateTime(assignment.dueAt)}`;

      return `
        <tr>
          <td><b>${s.studentNo ?? "-"}</b> ${s.name || s.email || ""}<div class="muted tiny">${s.email || ""}</div></td>
          <td>${badge}<div class="muted tiny">${detail}</div></td>
        </tr>
      `;
    }).join("");

    statusList.innerHTML = `
      <div class="row sp">
        <div class="badge"><span class="dot ok"></span>ส่งแล้ว: <b>${submitted}</b></div>
        <div class="badge"><span class="dot warn"></span>ค้าง: <b>${pending}</b></div>
        <div class="badge"><span class="dot bad"></span>เลยกำหนด: <b>${late}</b></div>
      </div>
      <div class="hr"></div>
      <div style="overflow:auto;border:1px solid var(--line);border-radius:14px">
        <table>
          <thead><tr><th style="min-width:260px">นักเรียน</th><th style="min-width:240px">สถานะ</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="2" class="muted">ยังไม่มีนักเรียน</td></tr>`}</tbody>
        </table>
      </div>
    `;
  }

  async function submitForUid(studentUid, mode) {
    const classId = classSel.value;
    const assignmentId = assignSel.value;
    if (!classId) throw new Error("เลือก class ก่อน");
    if (!assignmentId) throw new Error("เลือกงานก่อน");
    if (!studentUid) throw new Error("ไม่พบ uid จากข้อมูล");

    const student = cacheUsers.find(u=>u.uid===studentUid && (u.role||"student")==="student");
    if (!student) throw new Error("ไม่พบ student uid นี้ใน users");
    if ((student.classId||"") !== classId) throw new Error("นักเรียนคนนี้ไม่ได้อยู่ในห้องที่เลือก");

    await upsertSubmission({ assignmentId, studentUid, classId, method: mode, scannedBy: me.uid });
    await loadSubmissionsFor("teacher");

    result.innerHTML = `✅ ส่งแล้ว (${mode}): <b>${student.studentNo||"-"} . ${student.name||student.email}</b> • ${fmtDateTime(Date.now())}`;
    renderStatusTable(classId, assignmentId);
  }

  async function unsubmitForUid(studentUid) {
    const assignmentId = assignSel.value;
    const classId = classSel.value;
    if (!assignmentId) throw new Error("เลือกงานก่อน");
    if (!studentUid) throw new Error("ไม่พบ uid จากข้อมูล");

    const sub = findSubmission(assignmentId, studentUid);
    if (!sub) { result.textContent = "ℹ️ ยังไม่มี submission"; return; }

    await deleteSubmission(assignmentId, studentUid);
    await loadSubmissionsFor("teacher");

    result.innerHTML = `❌ ยกเลิกส่งแล้ว: <b>${studentUid}</b>`;
    renderStatusTable(classId, assignmentId);
  }

  function init() {
    fillAssignments();
    fillStudents();
    statusList.textContent = "ยังไม่ได้เลือกงาน";
    result.textContent = "สถานะ: -";
    setTimeout(()=>scanInput.focus(), 200);
  }

  classSel.onchange = () => {
    fillAssignments(); fillStudents();
    statusList.textContent = "ยังไม่ได้เลือกงาน";
    result.textContent = "สถานะ: -";
    uidInput.value = ""; scanInput.value = "";
  };
  assignSel.onchange = () => renderStatusTable(classSel.value, assignSel.value);

  $("reloadScanBtn").onclick = async ()=>{
    await loadAssignmentsFor("teacher");
    await loadSubmissionsFor("teacher");
    await loadUsers();
    await loadClasses();
    renderTeacherScan(me);
  };

  $("focusScanInputBtn").onclick = ()=> scanInput.focus();
  $("toggleAutoSubmitBtn").onclick = (e)=>{
    const btn = e.currentTarget;
    const on = btn.getAttribute("data-on")==="1";
    btn.setAttribute("data-on", on ? "0" : "1");
    btn.textContent = `Auto-submit: ${on ? "OFF" : "ON"}`;
  };

  async function handleBarcodeSubmit() {
    const uid = parseStudentUid(scanInput.value);
    await submitForUid(uid, "BARCODE");
    scanInput.value = "";
    scanInput.focus();
  }
  async function handleBarcodeUnsubmit() {
    const uid = parseStudentUid(scanInput.value);
    if (!confirm("ยืนยันยกเลิกส่ง?")) return;
    await unsubmitForUid(uid);
    scanInput.value = "";
    scanInput.focus();
  }

  $("barcodeSubmitBtn").onclick = async ()=>{
    try { await handleBarcodeSubmit(); }
    catch(e){ alert("❌ "+errMsg(e)); scanInput.select(); }
  };
  $("barcodeUnsubmitBtn").onclick = async ()=>{
    try { await handleBarcodeUnsubmit(); }
    catch(e){ alert("❌ "+errMsg(e)); scanInput.select(); }
  };

  scanInput.addEventListener("keydown", async (ev)=>{
    if (ev.key !== "Enter") return;
    const on = $("toggleAutoSubmitBtn").getAttribute("data-on")==="1";
    if (!on) return;
    ev.preventDefault();
    try { await handleBarcodeSubmit(); }
    catch(e){ alert("❌ "+errMsg(e)); scanInput.select(); }
  });

  $("manualSendBtn").onclick = async ()=>{
    try{
      const uid = uidInput.value.trim() || studentSel.value;
      await submitForUid(uid, "MANUAL");
    }catch(e){ alert("❌ "+errMsg(e)); }
  };
  $("cancelSendBtn").onclick = async ()=>{
    try{
      const uid = uidInput.value.trim() || studentSel.value;
      if (!uid) throw new Error("เลือกนักเรียนก่อน");
      if (!confirm("ยืนยันยกเลิกส่ง?")) return;
      await unsubmitForUid(uid);
    }catch(e){ alert("❌ "+errMsg(e)); }
  };

  $("startScanBtn")?.addEventListener("click", async ()=>{
    const classId = classSel.value;
    const assignmentId = assignSel.value;
    if(!classId || !assignmentId){ alert("เลือก class และงานก่อน"); return; }
    scanner.classId = classId;
    scanner.assignmentId = assignmentId;
    await startScanner(me);
  });
  $("stopScanBtn")?.addEventListener("click", ()=>stopScanner());

  init();
}

async function startScanner(me) {
  if (scanner.running) return;

  const video = $("video");
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:"environment" }, audio:false });
    scanner.stream = stream;
    video.srcObject = stream;
    await video.play();

    scanner.running = true;

    const tick = async () => {
      if (!scanner.running) return;

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const img = ctx.getImageData(0,0,canvas.width,canvas.height);
        const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts:"dontInvert" });

        if (code?.data) {
          const uid = parseStudentUid(code.data);
          try {
            const classId = scanner.classId;
            const assignmentId = scanner.assignmentId;

            const student = cacheUsers.find(u=>u.uid===uid && (u.role||"student")==="student" && (u.classId||"")===classId);
            if (!student) { $("scanResult").textContent = "⚠️ QR ถูกต้อง แต่ไม่ใช่นักเรียนในห้องที่เลือก"; }
            else {
              await upsertSubmission({ assignmentId, studentUid: student.uid, classId, method:"QR", scannedBy: me.uid });
              await loadSubmissionsFor("teacher");
              $("scanResult").innerHTML = `✅ ส่งแล้ว (QR): <b>${student.studentNo ?? "-"} . ${student.name || student.email}</b> • ${fmtDateTime(Date.now())}`;

              const classSel = $("scan_class");
              const assignSel = $("scan_assignment");
              if (classSel && assignSel && classSel.value === classId && assignSel.value === assignmentId) {
                assignSel.dispatchEvent(new Event("change"));
              }
            }
          } catch (e) {
            $("scanResult").textContent = "❌ " + errMsg(e);
          }
        }
      }
      scanner.raf = requestAnimationFrame(tick);
    };

    scanner.raf = requestAnimationFrame(tick);

  } catch (e) {
    alert("เปิดกล้องไม่สำเร็จ: อนุญาต Permission หรือใช้ HTTPS");
    stopScanner();
  }
}

/* =========================
   12) Student dashboard (filters + due soon)
   ========================= */
async function renderStudent(me) {
  await loadClasses();

  if (!me.classId) {
    $("studentPanel").innerHTML = `
      <div class="toast">
        <div><b>Email:</b> ${me.email || "-"}</div>
        <div><b>Role:</b> ${me.role}</div>
        <div><b>Class:</b> -</div>
        <div><b>studentNo:</b> ${me.studentNo ?? "-"}</div>
      </div>
      <div class="hr"></div>
      <div class="badge"><span class="dot warn"></span>ยังไม่ได้กำหนดห้องเรียน กรุณาแจ้งครูให้ assign</div>
    `;
    $("studentStatus").innerHTML = `
      <div class="toast tiny"><b>หมายเหตุ:</b> ระบบนี้ “ครูสแกน/Manual อย่างเดียว” นักเรียนไม่สามารถกดส่งเอง</div>
    `;
    return;
  }

  await loadAssignmentsFor("student", me.classId);
  await loadSubmissionsFor("student", me.uid);

  const cls = cacheClasses.find(c => c.id === me.classId);
  const assignments = cacheAssignments.slice().sort((a,b)=> (a.dueAt||0) - (b.dueAt||0));
  const now = Date.now();
  const dueSoonMs = DUE_SOON_HOURS * 60 * 60 * 1000;

  const items = assignments.map(a => {
    const sub = cacheSubmissions.find(s => s.assignmentId === a.id && s.studentUid === me.uid) || null;
    const dueAt = a.dueAt || 0;
    const late = !sub && dueAt && now > dueAt;
    const dueSoon = !sub && dueAt && (dueAt - now) > 0 && (dueAt - now) <= dueSoonMs;
    const pending = !sub;
    return { a, sub, late, dueSoon, pending };
  });

  const total = items.length;
  const done = items.filter(x=>!!x.sub).length;
  const pendingCount = items.filter(x=>x.pending && !x.late).length;
  const lateCount = items.filter(x=>x.pending && x.late).length;
  const dueSoonCount = items.filter(x=>x.dueSoon).length;
  const pct = total ? Math.round((done/total) * 100) : 0;

  const filtered = items.filter(x => {
    if (studentFilter === "all") return true;
    if (studentFilter === "pending") return x.pending && !x.late;
    if (studentFilter === "late") return x.pending && x.late;
    if (studentFilter === "dueSoon") return x.dueSoon;
    if (studentFilter === "submitted") return !!x.sub;
    return true;
  });

  const btn = (key, label, count) => {
    const active = studentFilter === key ? "style='outline:2px solid #7cc2ff'" : "";
    return `<button class="secondary" data-sfilter="${key}" ${active}>${label} (${count})</button>`;
  };

  const rows = filtered.map(x => {
    const badge = x.sub
      ? `<span class="badge"><span class="dot ok"></span>ส่งแล้ว</span>`
      : x.late
        ? `<span class="badge"><span class="dot bad"></span>ค้าง (เลยกำหนด)</span>`
        : x.dueSoon
          ? `<span class="badge"><span class="dot warn"></span>ใกล้ถึงกำหนด</span>`
          : `<span class="badge"><span class="dot warn"></span>ค้าง</span>`;

    const detail = x.sub
      ? `บันทึกแล้ว • ${fmtDateTime(x.sub.submittedAt)} (${x.sub.method || "-"})`
      : `กำหนดส่ง ${fmtDateTime(x.a.dueAt)}`;

    return `
      <tr>
        <td><b>${x.a.title}</b><div class="muted tiny">${x.a.detail || ""}</div></td>
        <td>${badge}<div class="muted tiny">${detail}</div></td>
      </tr>
    `;
  }).join("");

  const dueSoonList = items
    .filter(x=>x.dueSoon)
    .slice(0, 5)
    .map(x=>`<li style="margin:6px 0"><b>${x.a.title}</b> <span class="muted tiny">• Due ${fmtDateTime(x.a.dueAt)}</span></li>`)
    .join("");

  $("studentPanel").innerHTML = `
    <div class="row sp">
      <div class="muted tiny">ห้อง: <b>${cls ? cls.name : me.classId}</b> • เลขที่: <b>${me.studentNo ?? "-"}</b></div>
      <div class="badge"><span class="dot"></span>Read-only</div>
    </div>

    <div class="hr"></div>

    <div class="toast">
      <div class="row sp">
        <div class="badge"><span class="dot ok"></span>ส่งแล้ว: <b>${done}</b></div>
        <div class="badge"><span class="dot warn"></span>ค้าง: <b>${pendingCount}</b></div>
        <div class="badge"><span class="dot bad"></span>เลยกำหนด: <b>${lateCount}</b></div>
        <div class="badge"><span class="dot warn"></span>ใกล้ถึงกำหนด: <b>${dueSoonCount}</b></div>
        <div class="badge"><span class="dot"></span>รวม: <b>${total}</b></div>
      </div>

      <div class="hr"></div>

      <div class="muted tiny">Progress</div>
      <div style="height:10px;background:#0c152b;border:1px solid var(--line);border-radius:999px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#44d19d,#2a5bd7)"></div>
      </div>
      <div class="muted tiny" style="margin-top:8px">${pct}% ของงานทั้งหมด</div>
    </div>

    <div class="hr"></div>

    <div class="toast tiny">
      <div class="row sp">
        <div><b>งานใกล้ถึงกำหนด (ภายใน ${DUE_SOON_HOURS} ชม.)</b></div>
        <button class="secondary" id="goDueSoonBtn">ดูเฉพาะใกล้ถึงกำหนด</button>
      </div>
      <div class="hr"></div>
      ${dueSoonList ? `<ul style="margin:0;padding-left:18px">${dueSoonList}</ul>` : `<span class="muted">ไม่มี</span>`}
    </div>

    <div class="hr"></div>

    <h3>งานของฉัน</h3>
    <div class="row" style="margin-bottom:10px">
      ${btn("all","ทั้งหมด", total)}
      ${btn("pending","ค้าง", pendingCount)}
      ${btn("late","เลยกำหนด", lateCount)}
      ${btn("dueSoon",`ใกล้ถึงกำหนด ${DUE_SOON_HOURS} ชม.`, dueSoonCount)}
      ${btn("submitted","ส่งแล้ว", done)}
    </div>

    <div style="overflow:auto;border:1px solid var(--line);border-radius:14px">
      <table>
        <thead><tr><th style="min-width:260px">งาน</th><th style="min-width:240px">สถานะ</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="2" class="muted">ไม่มีรายการใน filter นี้</td></tr>`}</tbody>
      </table>
    </div>
  `;

  $("studentStatus").innerHTML = `
    <div class="toast tiny">
      <b>หมายเหตุ:</b> นักเรียนดูสถานะได้เท่านั้น • ครูจะบันทึก “ส่งแล้ว” เมื่อสแกน QR / Barcode หรือ Manual
    </div>
  `;

  document.querySelectorAll("[data-sfilter]").forEach(b=>{
    b.addEventListener("click", ()=>{
      studentFilter = b.getAttribute("data-sfilter");
      renderStudent(me);
    });
  });
  $("goDueSoonBtn").addEventListener("click", ()=>{
    studentFilter = "dueSoon";
    renderStudent(me);
  });
}

/* =========================
   13) Teacher main render
   ========================= */
async function renderTeacher() {
  stopScanner();
  const u = auth.currentUser;
  if (!u) return;

  const me = await getMyProfile(u.uid);
  if (!me) return;

  await loadClasses();
  await loadUsers();
  renderTeacherQuick(me);

  if (teacherTab === "dashboard") await renderTeacherDashboard(me);
  if (teacherTab === "tasks") await renderTeacherTasks(me);
  if (teacherTab === "qr") await renderTeacherQR(me);
  if (teacherTab === "scan") await renderTeacherScan(me);
  if (teacherTab === "users") await renderTeacherUsers(me);
  if (teacherTab === "classes") renderClasses(me);
}

/* =========================
   14) Boot
   ========================= */
onAuthStateChanged(auth, async (user) => {
  stopScanner();

  if (!user) {
    $("logoutBtn").style.display = "none";
    setWho("ยังไม่ได้ล็อกอิน");
    showOnly("login");
    return;
  }

  $("logoutBtn").style.display = "";
  const me = await getMyProfile(user.uid);

  if (!me) {
    await setDoc(doc(db, "users", user.uid), {
      email: user.email || "",
      name: "",
      role: "student",
      classId: "",
      studentNo: null,
      createdAt: Date.now()
    }, { merge: true });
  }

  const me2 = await getMyProfile(user.uid);
  setWho(`${(me2.role==="teacher") ? "👩‍🏫" : "👩‍🎓"} ${me2.email || ""}`);

  if (me2.role === "teacher") {
    showOnly("teacher");
    await renderTeacher();
  } else {
    showOnly("student");
    await renderStudent(me2);
  }
});

window.addEventListener("beforeunload", ()=> stopScanner());
