// ─── Auth guard ────────────────────────────────────────────────────────────────
const token    = localStorage.getItem("token");
const username = localStorage.getItem("username");
const myColor  = localStorage.getItem("color") || "#6c63ff";

if (!token || !username) window.location.href = "/";

// ─── Socket connection with JWT ───────────────────────────────────────────────
const socket = io({ auth: { token } });
socket.on("connect_error", (err) => {
  if (err.message === "Authentication failed") { localStorage.clear(); window.location.href = "/"; }
});

// ─── State ─────────────────────────────────────────────────────────────────────
let currentRecipient = "Everyone";
let typingTimer = null, isTyping = false;

// ─── DOM refs ──────────────────────────────────────────────────────────────────
const messagesArea    = document.getElementById("messagesArea");
const messageInput    = document.getElementById("messageInput");
const typingIndicator = document.getElementById("typingIndicator");
const userList        = document.getElementById("userList");
const chatName        = document.getElementById("chatName");
const chatStatus      = document.getElementById("chatStatus");
const chatAvatar      = document.getElementById("chatAvatar");
const recipientSelect = document.getElementById("recipientSelect");

// ─── Set own info in sidebar ───────────────────────────────────────────────────
document.getElementById("myUsername").textContent        = username;
document.getElementById("myAvatar").textContent          = username[0].toUpperCase();
document.getElementById("myAvatar").style.background     = myColor;

// ─── Load message history ──────────────────────────────────────────────────────
async function loadHistory() {
  const loader = document.getElementById("messagesLoading");
  if (loader) loader.style.display = "block";
  try {
    const res  = await fetch("/api/messages", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const msgs = await res.json();
    if (loader) loader.remove();
    msgs.forEach((m) => appendMessage({
      sender: m.sender, recipient: m.recipient, message: m.message,
      type: m.type, color: m.color,
      time: new Date(m.created_at).toLocaleTimeString(), historic: true,
    }));
    scrollToBottom();
  } catch { if (loader) loader.textContent = "Could not load history."; }
}

loadHistory();

// ─── Render message ────────────────────────────────────────────────────────────
function appendMessage({ sender, recipient, message, type, time, color, historic = false, urgent = false }) {
  const isSystem = type === "system";
  const isPublic = recipient === "Everyone";

  if (!isSystem) {
    if (currentRecipient === "Everyone" && !isPublic) return;
    if (currentRecipient !== "Everyone") {
      const partner = sender === username ? recipient : sender;
      if (partner !== currentRecipient) return;
    }
  }

  const div = document.createElement("div");

  if (isSystem) {
    div.className   = "msg msg-system";
    div.textContent = message;
    messagesArea.appendChild(div);
    if (!historic) scrollToBottom();
    return;
  }

  const isMine      = sender === username;
  const bubbleColor = color || "#6c63ff";

  div.className = `msg ${isMine ? "msg-mine" : "msg-theirs"}${urgent ? " msg-urgent" : ""}`;
  div.innerHTML = `
    <div class="msg-bubble" style="background:${bubbleColor}; border-color:${bubbleColor}">
      ${!isMine ? `<div class="msg-sender" style="color:${bubbleColor}; filter:brightness(1.8)">${escapeHtml(sender)}</div>` : ""}
      ${urgent   ? `<div class="msg-urgent-label">🚨 URGENT</div>` : ""}
      <div class="msg-text">${escapeHtml(message)}</div>
      <div class="msg-time">${time}</div>
    </div>
  `;

  messagesArea.appendChild(div);
  if (!historic) scrollToBottom();
}

function scrollToBottom() { messagesArea.scrollTop = messagesArea.scrollHeight; }

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Send message ──────────────────────────────────────────────────────────────
function sendMessage() {
  const message   = messageInput.value.trim();
  const recipient = recipientSelect ? recipientSelect.value : currentRecipient;
  if (!message) return;
  if (recipient === "Broadcast" && !confirm("Send URGENT broadcast to everyone?")) return;
  socket.emit("chat message", { recipient, message, urgent: recipient === "Broadcast" });
  messageInput.value = "";
  stopTyping();
}

// ─── Typing indicator ──────────────────────────────────────────────────────────
messageInput.addEventListener("input", () => {
  const recipient = recipientSelect?.value || currentRecipient;
  if (!isTyping) { isTyping = true; socket.emit("typing", { recipient }); }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 1500);
});

function stopTyping() {
  const recipient = recipientSelect?.value || currentRecipient;
  if (isTyping) { isTyping = false; socket.emit("stop typing", { recipient }); }
  clearTimeout(typingTimer);
}

messageInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(); });

// ─── Socket events ─────────────────────────────────────────────────────────────
socket.on("chat message",   (d) => appendMessage(d));
socket.on("urgent message", (d) => {
  alert("🚨 URGENT from " + d.sender + ":\n\n" + d.message);
  appendMessage({ ...d, urgent: true });
});
socket.on("typing",      ({ sender }) => {
  typingIndicator.textContent   = sender + " is typing...";
  typingIndicator.style.opacity = "1";
});
socket.on("stop typing", () => {
  typingIndicator.textContent   = "";
  typingIndicator.style.opacity = "0";
});

