const socket = io();
let username = prompt("Enter your name:") || "Anonymous";
socket.emit("join", username);

// Handle form submit
document.getElementById("chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const messageInput = document.getElementById("message");
  const recipient = document.getElementById("recipient").value;
  const message = messageInput.value.trim();

  if (!message) return;

  // If sending to Broadcast Server, confirm urgency
  if (recipient === "Broadcast Server") {
    alert(`🚨 Urgent message to everyone from ${username}`);
  }

  socket.emit("chat message", { sender: username, recipient, message });
  messageInput.value = "";
});

// Normal chat messages
socket.on("chat message", (data) => {
  const chatBox = document.getElementById("messages");
  const li = document.createElement("li");
  li.textContent = `[${data.time}] ${data.sender}: ${data.message}`;
  chatBox.appendChild(li);
});

// Broadcast messages → popup + chat
socket.on("broadcast server", (data) => {
  alert(`🚨 URGENT from ${data.sender}: ${data.message}`);
  const chatBox = document.getElementById("messages");
  const li = document.createElement("li");
  li.style.color = "red";
  li.textContent = `[${data.time}] 🔔 ${data.sender} (URGENT): ${data.message}`;
  chatBox.appendChild(li);
});

// Update dropdown
socket.on("update users", (userList) => {
  const recipientSelect = document.getElementById("recipient");
  recipientSelect.innerHTML = `
    <option value="Everyone">Everyone</option>
    <option value="Broadcast Server">Broadcast Server</option>
  `;
  userList.forEach((user) => {
    if (user !== username) {
      const opt = document.createElement("option");
      opt.value = user;
      opt.textContent = `Private: ${user}`;
      recipientSelect.appendChild(opt);
    }
  });
});
