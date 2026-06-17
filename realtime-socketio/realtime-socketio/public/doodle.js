// ── FuNNDooDLE — real-time shared canvas ──────────────────────────────────────
const DOODLE_COLORS = [
  "#ffffff","#f87171","#fb923c","#fbbf24","#a3e635",
  "#34d399","#38bdf8","#818cf8","#e879f9","#000000"
];

let doodleTool    = "pen";
let doodleColor   = "#ffffff";
let brushSize     = 6;
let drawing       = false;
let lastX = 0, lastY = 0;
let doodleOpen    = false;
let doodleRoom    = "Everyone";
let snapshotTimer = null;

const canvas = document.getElementById("doodleCanvas");
const ctx    = canvas.getContext("2d");
const cursor = document.getElementById("doodleCursor");

// ── Generate consistent room name for two users ───────────────────────────────
// Alphabetical sort so A+B and B+A always get same room name
function privateRoomName(userA, userB) {
  return "private:" + [userA, userB].sort().join(":");
}

// ── Build color swatches in toolbar ───────────────────────────────────────────
function buildDoodleColors() {
  const wrap = document.getElementById("doodleColors");
  wrap.innerHTML = "";
  DOODLE_COLORS.forEach((c) => {
    const b = document.createElement("button");
    b.className        = "doodle-color" + (c === doodleColor ? " active" : "");
    b.style.background = c;
    b.title            = c;
    b.onclick = () => {
      doodleColor = c;
      doodleTool  = "pen";
      updateToolUI();
      document.querySelectorAll(".doodle-color").forEach(s => s.classList.remove("active"));
      b.classList.add("active");
    };
    wrap.appendChild(b);
  });
}

// ── Build room selector dropdown ──────────────────────────────────────────────
function buildRoomSelector() {
  const sel = document.getElementById("doodleRoomSelect");
  if (!sel) return;
  const current = sel.value || "Everyone";
  sel.innerHTML = `<option value="Everyone">🌐 Everyone</option>`;
  (window._onlineUsers || []).filter(u => u.username !== username).forEach(({ username: u }) => {
    const opt = document.createElement("option");
    // Use sorted room name as value so both sides match
    opt.value       = privateRoomName(username, u);
    opt.textContent = "🔒 Private: " + u;
    sel.appendChild(opt);
  });
  // Restore selection
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
}

// ── Open doodle modal ─────────────────────────────────────────────────────────
function openDoodle() {
  document.getElementById("doodleOverlay").classList.add("active");
  document.getElementById("doodleModal").classList.add("active");
  doodleOpen = true;
  resizeCanvas();
  buildDoodleColors();
  buildRoomSelector();

  // Pre-select room matching current chat partner
  const sel = document.getElementById("doodleRoomSelect");
  if (sel && currentRecipient !== "Everyone" && !currentRecipient.startsWith("group:")) {
    const roomVal = privateRoomName(username, currentRecipient);
    if ([...sel.options].some(o => o.value === roomVal)) sel.value = roomVal;
  }

  setTimeout(() => joinDoodleRoom(sel?.value || "Everyone"), 80);
}

// ── Close doodle modal ────────────────────────────────────────────────────────
function closeDoodle() {
  document.getElementById("doodleOverlay").classList.remove("active");
  document.getElementById("doodleModal").classList.remove("active");
  doodleOpen = false;
  socket.emit("doodle:leave", { room: doodleRoom });
  clearInterval(snapshotTimer);
}

// ── Join a doodle room ────────────────────────────────────────────────────────
function joinDoodleRoom(room) {
  if (doodleOpen && doodleRoom && doodleRoom !== room) {
    socket.emit("doodle:leave", { room: doodleRoom });
  }
  doodleRoom = room;

  // Human-readable label
  let label = "Room: Everyone";
  if (room.startsWith("private:")) {
    const parts   = room.replace("private:", "").split(":");
    const partner = parts.find(p => p !== username) || parts[0];
    label = "Room: Private with " + partner;
  }
  document.getElementById("doodleRoomLabel").textContent = label;

  // Clear canvas ready for new room's snapshot
  ctx.fillStyle = "#1a1d27";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  socket.emit("doodle:join", { room });

  // Send snapshot every 3 seconds so server always has latest for new joiners
  clearInterval(snapshotTimer);
  snapshotTimer = setInterval(sendSnapshot, 3000);
}

// ── Send canvas snapshot to server ────────────────────────────────────────────
function sendSnapshot() {
  if (!doodleOpen) return;
  socket.emit("doodle:save-snapshot", { room: doodleRoom, imageData: canvas.toDataURL() });
}

// ── Resize canvas ─────────────────────────────────────────────────────────────
function resizeCanvas() {
  const wrap = canvas.parentElement;
  const temp = document.createElement("canvas");
  temp.width  = canvas.width;
  temp.height = canvas.height;
  temp.getContext("2d").drawImage(canvas, 0, 0);

  canvas.width  = wrap.clientWidth  || 800;
  canvas.height = wrap.clientHeight || 460;
  ctx.fillStyle = "#1a1d27";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (temp.width > 0 && temp.height > 0) ctx.drawImage(temp, 0, 0);
}

