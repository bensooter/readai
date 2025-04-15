const messagesDiv = document.getElementById("messages");
const input = document.getElementById("input");

function appendMsg(role, text) {
  const div = document.createElement("div");
  div.textContent = `${role === "user" ? "You" : "Assistant"}: ${text}`;
  messagesDiv.appendChild(div);
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  appendMsg("user", text);
  input.value = "";

  const res = await fetch("/api/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "user1", message: text })
  });

  const data = await res.json();
  if (data.reply) {
    appendMsg("assistant", data.reply);
  } else {
    appendMsg("assistant", "Error getting response");
  }
}
