const express = require("express");
const multer = require("multer");
const pdfParse = require("pdf-parse");
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
const fileIndexPath = path.join(uploadDirectory, "files.json");
fs.mkdirSync(uploadDirectory, { recursive: true });
const upload = multer({ dest: uploadDirectory });
const port = process.env.PORT || 3000;
const readFileIndex = () => {
  try { return JSON.parse(fs.readFileSync(fileIndexPath, "utf8")); } catch { return []; }
};
const writeFileIndex = (files) => fs.writeFileSync(fileIndexPath, JSON.stringify(files, null, 2));

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (response, filePath) => {
    if (path.basename(filePath) === "app.js") response.setHeader("Cache-Control", "no-store");
  }
}));

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
  },
  cloudflare: {
    key: "CLOUDFLARE_API_TOKEN",
    model: "CLOUDFLARE_MODEL",
    defaultModel: "@cf/meta/llama-3.1-8b-instruct",
    url: "https://api.cloudflare.com/client/v4/accounts",
    headers: (key) => ({ Authorization: `Bearer ${key}` })
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
  if (provider.name === "cloudflare") {
    const response = await fetch(`${provider.url}/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, {
      method: "POST",
      headers: { ...provider.headers(key), "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: controller.signal
    });
    const data = await response.json();
    return { response, data, reply: data.result?.response || data.result?.text };
  }
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
  const { message, history = [], model, attachment } = req.body || {};
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
      { role: "system", content: "You are Alif AI, a helpful assistant. Reply directly to the user's latest question and do not answer an older topic unless explicitly asked. Reply in the same primary language as the latest message: use natural Bengali for Bengali, natural English for English, or a clean blend only when clearly requested. Never insert random words or phrases from other languages. Keep spelling, grammar, and wording clear. Use conversation history only to preserve relevant context. For how-to, coding, troubleshooting, or process questions, use numbered steps. When the user asks for HTML or any code, put the complete code in one fenced Markdown code block with the correct language tag. Never put code outside that block. If an attached document is provided, answer the user's question about that document first and do not discuss unrelated project topics." },
      ...history.slice(-12),
      { role: "user", content: attachment?.text
        ? `${message.trim()}\n\nAttached file: ${attachment.name}\nFile content:\n${attachment.text.slice(0, 50000)}`
        : message.trim() }
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

app.get("/api/search", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!query) return res.status(400).json({ error: "Search query লিখুন।" });
  const fetchJson = async (url) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Alif-AI/1.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  };
  try {
    const data = await fetchJson(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
    const topics = (data.RelatedTopics || [])
      .flatMap((topic) => topic.Topics || topic)
      .filter((topic) => topic && topic.Text)
      .slice(0, 6)
      .map((topic) => ({ title: topic.Text.split(" - ")[0], text: topic.Text, url: topic.FirstURL }));
    if (data.AbstractText || data.Answer || topics.length) return res.json({
      query,
      answer: data.AbstractText || data.Answer || "",
      source: data.AbstractSource || "DuckDuckGo",
      sourceUrl: data.AbstractURL || "",
      results: topics
    });
    throw new Error("No instant results");
  } catch (_error) {
    try {
      const data = await fetchJson(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=6&namespace=0&format=json&origin=*`);
      const results = (data[1] || []).map((title, index) => ({ title, text: title, url: data[3]?.[index] || "" }));
      return res.json({ query, answer: "", source: "Wikipedia", sourceUrl: "", results });
    } catch (_fallbackError) {
      return res.status(502).json({ error: "Web Search service সাময়িকভাবে unavailable। কিছুক্ষণ পরে আবার চেষ্টা করুন।" });
    }
  }
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "কোনো ফাইল পাওয়া যায়নি।" });
  let extractedText = "";
  if (req.file.mimetype === "application/pdf") {
    try {
      extractedText = pdfParse(fs.readFileSync(req.file.path)).then((result) => result.text);
    } catch (error) {
      return res.status(422).json({ error: "PDF পড়া যাচ্ছে না।" });
    }
  }
  const files = readFileIndex();
  files.push({ id: req.file.filename, name: req.file.originalname, size: req.file.size, uploadedAt: new Date().toISOString() });
  writeFileIndex(files);
  const finish = (text) => res.json({
    id: req.file.filename,
    name: req.file.originalname,
    size: req.file.size,
    text,
    message: `${req.file.originalname} attach হয়েছে। এখন প্রশ্ন লিখে Send চাপুন।`
  });
  if (extractedText && typeof extractedText.then === "function") extractedText.then(finish).catch(() => res.status(422).json({ error: "PDF-এর লেখা পড়া যাচ্ছে না।" }));
  else finish("");
});
app.get("/api/files", (_req, res) => res.json({ files: readFileIndex().reverse() }));
app.delete("/api/files/:id", (req, res) => {
  const files = readFileIndex();
  const file = files.find((item) => item.id === req.params.id);
  if (!file) return res.status(404).json({ error: "ফাইল পাওয়া যায়নি।" });
  const filePath = path.join(uploadDirectory, file.id);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  writeFileIndex(files.filter((item) => item.id !== file.id));
  res.json({ ok: true });
});

app.get("/api/health", (_req, res) => res.json({ status: "ok", assistant: "Alif AI" }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(port, () => console.log(`Alif AI চলছে: http://localhost:${port}`));
