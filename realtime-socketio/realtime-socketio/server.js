import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
let users = {}; // socket.id → username

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("join", (username) => {
    users[socket.id] = username;
    console.log(`${username} joined`);

    io.emit("update users", Object.values(users)); // update dropdown
    io.emit("chat message", {
      sender: "Server",
      message: `${username} joined the chat`,
      time: new Date().toLocaleTimeString()
    });
  });

  socket.on("chat message", ({ sender, recipient, message }) => {
    const time = new Date().toLocaleTimeString();

    if (recipient === "Broadcast Server") {
      io.emit("broadcast server", { sender, message, time });
    } 
    else if (recipient === "Everyone") {
      io.emit("chat message", { sender, message, time });
    } 
    else {
      const targetId = Object.keys(users).find((id) => users[id] === recipient);
      if (targetId) {
        io.to(targetId).emit("chat message", { sender, message, time });
        socket.emit("chat message", { sender, message, time }); // show in sender’s chat too
      }
    }
  });

  socket.on("disconnect", () => {
    const username = users[socket.id];
    console.log(`${username} disconnected`);
    delete users[socket.id];
    io.emit("update users", Object.values(users));
    io.emit("chat message", {
      sender: "Server",
      message: `${username} left the chat`,
      time: new Date().toLocaleTimeString()
    });
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
 