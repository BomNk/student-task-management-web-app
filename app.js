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
  query, orderBy
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
  return m;
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
    // create user profile doc as student by default
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
  await signOut(auth);
});

/* =========================
   2) Load my profile
   ========================= */
async function getMyProfile(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { uid, ...snap.data() };
}

/* =========================
   3) Teacher navigation
   ========================= */
let teacherTab = "users";
$("navTeacherUsers").addEventListener("click", () => { teacherTab = "users"; renderTeacher(); });
$("navTeacherClasses").addEventListener("click", () => { teacherTab = "classes"; renderTeacher(); });

/* =========================
   4) Modal helpers
   ========================= */
function openUserModal() { $("userModalBackdrop").style.display = "flex"; $("modalMsg").textContent = ""; }
function closeUserModal() { $("userModalBackdrop").style.display = "none"; $("modalMsg").textContent = ""; }
$("closeUserModal").addEventListener("click", closeUserModal);
$("userModalBackdrop").addEventListener("click", (e) => { if (e.target === $("userModalBackdrop")) closeUserModal(); });

/* =========================
   5) Teacher - Users (Pretty UI)
   ========================= */
let cacheClasses = [];
let cacheUsers = [];
let editingUid = null;

async function loadClasses() {
  const qs = await getDocs(query(collection(db, "classes"), orderBy("name")));
  cacheClasses = qs.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function loadUsers() {
  const qs = await getDocs(query(collection(db, "users"), orderBy("role")));
  cacheUsers = qs.docs.map(d => ({ uid: d.id, ...d.data() }));
}

function classNameOf(id) {
  const c = cacheClasses.find(x => x.id === id);
  return c ? `${c.name} (${c.id})` : (id || "-");
}

function fillClassDropdown(selectEl, value) {
  selectEl.innerHTML = `<option value="">-- ไม่ระบุ --</option>` + cacheClasses.map(c => (
    `<option value="${c.id}">${c.name} (${c.id})</option>`
  )).join("");
  selectEl.value = value || "";
}

function renderTeacherQuick(me) {
  const totalUsers = cacheUsers.length;
  const teachers = cacheUsers.filter(u => u.role === "teacher").length;
  const students = cacheUsers.filter(u => u.role === "student").length;
  $("teacherQuick").innerHTML = `
    <div class="row sp">
      <div class="badge"><span class="dot ok"></span>Teachers: <b>${teachers}</b></div>
      <div class="badge"><span class="dot warn"></span>Students: <b>${students}</b></div>
      <div class="badge"><span class="dot"></span>Total: <b>${totalUsers}</b></div>
    </div>
    <div class="hr"></div>
    <div class="muted tiny">ล็อกอินเป็น: <b>${me.email || "-"}</b> • UID: ${me.uid}</div>
  `;
}

function renderUsersTable(me) {
  const rows = cacheUsers
    .slice()
    .sort((a,b)=>{
      if (a.role !== b.role) return a.role === "teacher" ? -1 : 1;
      return (a.email||"").localeCompare(b.email||"");
    });

  $("teacherPanel").innerHTML = `
    <div class="row sp">
      <h3>Users</h3>
      <div class="row">
        <button id="refreshUsersBtn" class="secondary">รีเฟรช</button>
        <button id="openAddUserBtn">Add User (เฉพาะโปรไฟล์)</button>
      </div>
    </div>

    <div class="toast tiny">
      <b>การสร้างบัญชี (Auth):</b> นักเรียนสมัครเองด้วย Email/Password แล้วครูมาแก้ role/class/studentNo ที่นี่<br>
      ปุ่ม Add User ด้านบนจะ “สร้างโปรไฟล์ user doc” เท่านั้น (กรณีอยากเตรียมข้อมูลไว้ก่อน)
    </div>

    <div class="hr"></div>

    <div style="overflow:auto;border:1px solid var(--line);border-radius:14px">
      <table>
        <thead>
          <tr>
            <th style="min-width:220px">Email</th>
            <th style="min-width:90px">Role</th>
            <th style="min-width:180px">Name</th>
            <th style="min-width:200px">Class</th>
            <th class="right" style="min-width:110px">studentNo</th>
            <th class="right" style="min-width:140px">Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(u => `
            <tr>
              <td><b>${u.email || "-"}</b><div class="muted tiny">uid: ${u.uid}</div></td>
              <td>
                <span class="badge"><span class="dot ${u.role==="teacher"?"ok":"warn"}"></span>${u.role}</span>
              </td>
              <td>${u.name || "-"}</td>
              <td>${classNameOf(u.classId)}</td>
              <td class="right">${u.role==="student" ? (u.studentNo ?? "-") : "-"}</td>
              <td class="right">
                <button class="secondary" data-edit="${u.uid}">Edit</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  $("refreshUsersBtn").addEventListener("click", async ()=> {
    await loadClasses();
    await loadUsers();
    renderTeacherQuick(me);
    renderUsersTable(me);
  });

  $("openAddUserBtn").addEventListener("click", ()=> openUserEditor(me, null));

  document.querySelectorAll("[data-edit]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const uid = btn.getAttribute("data-edit");
      const u = cacheUsers.find(x=>x.uid===uid);
      openUserEditor(me, u);
    });
  });
}

