import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Loki from "lokijs";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── Database ──────────────────────────────────────────────────────────────────
const db = new Loki("chat.db", { autosave: true, autosaveInterval: 2000 });
let users, messages, groups;

function initDB() {
  users    = db.getCollection("users")    || db.addCollection("users",    { indices: ["username"] });
  messages = db.getCollection("messages") || db.addCollection("messages");
  groups   = db.getCollection("groups")   || db.addCollection("groups",   { indices: ["name"] });
}

db.loadDatabase({}, () => { initDB(); console.log("Database ready"); });

// ─── Express ───────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const JWT_SECRET = process.env.JWT_SECRET;
const PORT       = process.env.PORT || 3000;

// ─── Helpers ───────────────────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign({ id: user.$loki, username: user.username, color: user.color }, JWT_SECRET, { expiresIn: "7d" });
}
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}
function authMiddleware(req, res, next) {
  const user = verifyToken(req.headers.authorization?.split(" ")[1]);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  req.user = user; next();
}

// ─── REST routes ───────────────────────────────────────────────────────────────
app.post("/api/register", async (req, res) => {
  const { username, password, color } = req.body;
  if (!username || !password)  return res.status(400).json({ error: "Username and password required" });
  if (username.length < 3)     return res.status(400).json({ error: "Username must be at least 3 characters" });
  if (password.length < 6)     return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (users.findOne({ username })) return res.status(409).json({ error: "Username already taken" });
  const hashed   = await bcrypt.hash(password, 10);
  const msgColor = color || "#6c63ff";
  const user     = users.insert({ username, password: hashed, color: msgColor, createdAt: new Date().toISOString() });
  res.json({ token: signToken(user), username, color: msgColor });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });
  const user = users.findOne({ username });
  if (!user)  return res.status(401).json({ error: "Invalid username or password" });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "Invalid username or password" });
  res.json({ token: signToken(user), username: user.username, color: user.color });
});

app.post("/api/update-color", authMiddleware, (req, res) => {
  const { color } = req.body;
  if (!color) return res.status(400).json({ error: "Color required" });
  const user = users.findOne({ username: req.user.username });
  if (!user)  return res.status(404).json({ error: "User not found" });
  user.color = color;
  users.update(user);
  const online = onlineUsers.get(req.user.username);
  if (online) online.color = color;
  broadcastOnlineUsers();
  res.json({ ok: true });
});

// Last 50 public messages in chronological order
app.get("/api/messages", authMiddleware, (req, res) => {
  const all = messages.find({ recipient: "Everyone" });
  all.sort((a, b) => a.$loki - b.$loki);
  res.json(all.slice(-50));
});

// All registered users (for profile panel block/group pickers)
app.get("/api/users", authMiddleware, (req, res) => {
  const all = users.find().map(u => ({ username: u.username, color: u.color }));
  res.json(all.filter(u => u.username !== req.user.username));
});

// ─── Socket.IO ─────────────────────────────────────────────────────────────────
io.use((socket, next) => {
  const user = verifyToken(socket.handshake.auth?.token);
  if (!user) return next(new Error("Authentication failed"));
  socket.user = user; next();
});

const onlineUsers  = new Map();  // username → { socketId, color }
const doodleRooms  = new Map();  // roomName → Set of usernames
const canvasStates = new Map();  // roomName → base64 PNG snapshot

