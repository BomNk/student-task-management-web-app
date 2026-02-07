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
  if (m.includes("permission-denied")) return "permission-denied: Firestore Rules ไม่อนุญาต (ตรวจ rules + where query)";
  return m;
}

function fmtDateTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleString(undefined, { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
}

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
   3) Caches
   ========================= */
let cacheClasses = [];
let cacheUsers = [];
let cacheAssignments = [];
let cacheSubmissions = [];

async function loadClasses() {
  const qs = await getDocs(query(collection(db, "classes"), orderBy("name")));
  cacheClasses = qs.docs.map(d => ({ id: d.id, ...d.data() }));
}

// teacher only
async function loadUsers() {
  const qs = await getDocs(query(collection(db, "users"), orderBy("role")));
  cacheUsers = qs.docs.map(d => ({ uid: d.id, ...d.data() }));
}

// rules-compatible: student ต้อง where(classId == myClassId)
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

// rules-compatible: student ต้อง where(studentUid == uid)
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
   5) Modal helpers (Users)
   ========================= */
function openUserModal() { $("userModalBackdrop").style.display = "flex"; $("modalMsg").textContent = ""; }
function closeUserModal() { $("userModalBackdrop").style.display = "none"; $("modalMsg").textContent = ""; }
$("closeUserModal").addEventListener("click", closeUserModal);
$("userModalBackdrop").addEventListener("click", (e) => { if (e.target === $("userModalBackdrop")) closeUserModal(); });

function fillClassDropdown(selectEl, value) {
  selectEl.innerHTML = `<option value="">-- ไม่ระบุ --</option>` + cacheClasses.map(c => (
    `<option value="${c.id}">${c.name} (${c.id})</option>`
  )).join("");
  selectEl.value = value || "";
}

/* =========================
   6) Teacher Quick
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
   7) Teacher - Users
   ========================= */
function renderUsersTable(me) {
  const rows = cacheUsers.slice().sort((a,b)=>{
    if (a.role !== b.role) return a.role === "teacher" ? -1 : 1;
    return (a.email||"").localeCompare(b.email||"");
  });

  $("teacherPanel").innerHTML = `
    <div class="row sp">
      <h3>Users</h3>
      <div class="row">
        <button id="refreshUsersBtn" class="secondary">รีเฟรช</button>
      </div>
    </div>

    <div class="toast tiny">
      นักเรียนสมัครเอง (Auth) แล้วครูมาแก้ role/class/studentNo ที่นี่<br>
      * ปุ่มลบ = ลบ <b>user doc</b> เท่านั้น (ไม่ลบบัญชี Auth)
    </div>

    <div class="hr"></div>

    <div style="overflow:auto;border:1px solid var(--line);border-radius:14px">
      <table>
        <thead>
          <tr>
            <th style="min-width:220px">Email</th>
            <th style="min-width:90px">Role</th>
            <th style="min-width:180px">Name</th>
            <th style="min-width:220px">Class</th>
            <th class="right" style="min-width:110px">studentNo</th>
            <th class="right" style="min-width:120px">Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(u => `
            <tr>
              <td><b>${u.email || "-"}</b><div class="muted tiny">uid: ${u.uid}</div></td>
              <td><span class="badge"><span class="dot ${u.role==="teacher"?"ok":"warn"}"></span>${u.role}</span></td>
              <td>${u.name || "-"}</td>
              <td>${classNameOf(u.classId)}</td>
              <td class="right">${u.role==="student" ? (u.studentNo ?? "-") : "-"}</td>
              <td class="right">
                <button class="secondary" data-edit="${u.uid}">Edit</button>
              </td>
            </tr>
          `).join("") || `<tr><td colspan="6" class="muted">ยังไม่มีผู้ใช้</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  $("refreshUsersBtn").addEventListener("click", async ()=> {
    await loadClasses(); await loadUsers();
    renderTeacherQuick(me);
    renderUsersTable(me);
  });

  document.querySelectorAll("[data-edit]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const uid = btn.getAttribute("data-edit");
      const u = cacheUsers.find(x=>x.uid===uid);
      openUserEditor(me, u);
    });
  });
}

