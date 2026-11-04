const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([^#=]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  });
}

const app = express();
const uploadDirectory = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDirectory, { recursive: true });
const upload = multer({ dest: uploadDirectory });
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const demoReply = (message) =>
  `আমি Alif AI। আপনার বার্তা পেয়েছি: “${message}”\n\nএখনও API key যোগ করা হয়নি, তাই এটি demo mode-এ চলছে। .env ফাইলে নির্বাচিত provider-এর API key যোগ করলে real-time AI উত্তর পাবেন।`;

const providerConfig = {
  openrouter: {
    key: "OPENROUTER_API_KEY",
    model: "OPENROUTER_MODEL",
    defaultModel: "openrouter/free",
    url: "https://openrouter.ai/api/v1/chat/completions",
    headers: (key) => ({ Authorization: `Bearer ${key}`, "HTTP-Referer": "http://localhost:3000", "X-Title": "Alif AI" })
  },
  groq: {
    key: "GROQ_API_KEY",
    model: "GROQ_MODEL",
    defaultModel: "llama-3.3-70b-versatile",
    url: "https://api.groq.com/openai/v1/chat/completions",
    headers: (key) => ({ Authorization: `Bearer ${key}` })
  },
  gemini: {
    key: "GEMINI_API_KEY",
    model: "GEMINI_MODEL",
    defaultModel: "gemini-3.8-flash",
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    headers: () => ({})
  }
};

function getProvider() {
  const provider = (process.env.AI_PROVIDER || "openrouter").toLowerCase();
  return providerConfig[provider] ? { name: provider, ...providerConfig[provider] } : null;
}

async function requestChat(provider, key, model, messages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
  if (provider.name === "gemini") {
    const response = await fetch(`${provider.url}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: messages.filter((item) => item.role !== "system").map((item) => ({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: item.content }] })) }),
      signal: controller.signal
    });
    const data = await response.json();
    return { response, data, reply: data.candidates?.[0]?.content?.parts?.[0]?.text };
  }
  const response = await fetch(provider.url, {
    method: "POST",
    headers: { ...provider.headers(key), "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages }),
    signal: controller.signal
  });
  const data = await response.json();
  return { response, data, reply: data.choices?.[0]?.message?.content };
  } finally {
    clearTimeout(timeout);
  }
}

app.post("/api/chat", async (req, res) => {
  const { message, history = [], model } = req.body || {};
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "একটি বার্তা লিখুন।" });
  }

  const provider = getProvider();
  const apiKey = provider && process.env[provider.key];
  if (!provider || !apiKey) {
    return res.json({ reply: demoReply(message.trim()), mode: "demo" });
  }

  try {
    const messages = [
      { role: "system", content: "You are Alif AI, a helpful bilingual Bengali-English assistant. Use the conversation history to keep every reply consistent with the user's previous messages and project context. Make every answer easy to follow: explain the result in a short introduction, then use numbered step-by-step instructions (1., 2., 3.) whenever the user asks how to do something, asks for code, troubleshooting, or a process. Put every code example inside a fenced Markdown code block with the correct language tag, such as ```html, ```css, ```javascript, or ```powershell. Never put code in normal paragraphs. Include a short example when useful. Keep simple answers concise, but never skip important steps." },
      ...history.slice(-12),
      { role: "user", content: message.trim() }
    ];
    const result = await requestChat(provider, apiKey, model || process.env[provider.model] || provider.defaultModel, messages);
    const { response, data } = result;
    if (!response.ok) {
      return res.status(502).json({ error: data.error?.message || "AI provider উত্তর দিতে পারেনি।" });
    }
    const reply = result.reply || "কোনো উত্তর পাওয়া যায়নি।";
    return res.json({ reply, response: reply, mode: "live", provider: provider.name });
  } catch (error) {
    const message = error.name === "AbortError"
      ? "AI service উত্তর দিতে ৯০ সেকেন্ডের বেশি সময় নিয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।"
      : `AI service error: ${error.message}`;
    return res.status(502).json({ error: message });
  }
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "কোনো ফাইল পাওয়া যায়নি।" });
  res.json({
    name: req.file.originalname,
    size: req.file.size,
    message: `${req.file.originalname} আপলোড হয়েছে। PDF/image analysis pipeline-এ পাঠানোর জন্য প্রস্তুত।`
  });
});

app.get("/api/health", (_req, res) => res.json({ status: "ok", assistant: "Alif AI" }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(port, () => console.log(`Alif AI চলছে: http://localhost:${port}`));