io.on("connection", (socket) => {
  const { username, color } = socket.user;
  onlineUsers.set(username, { socketId: socket.id, color: color || "#6c63ff" });
  console.log(username + " connected");

  broadcastOnlineUsers();
  io.emit("chat message", {
    sender: "Server", recipient: "Everyone",
    message: username + " joined the chat",
    type: "system", time: new Date().toLocaleTimeString(),
  });

  // ── Typing ────────────────────────────────────────────────────────────────────
  socket.on("typing", ({ recipient }) => {
    const p = { sender: username, recipient };
    if (recipient === "Everyone") socket.broadcast.emit("typing", p);
    else { const t = onlineUsers.get(recipient); if (t) io.to(t.socketId).emit("typing", p); }
  });
  socket.on("stop typing", ({ recipient }) => {
    const p = { sender: username };
    if (recipient === "Everyone") socket.broadcast.emit("stop typing", p);
    else { const t = onlineUsers.get(recipient); if (t) io.to(t.socketId).emit("stop typing", p); }
  });

  // ── Chat messages ─────────────────────────────────────────────────────────────
  socket.on("chat message", ({ recipient, message, urgent }) => {
    if (!message?.trim()) return;
    const userRecord = users.findOne({ username });
    const userColor  = userRecord?.color || color || "#6c63ff";
    const time       = new Date().toLocaleTimeString();
    const payload    = { sender: username, recipient, message, type: "text", time, color: userColor };

    if (urgent || recipient === "Broadcast") {
      io.emit("urgent message", { ...payload, recipient: "Everyone" });
    } else if (recipient === "Everyone") {
      messages.insert({ sender: username, recipient, message, type: "text", color: userColor, created_at: new Date().toISOString() });
      io.emit("chat message", payload);
    } else if (recipient.startsWith("group:")) {
      const groupName = recipient.slice(6);
      const group     = groups.findOne({ name: groupName });
      if (group) {
        group.members.forEach(m => {
          const t = onlineUsers.get(m);
          if (t) io.to(t.socketId).emit("chat message", payload);
        });
      }
    } else {
      const target = onlineUsers.get(recipient);
      if (target) io.to(target.socketId).emit("chat message", payload);
      socket.emit("chat message", payload);
    }
  });

  // ── Groups ────────────────────────────────────────────────────────────────────
  socket.on("create group", ({ name, members }) => {
    if (groups.findOne({ name })) {
      socket.emit("chat message", {
        sender: "Server", recipient: "Everyone",
        message: `Group "${name}" already exists.`,
        type: "system", time: new Date().toLocaleTimeString(),
      });
      return;
    }
    groups.insert({ name, members, createdBy: username, createdAt: new Date().toISOString() });
    members.forEach(m => {
      const t = onlineUsers.get(m);
      if (t) io.to(t.socketId).emit("group created", { name, members });
    });
  });

  // ── FunnDoodle ────────────────────────────────────────────────────────────────
  socket.on("doodle:join", ({ room }) => {
    socket.join("doodle:" + room);
    if (!doodleRooms.has(room)) doodleRooms.set(room, new Set());
    doodleRooms.get(room).add(username);
    // Send existing canvas snapshot to the new joiner only
    if (canvasStates.has(room)) {
      socket.emit("doodle:snapshot", { imageData: canvasStates.get(room) });
    }
    io.to("doodle:" + room).emit("doodle:users", doodleRooms.get(room).size);
  });

  socket.on("doodle:leave", ({ room }) => {
    socket.leave("doodle:" + room);
    doodleRooms.get(room)?.delete(username);
    io.to("doodle:" + room).emit("doodle:users", doodleRooms.get(room)?.size || 0);
  });

  socket.on("doodle:stroke", (data) => {
    socket.to("doodle:" + data.room).emit("doodle:stroke", data);
  });

  socket.on("doodle:fill", (data) => {
    socket.to("doodle:" + data.room).emit("doodle:fill", data);
  });

  // Client sends periodic snapshots so server can share with new joiners
  socket.on("doodle:save-snapshot", ({ room, imageData }) => {
    canvasStates.set(room, imageData);
  });

  socket.on("doodle:clear", ({ room }) => {
    canvasStates.delete(room);
    socket.to("doodle:" + room).emit("doodle:clear");
  });

  // ── Disconnect ────────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    onlineUsers.delete(username);
    doodleRooms.forEach((set, room) => {
      if (set.delete(username)) io.to("doodle:" + room).emit("doodle:users", set.size);
    });
    console.log(username + " disconnected");
    broadcastOnlineUsers();
    io.emit("chat message", {
      sender: "Server", recipient: "Everyone",
      message: username + " left the chat",
      type: "system", time: new Date().toLocaleTimeString(),
    });
  });
});

function broadcastOnlineUsers() {
  io.emit("online users", Array.from(onlineUsers.entries()).map(([u, d]) => ({ username: u, color: d.color })));
}

server.listen(PORT, () => console.log("Server running on http://localhost:" + PORT));