function openUserEditor(me, user) {
  if (!user) return;

  $("userModalTitle").textContent = "Edit User";
  $("userModalSub").textContent = "แก้ไขข้อมูลผู้ใช้ใน Firestore";
  $("m_uid").value = user.uid || "";
  $("m_email").value = user.email || "";
  $("m_name").value = user.name || "";
  $("m_role").value = user.role || "student";
  $("m_studentNo").value = (user.studentNo ?? "");

  fillClassDropdown($("m_classId"), user.classId || "");
  $("deleteUserBtn").style.display = "";

  openUserModal();

  $("saveUserBtn").onclick = async () => {
    $("modalMsg").textContent = "";
    try {
      const role = $("m_role").value;
      const name = $("m_name").value.trim();
      const classId = $("m_classId").value;
      const studentNoRaw = $("m_studentNo").value;

      let studentNo = null;
      if (role === "student") {
        if (studentNoRaw !== "") {
          const n = Number(studentNoRaw);
          if (!Number.isFinite(n) || n < 1) throw new Error("studentNo ต้องเป็นตัวเลข >= 1");
          if (classId) {
            const dup = cacheUsers.some(u =>
              u.uid !== user.uid && u.role==="student" && u.classId===classId && u.studentNo===n
            );
            if (dup) throw new Error("เลขที่ซ้ำในห้องเดียวกัน");
          }
          studentNo = n;
        }
      }

      await updateDoc(doc(db, "users", user.uid), {
        name,
        role,
        classId,
        studentNo: role==="student" ? studentNo : null
      });

      await loadUsers();
      renderTeacherQuick(me);
      renderUsersTable(me);
      $("modalMsg").textContent = "✅ บันทึกแล้ว";
      setTimeout(closeUserModal, 350);
    } catch (e) {
      $("modalMsg").textContent = "❌ " + errMsg(e);
    }
  };

  $("deleteUserBtn").onclick = async () => {
    $("modalMsg").textContent = "";
    try {
      if (user.uid === me.uid) throw new Error("ลบบัญชีที่กำลังล็อกอินไม่ได้");
      if (!confirm(`ยืนยันลบ user doc: ${user.email || user.uid} ?\n(ไม่ลบบัญชี Auth)`)) return;

      await deleteDoc(doc(db, "users", user.uid));
      await loadUsers();
      renderTeacherQuick(me);
      renderUsersTable(me);
      $("modalMsg").textContent = "✅ ลบแล้ว";
      setTimeout(closeUserModal, 350);
    } catch (e) {
      $("modalMsg").textContent = "❌ " + errMsg(e);
    }
  };
}

/* =========================
   8) Teacher - Classes
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
   9) Teacher - Tasks
   ========================= */
async function renderTeacherTasks(me) {
  await loadAssignmentsFor("teacher");

  const classOptions = cacheClasses.map(c => `<option value="${c.id}">${c.name} (${c.id})</option>`).join("");

  $("teacherPanel").innerHTML = `
    <h3>Tasks / Assignments</h3>
    <div class="toast tiny">สร้างงาน → ครูสแกน QR เพื่อบันทึกส่ง (นักเรียนอ่านอย่างเดียว)</div>
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
   10) Teacher - Dashboard (ดูรายคน)
   ========================= */
async function renderTeacherDashboard(me) {
  await loadClasses();
  await loadUsers();
  await loadAssignmentsFor("teacher");
  await loadSubmissionsFor("teacher");

  const classOptions = cacheClasses.map(c =>
    `<option value="${c.id}">${c.name} (${c.id})</option>`
  ).join("");

  const firstClassId = cacheClasses[0]?.id || "";
  $("teacherPanel").innerHTML = `
    <div class="row sp">
      <h3>Dashboard รายคน</h3>
      <div class="row">
        <button id="dashReload" class="secondary">รีเฟรช</button>
      </div>
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
        const detail = sub ? `QR/Manual • ${fmtDateTime(sub.submittedAt)} (${sub.method || "-"})` : `Due ${fmtDateTime(a.dueAt)}`;
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

  $("dashClass").addEventListener("change", ()=>{
    render($("dashClass").value);
  });

  render($("dashClass").value);
}