window.addEventListener("resize", () => { if (doodleOpen) resizeCanvas(); });

// ── Tool controls ─────────────────────────────────────────────────────────────
function setTool(t) { doodleTool = t; updateToolUI(); }
function updateToolUI() {
  ["pen","fill","eraser"].forEach(t => {
    const btn = document.getElementById("tool" + t[0].toUpperCase() + t.slice(1));
    if (btn) btn.classList.toggle("active", doodleTool === t);
  });
}
function updateBrushSize(v) {
  brushSize = +v;
  document.getElementById("brushSizeLabel").textContent = v;
}

// ── Draw a stroke ─────────────────────────────────────────────────────────────
function drawStroke({ x1, y1, x2, y2, color, size, tool }) {
  ctx.save();
  if (tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = color;
  }
  ctx.lineWidth = size;
  ctx.lineCap   = "round";
  ctx.lineJoin  = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

// ── Flood fill ────────────────────────────────────────────────────────────────
function floodFill(startX, startY, fillColor) {
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data    = imgData.data;
  const w = canvas.width, h = canvas.height;
  const idx = (startY * w + startX) * 4;
  const tR  = data[idx], tG = data[idx+1], tB = data[idx+2], tA = data[idx+3];
  const [fR, fG, fB] = hexToRgb(fillColor);
  if (tR===fR && tG===fG && tB===fB) return;
  const stack = [[startX, startY]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx<0||cy<0||cx>=w||cy>=h) continue;
    const i = (cy*w+cx)*4;
    if (data[i]!==tR||data[i+1]!==tG||data[i+2]!==tB||data[i+3]!==tA) continue;
    data[i]=fR; data[i+1]=fG; data[i+2]=fB; data[i+3]=255;
    stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
  }
  ctx.putImageData(imgData, 0, 0);
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

// ── Canvas event helpers ──────────────────────────────────────────────────────
function getPos(e) {
  const r      = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / r.width;
  const scaleY = canvas.height / r.height;
  if (e.touches) return {
    x: (e.touches[0].clientX - r.left) * scaleX,
    y: (e.touches[0].clientY - r.top)  * scaleY,
  };
  return {
    x: (e.clientX - r.left) * scaleX,
    y: (e.clientY - r.top)  * scaleY,
  };
}

canvas.addEventListener("mousedown",  startDraw);
canvas.addEventListener("mousemove",  moveDraw);
canvas.addEventListener("mouseup",    endDraw);
canvas.addEventListener("mouseleave", endDraw);
canvas.addEventListener("touchstart", e => { e.preventDefault(); startDraw(e); }, { passive: false });
canvas.addEventListener("touchmove",  e => { e.preventDefault(); moveDraw(e);  }, { passive: false });
canvas.addEventListener("touchend",   endDraw);

canvas.addEventListener("mousemove", (e) => {
  const r = canvas.getBoundingClientRect();
  cursor.style.left    = (e.clientX - r.left) + "px";
  cursor.style.top     = (e.clientY - r.top)  + "px";
  cursor.style.width   = brushSize + "px";
  cursor.style.height  = brushSize + "px";
  cursor.style.display = "block";
});
canvas.addEventListener("mouseleave", () => { cursor.style.display = "none"; });

function startDraw(e) {
  const { x, y } = getPos(e);
  if (doodleTool === "fill") {
    floodFill(Math.round(x), Math.round(y), doodleColor);
    socket.emit("doodle:fill", { room: doodleRoom, x: Math.round(x), y: Math.round(y), color: doodleColor });
    sendSnapshot();
    return;
  }
  drawing = true; lastX = x; lastY = y;
}

function moveDraw(e) {
  if (!drawing) return;
  const { x, y } = getPos(e);
  const stroke    = { x1: lastX, y1: lastY, x2: x, y2: y, color: doodleColor, size: brushSize, tool: doodleTool };
  drawStroke(stroke);
  socket.emit("doodle:stroke", { room: doodleRoom, ...stroke });
  lastX = x; lastY = y;
}

function endDraw() { drawing = false; }

// ── Clear / Save ──────────────────────────────────────────────────────────────
function clearCanvas() {
  ctx.fillStyle = "#1a1d27";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  socket.emit("doodle:clear", { room: doodleRoom });
}

function saveDrawing() {
  const link    = document.createElement("a");
  link.download = "FunnDoodle_" + Date.now() + ".png";
  link.href     = canvas.toDataURL();
  link.click();
}

// ── Incoming socket events ────────────────────────────────────────────────────
socket.on("doodle:stroke", (data) => { if (doodleOpen) drawStroke(data); });
socket.on("doodle:fill",   (data) => { if (doodleOpen) floodFill(data.x, data.y, data.color); });
socket.on("doodle:clear",  ()     => {
  if (doodleOpen) { ctx.fillStyle = "#1a1d27"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
});
socket.on("doodle:users", (n) => {
  document.getElementById("doodleOnline").textContent =
    n === 1 ? "🟢 Just you" : "🟢 " + n + " people drawing together!";
});
socket.on("doodle:snapshot", ({ imageData }) => {
  if (!doodleOpen) return;
  const img  = new Image();
  img.onload = () => {
    ctx.fillStyle = "#1a1d27";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.src = imageData;
});