const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const THREADS_FILE = path.join(__dirname, "threads.json");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

if (!OPENAI_API_KEY || !ASSISTANT_ID) {
  console.error("❌ Missing OPENAI_API_KEY or ASSISTANT_ID in environment");
  process.exit(1);
}

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Load or initialize thread map
let threadMap = {};
if (fs.existsSync(THREADS_FILE)) {
  threadMap = JSON.parse(fs.readFileSync(THREADS_FILE, "utf8"));
}

function saveThreads() {
  fs.writeFileSync(THREADS_FILE, JSON.stringify(threadMap, null, 2));
}

// Reset conversation
app.post("/api/reset", (req, res) => {
  const { userId } = req.body;
  if (userId && threadMap[userId]) {
    delete threadMap[userId];
    saveThreads();
    console.log(`🔁 Reset thread for ${userId}`);
    return res.json({ success: true });
  }
  res.json({ success: false });
});

// Send message
app.post("/api/message", async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!userId || !message) {
      return res.status(400).json({ error: "Missing userId or message" });
    }

    console.log(`📩 ${userId}: "${message}"`);

    let threadId = threadMap[userId];

    // Create new thread if needed
    if (!threadId) {
      const threadRes = await fetch("https://api.openai.com/v1/threads", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2"
        }
      });
      const threadData = await threadRes.json();
      threadId = threadData.id;
      threadMap[userId] = threadId;
      saveThreads();
    }

    console.log(`🧵 Using thread: ${threadId}`);

    // Add message to thread
    await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2"
      },
      body: JSON.stringify({ role: "user", content: message })
    });

    // Run assistant
    const runRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2"
      },
      body: JSON.stringify({ assistant_id: ASSISTANT_ID })
    });

    const runData = await runRes.json();
    const runId = runData.id;
    let status = runData.status;

    // Poll for run completion
    while (status !== "completed" && status !== "failed") {
      await new Promise(r => setTimeout(r, 1000));
      const pollRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2"
        }
      });
      const pollData = await pollRes.json();
      status = pollData.status;
    }

    // Get assistant's reply
    if (status === "completed") {
      const msgRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2"
        }
      });
      const msgData = await msgRes.json();

      const assistantMessages = msgData.data
        .filter(m => m.role === "assistant")
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      const reply = assistantMessages.length > 0
        ? assistantMessages[assistantMessages.length - 1].content[0]?.text?.value
        : "No assistant reply found.";

      console.log(`🤖 Assistant: "${reply}"`);
      res.json({ reply });
    } else {
      console.error("❌ Assistant run failed.");
      res.status(500).json({ error: "Assistant run failed." });
    }
  } catch (err) {
    console.error("❌ Error in /api/message:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ ReadAI Assistant running on port ${PORT}`);
});