/* =========================
   11) Teacher - QR students
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
   12) Teacher - Scanner + Manual + Unsubmit + Status list
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

function isLate(a) { return Date.now() > (a.dueAt || 0); }

function studentStatusLabelFor(assignment, studentUid) {
  const sub = findSubmission(assignment.id, studentUid);
  if (sub) return { label: "✅ ส่งแล้ว", key:"SUBMITTED" };
  if (isLate(assignment)) return { label: "⛔ เลยกำหนด", key:"LATE" };
  return { label: "⏳ ค้าง", key:"PENDING" };
}

async function renderTeacherScan(me) {
  await loadAssignmentsFor("teacher");
  await loadSubmissionsFor("teacher");
  await loadUsers();
  await loadClasses();

  const classOptions = cacheClasses.map(c=>`<option value="${c.id}">${c.name}</option>`).join("");

  $("teacherPanel").innerHTML = `
    <h3>ส่งงาน (Scan หรือ Manual)</h3>

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

    <h3>ส่งแบบ Manual (ไม่ต้องสแกน)</h3>

    <div class="two">
      <div>
        <label>เลือกนักเรียน</label>
        <select id="scan_student">
          <option value="">--เลือกนักเรียน--</option>
        </select>
      </div>
      <div>
        <label>หรือกรอก UID</label>
        <input id="scan_uid" placeholder="วาง uid นักเรียน" />
      </div>
    </div>

    <div class="row" style="margin-top:10px">
      <button id="manualSendBtn">📤 บันทึกส่ง (Manual)</button>
      <button id="cancelSendBtn" class="danger">❌ ยกเลิกส่ง</button>
    </div>

    <div class="hr"></div>

    <h3>สแกน QR</h3>
    <div class="row">
      <button id="startScanBtn">📷 เริ่มสแกน</button>
      <button id="stopScanBtn" class="secondary">หยุด</button>
    </div>

    <video id="video" playsinline></video>

    <div class="hr"></div>
    <div id="scanResult" class="toast">สถานะ: -</div>
  `;

  const classSel = $("scan_class");
  const assignSel = $("scan_assignment");
  const studentSel = $("scan_student");

  function fillAssignments() {
    const classId = classSel.value;
    const list = cacheAssignments.filter(a=>a.classId===classId);
    assignSel.innerHTML =
      `<option value="">--เลือกงาน--</option>` +
      list.map(a=>`<option value="${a.id}">${a.title}</option>`).join("");
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

  classSel.onchange = ()=>{
    fillAssignments();
    fillStudents();
  };

  fillAssignments();
  fillStudents();

  // =======================
  // MANUAL SEND
  // =======================
  $("manualSendBtn").onclick = async ()=>{
    try{
      const classId = classSel.value;
      const assignmentId = assignSel.value;
      const uid = $("scan_uid").value.trim() || studentSel.value;

      if(!classId) throw new Error("เลือก class");
      if(!assignmentId) throw new Error("เลือกงาน");
      if(!uid) throw new Error("เลือกนักเรียน");

      const student = cacheUsers.find(u=>u.uid===uid);
      if(!student) throw new Error("ไม่พบ user");

      await upsertSubmission({
        assignmentId,
        studentUid: uid,
        classId,
        method:"MANUAL",
        scannedBy: me.uid
      });

      $("scanResult").innerHTML =
        `✅ ส่งแล้ว (Manual): ${student.studentNo||""} ${student.name||student.email}`;

      await loadSubmissionsFor("teacher");

    }catch(e){
      alert("❌ "+errMsg(e));
    }
  };

  // =======================
  // CANCEL SEND
  // =======================
  $("cancelSendBtn").onclick = async ()=>{
    try{
      const assignmentId = assignSel.value;
      const uid = $("scan_uid").value.trim() || studentSel.value;

      if(!assignmentId || !uid) throw new Error("เลือกงานและนักเรียนก่อน");

      if(!confirm("ยกเลิกส่งงาน?")) return;

      await deleteSubmission(assignmentId, uid);
      $("scanResult").innerHTML = `❌ ยกเลิกส่งแล้ว`;

      await loadSubmissionsFor("teacher");

    }catch(e){
      alert("❌ "+errMsg(e));
    }
  };

  // =======================
  // SCAN QR
  // =======================
  $("startScanBtn").onclick = async ()=>{
    const classId = classSel.value;
    const assignmentId = assignSel.value;
    if(!classId || !assignmentId){
      alert("เลือก class และงานก่อน");
      return;
    }
    scanner.classId = classId;
    scanner.assignmentId = assignmentId;
    await startScanner(me);
  };

  $("stopScanBtn").onclick = ()=>stopScanner();
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
    $("startScanBtn").disabled = true;
    $("stopScanBtn").disabled = false;

    const tick = async () => {
      if (!scanner.running) return;

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const img = ctx.getImageData(0,0,canvas.width,canvas.height);
        const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts:"dontInvert" });

        if (code?.data) {
          let obj = null;
          try { obj = JSON.parse(code.data); } catch {}

          if (obj?.type === "STUDENT" && obj.uid) {
            const student = cacheUsers.find(u=>u.uid===obj.uid && u.role==="student" && u.classId===scanner.classId);
            if (!student) {
              $("scanResult").textContent = "⚠️ QR ถูกต้อง แต่ไม่ใช่นักเรียนในห้องที่เลือก";
            } else {
              await upsertSubmission({
                assignmentId: scanner.assignmentId,
                studentUid: student.uid,
                classId: scanner.classId,
                method: "QR",
                scannedBy: me.uid
              });
              await loadSubmissionsFor("teacher");
              $("scanResult").innerHTML = `✅ บันทึกส่งแล้ว: <b>${student.studentNo ?? "-"} . ${student.name || student.email}</b> เวลา ${fmtDateTime(Date.now())}`;

              // refresh dropdown/table if current selections match
              const classSel = $("scan_class");
              const assignSel = $("scan_assignment");
              if (classSel && assignSel && classSel.value === scanner.classId && assignSel.value === scanner.assignmentId) {
                // refresh UI list quickly
                const fakeEvent = new Event("change");
                assignSel.dispatchEvent(fakeEvent);
              }
            }
          } else {
            $("scanResult").textContent = "⚠️ QR ไม่ถูกต้องสำหรับระบบนี้";
          }
        }
      }
      scanner.raf = requestAnimationFrame(tick);
    };

    scanner.raf = requestAnimationFrame(tick);

  } catch (e) {
    alert("เปิดกล้องไม่สำเร็จ: อนุญาต Permission หรือใช้ HTTPS");
    stopScanner();
    $("stopScanBtn").disabled = true;
    $("startScanBtn").disabled = false;
  }
}

/* =========================
   13) Student (read-only)
   ========================= */
