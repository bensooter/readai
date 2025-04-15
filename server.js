const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public")); // serves frontend

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

// Store sessions per user (in memory – simple)
let sessions = {};

app.post("/api/message", async (req, res) => {
  const { userId, message } = req.body;

  if (!userId || !message) return res.status(400).json({ error: "Missing userId or message" });

  // Initialize thread if needed
  if (!sessions[userId]) {
    const threadResp = await fetch("https://api.openai.com/v1/threads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2"
      }
    });
    const threadData = await threadResp.json();
    sessions[userId] = { thread_id: threadData.id };
  }

  const threadId = sessions[userId].thread_id;

  // Add user message
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
  let runStatus = runData.status;

  // Poll until run is complete
  while (runStatus !== "completed" && runStatus !== "failed") {
    await new Promise(r => setTimeout(r, 1000));
    const pollRun = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runData.id}`, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "assistants=v2"
      }
    });
    const runStatusData = await pollRun.json();
    runStatus = runStatusData.status;
  }

  if (runStatus === "completed") {
    const msgResp = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "assistants=v2"
      }
    });
    const msgData = await msgResp.json();
    const reply = msgData.data.reverse().find(m => m.role === "assistant")?.content[0]?.text?.value;
    res.json({ reply });
  } else {
    res.status(500).json({ error: "Assistant run failed." });
  }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