function openUserEditor(me, user) {
  editingUid = user?.uid || null;

  $("userModalTitle").textContent = user ? "Edit User" : "Add User (Profile only)";
  $("userModalSub").textContent = user
    ? "แก้ไขข้อมูลผู้ใช้ใน Firestore"
    : "สร้าง users/{uid} แบบ manual (กรณีอยากเตรียม doc)";

  $("m_uid").value = user?.uid || "(จะใส่เอง)";
  $("m_email").value = user?.email || "";
  $("m_name").value = user?.name || "";
  $("m_role").value = user?.role || "student";
  $("m_studentNo").value = (user?.studentNo ?? "");

  fillClassDropdown($("m_classId"), user?.classId || "");

  $("deleteUserBtn").style.display = user ? "" : "none";
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
          studentNo = n;
        }
      }

      if (user) {
        // edit existing
        const ref = doc(db, "users", user.uid);

        // optional duplicate check (client-side)
        if (role === "student" && classId && studentNo != null) {
          const dup = cacheUsers.some(u =>
            u.uid !== user.uid && u.role==="student" && u.classId===classId && u.studentNo===studentNo
          );
          if (dup) throw new Error("เลขที่ซ้ำในห้องเดียวกัน");
        }

        await updateDoc(ref, {
          name,
          role,
          classId,
          studentNo: role==="student" ? studentNo : null
        });
      } else {
        // create profile doc only (needs uid input)
        const uid = prompt("ใส่ UID ที่ต้องการสร้างโปรไฟล์ (เช่น UID จาก Auth)");
        if (!uid) return;

        await setDoc(doc(db, "users", uid), {
          email: $("m_email").value.trim(),
          name,
          role,
          classId,
          studentNo: role==="student" ? studentNo : null,
          createdAt: Date.now()
        }, { merge: true });
      }

      await loadUsers();
      renderTeacherQuick(me);
      renderUsersTable(me);
      $("modalMsg").textContent = "✅ บันทึกแล้ว";
      setTimeout(closeUserModal, 400);
    } catch (e) {
      $("modalMsg").textContent = "❌ " + errMsg(e);
    }
  };

  $("deleteUserBtn").onclick = async () => {
    $("modalMsg").textContent = "";
    try {
      if (!user) return;
      if (user.uid === me.uid) throw new Error("ลบบัญชีที่กำลังล็อกอินไม่ได้");
      if (!confirm(`ยืนยันลบ user doc: ${user.email || user.uid} ?\n(หมายเหตุ: ไม่ได้ลบบัญชี Auth)`)) return;

      await deleteDoc(doc(db, "users", user.uid));
      await loadUsers();
      renderTeacherQuick(me);
      renderUsersTable(me);
      $("modalMsg").textContent = "✅ ลบแล้ว";
      setTimeout(closeUserModal, 400);
    } catch (e) {
      $("modalMsg").textContent = "❌ " + errMsg(e);
    }
  };
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
      // make id readable by copying auto id to a field not necessary; we just reload
      await loadClasses();
      $("c_name").value = "";
      $("c_note").value = "";
      renderClasses(me);
      alert("เพิ่ม class แล้ว (id: "+ref.id+")");
    }catch(e){
      alert("❌ "+errMsg(e));
    }
  });
}

/* =========================
   7) Student view
   ========================= */
function renderStudent(me) {
  $("studentPanel").innerHTML = `
    <div class="toast">
      <div><b>Email:</b> ${me.email || "-"}</div>
      <div><b>Role:</b> ${me.role}</div>
      <div><b>Class:</b> ${me.classId || "-"}</div>
      <div><b>studentNo:</b> ${me.studentNo ?? "-"}</div>
    </div>
    <div class="hr"></div>
    <div class="muted tiny">
      ถ้า Class ยังว่าง ให้แจ้งครูเพื่อ assign ห้อง/เลขที่ในหน้า Users
    </div>
  `;
  $("studentStatus").innerHTML = `
    <div class="badge"><span class="dot warn"></span>รอครูกำหนดข้อมูล (ถ้ายังไม่เห็น class)</div>
  `;
}

/* =========================
   8) Teacher render
   ========================= */
async function renderTeacher() {
  const u = auth.currentUser;
  if (!u) return;

  const me = await getMyProfile(u.uid);
  if (!me) return;

  await loadClasses();
  await loadUsers();
  renderTeacherQuick(me);

  if (teacherTab === "users") renderUsersTable(me);
  if (teacherTab === "classes") renderClasses(me);
}

/* =========================
   9) App boot
   ========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    $("logoutBtn").style.display = "none";
    setWho("ยังไม่ได้ล็อกอิน");
    showOnly("login");
    return;
  }

  $("logoutBtn").style.display = "";
  const me = await getMyProfile(user.uid);

  // if profile doc missing, create minimal (student default)
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
    renderStudent(me2);
  }
});
