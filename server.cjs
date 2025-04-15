const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

if (!OPENAI_API_KEY || !ASSISTANT_ID) {
  console.error("❌ Missing OPENAI_API_KEY or ASSISTANT_ID in environment");
  process.exit(1);
}

app.use(cors()); // Allow all origins – good for testing
app.use(express.json());
app.use(express.static("public")); // optional, in case you add frontend later

let sessions = {}; // in-memory user thread tracking

app.post("/api/message", async (req, res) => {
  try {
    const { userId, message } = req.body;

    if (!userId || !message) {
      return res.status(400).json({ error: "Missing userId or message" });
    }

    console.log(`📩 Received message from ${userId}: "${message}"`);

    // Step 1: Create thread if needed
    if (!sessions[userId]) {
      const threadRes = await fetch("https://api.openai.com/v1/threads", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2"
        }
      });
      const threadData = await threadRes.json();
      sessions[userId] = { thread_id: threadData.id };
    }

    const threadId = sessions[userId].thread_id;

    // Step 2: Add message
    await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2"
      },
      body: JSON.stringify({ role: "user", content: message })
    });

    // Step 3: Run assistant
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

    // Step 4: Poll for completion
    let runStatus = runData.status;
    while (runStatus !== "completed" && runStatus !== "failed") {
      await new Promise(r => setTimeout(r, 1000));
      const pollRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2"
        }
      });
      const pollData = await pollRes.json();
      runStatus = pollData.status;
    }

    // Step 5: Get assistant reply
    if (runStatus === "completed") {
      const msgRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2"
        }
      });
      const msgData = await msgRes.json();
      const assistantReply = msgData.data
        .reverse()
        .find(m => m.role === "assistant")?.content[0]?.text?.value;

      console.log(`🤖 Assistant reply to ${userId}: "${assistantReply}"`);

      res.json({ reply: assistantReply || "No reply found." });
    } else {
      console.error(`⚠️ Run failed for user ${userId}`);
      res.status(500).json({ error: "Assistant run failed." });
    }
  } catch (err) {
    console.error("❌ Error in /api/message:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ ReadAI Assistant server running on port ${PORT}`);
});