socket.on("online users", (userObjs) => {
  // Save globally so profile panel + doodle room selector can access it
  window._onlineUsers = userObjs;

  userList.innerHTML = `
    <li class="user-item ${currentRecipient === "Everyone" ? "active" : ""}"
        data-user="Everyone" onclick="selectRecipient('Everyone', this)">
      <div class="user-avatar group-avatar">#</div>
      <div class="user-details">
        <span class="user-name">Everyone</span>
        <span class="user-status">Public room</span>
      </div>
    </li>`;

  if (recipientSelect) {
    recipientSelect.innerHTML = `
      <option value="Everyone">Everyone</option>
      <option value="Broadcast">🚨 Urgent Broadcast</option>`;
  }

  userObjs.filter(u => u.username !== username).forEach(({ username: u, color: c }) => {
    const li = document.createElement("li");
    li.className  = `user-item ${currentRecipient === u ? "active" : ""}`;
    li.dataset.user = u;
    li.onclick    = () => selectRecipient(u, li);
    li.innerHTML  = `
      <div class="user-avatar" style="background:${c}">${u[0].toUpperCase()}</div>
      <div class="user-details">
        <span class="user-name">${escapeHtml(u)}</span>
        <span class="user-status online-dot">Online</span>
      </div>`;
    userList.appendChild(li);

    if (recipientSelect) {
      const opt = document.createElement("option");
      opt.value = u; opt.textContent = "Private: " + u;
      recipientSelect.appendChild(opt);
    }
  });
});

socket.on("group created", ({ name, members }) => {
  addGroupToSidebar(name, members);
});

// ─── Switch chat ───────────────────────────────────────────────────────────────
function selectRecipient(user, liEl) {
  if (currentRecipient === user) return;
  currentRecipient = user;
  stopTyping();
  document.querySelectorAll(".user-item").forEach(el => el.classList.remove("active"));
  liEl.classList.add("active");
  chatName.textContent   = user === "Everyone" ? "Everyone" : user;
  chatStatus.textContent = user === "Everyone" ? "Public room" : "Online";
  chatAvatar.textContent = user === "Everyone" ? "#" : user[0].toUpperCase();
  chatAvatar.className   = "chat-avatar" + (user === "Everyone" ? " group-avatar" : "");
  if (recipientSelect) recipientSelect.value = user;
  messagesArea.innerHTML = `<div id="messagesLoading" class="messages-loading" style="display:none"></div>`;
  typingIndicator.textContent = "";
  if (user === "Everyone") loadHistory();
  messageInput.focus();
}

function logout() { localStorage.clear(); window.location.href = "/"; }

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE PANEL
// ═══════════════════════════════════════════════════════════════════════════════
const PROFILE_COLORS = [
  "#6c63ff","#e74c8b","#f59e0b","#10b981",
  "#3b82f6","#ef4444","#8b5cf6","#06b6d4",
  "#f97316","#84cc16"
];

let profileSelectedColor = myColor;
let blockedUsers = JSON.parse(localStorage.getItem("blockedUsers") || "[]");
let allRegisteredUsers = [];

// Fetch ALL registered users from server (not just online ones)
async function fetchAllUsers() {
  try {
    const res  = await fetch("/api/users", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    allRegisteredUsers = await res.json();
  } catch {}
}

fetchAllUsers();

function openProfile() {
  document.getElementById("profileOverlay").classList.add("active");
  document.getElementById("profilePanel").classList.add("active");
  document.getElementById("profileAvatar").textContent      = username[0].toUpperCase();
  document.getElementById("profileAvatar").style.background = profileSelectedColor;
  document.getElementById("profileUsername").textContent    = username;
  // Refresh users list each time panel opens
  fetchAllUsers().then(() => {
    buildProfileColors();
    refreshBlockSelect();
    refreshBlockedList();
    refreshGroupMembers();
  });
}

function closeProfile() {
  document.getElementById("profileOverlay").classList.remove("active");
  document.getElementById("profilePanel").classList.remove("active");
}

function buildProfileColors() {
  const wrap = document.getElementById("profileColorSwatches");
  wrap.innerHTML = "";
  PROFILE_COLORS.forEach((c) => {
    const s = document.createElement("div");
    s.className = "color-swatch" + (c === profileSelectedColor ? " selected" : "");
    s.style.background = c;
    s.onclick = () => {
      profileSelectedColor = c;
      document.querySelectorAll("#profileColorSwatches .color-swatch").forEach(x => x.classList.remove("selected"));
      s.classList.add("selected");
      document.getElementById("profileAvatar").style.background = c;
    };
    wrap.appendChild(s);
  });
}

async function saveColor() {
  const feedback = document.getElementById("colorSaveFeedback");
  try {
    const res = await fetch("/api/update-color", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ color: profileSelectedColor }),
    });
    if (!res.ok) throw new Error();
    localStorage.setItem("color", profileSelectedColor);
    document.getElementById("myAvatar").style.background      = profileSelectedColor;
    document.getElementById("profileAvatar").style.background = profileSelectedColor;
    feedback.textContent = "✅ Color saved!";
    feedback.style.color = "#4ade80";
    setTimeout(() => feedback.textContent = "", 2000);
  } catch {
    feedback.textContent = "❌ Failed to save.";
    feedback.style.color = "#f87171";
  }
}