function statusForStudent(assignment, studentUid) {
  const sub = cacheSubmissions.find(s => s.assignmentId === assignment.id && s.studentUid === studentUid);
  if (sub) return { label:"ส่งแล้ว", cls:"ok", detail:`QR/Manual • ${fmtDateTime(sub.submittedAt)} (${sub.method || "-"})` };
  if (isLate(assignment)) return { label:"ค้าง (เลยกำหนด)", cls:"bad", detail:`Due ${fmtDateTime(assignment.dueAt)}` };
  return { label:"ค้าง", cls:"warn", detail:`Due ${fmtDateTime(assignment.dueAt)}` };
}

function renderStudentProgressBar(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `
    <div class="row sp">
      <div class="badge"><span class="dot ok"></span>ส่งแล้ว: <b>${done}</b></div>
      <div class="badge"><span class="dot warn"></span>ค้าง: <b>${total - done}</b></div>
      <div class="badge"><span class="dot"></span>รวม: <b>${total}</b></div>
    </div>
    <div class="hr"></div>
    <div class="toast">
      <div class="muted tiny">ความคืบหน้า</div>
      <div style="height:10px;background:#0c152b;border:1px solid var(--line);border-radius:999px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#44d19d,#2a5bd7)"></div>
      </div>
      <div class="muted tiny" style="margin-top:8px">${pct}% ของงานทั้งหมด</div>
    </div>
  `;
}

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
      <div class="toast tiny"><b>หมายเหตุ:</b> ระบบนี้ “ครูสแกน QR อย่างเดียว” นักเรียนไม่สามารถกดส่งเอง</div>
    `;
    return;
  }

  await loadAssignmentsFor("student", me.classId);
  await loadSubmissionsFor("student", me.uid);

  const cls = cacheClasses.find(c => c.id === me.classId);
  const assignments = cacheAssignments.slice().sort((a,b)=> (a.dueAt||0) - (b.dueAt||0));

  let done = 0;
  for (const a of assignments) {
    if (cacheSubmissions.find(s => s.assignmentId === a.id && s.studentUid === me.uid)) done++;
  }

  const rows = assignments.map(a => {
    const st = statusForStudent(a, me.uid);
    return `
      <tr>
        <td>
          <b>${a.title}</b>
          <div class="muted tiny">${a.detail || ""}</div>
        </td>
        <td>
          <span class="badge"><span class="dot ${st.cls}"></span>${st.label}</span>
          <div class="muted tiny">${st.detail}</div>
        </td>
      </tr>
    `;
  }).join("");

  $("studentPanel").innerHTML = `
    <div class="row sp">
      <div class="muted tiny">
        ห้อง: <b>${cls ? cls.name : me.classId}</b> • เลขที่: <b>${me.studentNo ?? "-"}</b>
      </div>
      <div class="badge"><span class="dot"></span>Read-only</div>
    </div>

    <div class="hr"></div>

    <div style="overflow:auto;border:1px solid var(--line);border-radius:14px">
      <table>
        <thead>
          <tr>
            <th style="min-width:260px">งาน</th>
            <th style="min-width:220px">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="2" class="muted">ยังไม่มีงานในห้องนี้</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  $("studentStatus").innerHTML = `
    ${renderStudentProgressBar(done, assignments.length)}
    <div class="hr"></div>
    <div class="toast tiny">
      <b>การส่งงาน:</b> ครูจะบันทึก “ส่งแล้ว” เมื่อสแกน QR หรือ Manual
    </div>
  `;
}

/* =========================
   14) Teacher main render
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
  if (teacherTab === "users") renderUsersTable(me);
  if (teacherTab === "classes") renderClasses(me);
}

/* =========================
   15) App boot
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
  setWho(`${me2.role==="teacher" ? "👩‍🏫" : "👩‍🎓"} ${me2.email || ""}`);

  if (me2.role === "teacher") {
    showOnly("teacher");
    await renderTeacher();
  } else {
    showOnly("student");
    await renderStudent(me2);
  }
});

window.addEventListener("beforeunload", ()=> stopScanner());