// ── Block users ───────────────────────────────────────────────────────────────
function refreshBlockSelect() {
  const sel = document.getElementById("blockSelect");
  sel.innerHTML = "<option value=''>— choose user —</option>";
  allRegisteredUsers
    .filter(u => !blockedUsers.includes(u.username))
    .forEach(({ username: u, color: c }) => {
      const opt = document.createElement("option");
      opt.value = u;
      opt.textContent = u + (window._onlineUsers?.some(o => o.username === u) ? " 🟢" : " ⚫");
      sel.appendChild(opt);
    });
}

function blockUser() {
  const sel = document.getElementById("blockSelect");
  const u   = sel.value;
  if (!u) return;
  if (!blockedUsers.includes(u)) {
    blockedUsers.push(u);
    localStorage.setItem("blockedUsers", JSON.stringify(blockedUsers));
  }
  refreshBlockedList();
  refreshBlockSelect();
}

function unblockUser(u) {
  blockedUsers = blockedUsers.filter(x => x !== u);
  localStorage.setItem("blockedUsers", JSON.stringify(blockedUsers));
  refreshBlockedList();
  refreshBlockSelect();
}

function refreshBlockedList() {
  const list = document.getElementById("blockedList");
  list.innerHTML = blockedUsers.length === 0
    ? "<li class='blocked-empty'>No blocked users</li>"
    : blockedUsers.map(u => `
        <li class="blocked-item">
          <span>${u}</span>
          <button onclick="unblockUser('${u}')">Unblock</button>
        </li>`).join("");
}

// ── Create group ──────────────────────────────────────────────────────────────
let selectedGroupMembers = new Set();

function refreshGroupMembers() {
  const wrap = document.getElementById("groupMembersList");
  wrap.innerHTML = "";
  if (allRegisteredUsers.length === 0) {
    wrap.innerHTML = "<span style='font-size:12px;color:var(--text2)'>No other users registered yet</span>";
    return;
  }
  allRegisteredUsers.forEach(({ username: u, color: c }) => {
    const isOnline = window._onlineUsers?.some(o => o.username === u);
    const div = document.createElement("div");
    div.className = "group-member-item" + (selectedGroupMembers.has(u) ? " selected" : "");
    div.innerHTML = `
      <div class="user-avatar" style="background:${c};width:24px;height:24px;font-size:11px">${u[0].toUpperCase()}</div>
      <span>${escapeHtml(u)}</span>
      <span style="font-size:10px">${isOnline ? "🟢" : "⚫"}</span>`;
    div.onclick = () => {
      if (selectedGroupMembers.has(u)) selectedGroupMembers.delete(u);
      else selectedGroupMembers.add(u);
      div.classList.toggle("selected");
    };
    wrap.appendChild(div);
  });
}

function createGroup() {
  const name     = document.getElementById("groupName").value.trim();
  const feedback = document.getElementById("groupFeedback");
  if (!name) { feedback.textContent = "Enter a group name."; feedback.style.color = "#f87171"; return; }
  if (selectedGroupMembers.size === 0) { feedback.textContent = "Select at least one member."; feedback.style.color = "#f87171"; return; }
  const members = [username, ...selectedGroupMembers];
  socket.emit("create group", { name, members });
  feedback.textContent = `✅ Group "${name}" created!`;
  feedback.style.color = "#4ade80";
  document.getElementById("groupName").value = "";
  selectedGroupMembers.clear();
  refreshGroupMembers();
  setTimeout(() => feedback.textContent = "", 2500);
}

function addGroupToSidebar(name, members) {
  // Avoid duplicates
  if (document.querySelector(`[data-user="group:${name}"]`)) return;
  const li = document.createElement("li");
  li.className    = "user-item";
  li.dataset.user = "group:" + name;
  li.onclick      = () => selectRecipient("group:" + name, li);
  li.innerHTML    = `
    <div class="user-avatar group-avatar" style="font-size:11px">G</div>
    <div class="user-details">
      <span class="user-name">${escapeHtml(name)}</span>
      <span class="user-status">${members.length} members</span>
    </div>`;
  document.getElementById("userList").appendChild(li);

  const opt = document.createElement("option");
  opt.value       = "group:" + name;
  opt.textContent = "Group: " + name;
  document.getElementById("recipientSelect").appendChild(opt);
}