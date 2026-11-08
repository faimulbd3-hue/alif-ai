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
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET || "alif-files";
const supabaseEnabled = Boolean(supabaseUrl && supabaseAnonKey && supabaseServiceRoleKey);
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

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function supabaseRequest(endpoint, options = {}, useServiceRole = true) {
  const key = useServiceRole ? supabaseServiceRoleKey : supabaseAnonKey;
  const { token, ...fetchOptions } = options;
  const response = await fetch(`${supabaseUrl}${endpoint}`, {
    ...fetchOptions,
    headers: {
      apikey: key,
      Authorization: `${token ? "Bearer " + token : "Bearer " + key}`,
      ...(fetchOptions.body ? { "Content-Type": "application/json" } : {}),
      ...(fetchOptions.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data };
}

async function getSupabaseUser(req) {
  if (!supabaseEnabled) return null;
  const token = getBearerToken(req);
  if (!token) return null;
  const result = await supabaseRequest("/auth/v1/user", { token }, false);
  return result.response.ok ? result.data : null;
}

async function requireSupabaseUser(req, res) {
  if (!supabaseEnabled) {
    res.status(503).json({ error: "Supabase এখনো configure করা হয়নি।" });
    return null;
  }
  const user = await getSupabaseUser(req);
  if (!user) {
    res.status(401).json({ error: "আগে sign in করুন।" });
    return null;
  }
  return user;
}

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

function getConfiguredProvider(name) {
  const config = providerConfig[name];
  if (!config || !process.env[config.key]) return null;
  return { name, ...config };
}

function getOpenRouterKeys() {
  return [process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_API_KEY_2]
    .filter((key, index, keys) => key && keys.indexOf(key) === index);
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

app.get("/api/config", (_req, res) => res.json({
  supabase: supabaseEnabled ? { url: supabaseUrl, anonKey: supabaseAnonKey } : null
}));

app.post("/api/auth/signup", async (req, res) => {
  if (!supabaseEnabled) return res.status(503).json({ error: "Supabase configure করুন।" });
  const { email, password, name } = req.body || {};
  if (!email || typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "সঠিক email এবং কমপক্ষে ৬ অক্ষরের password দিন।" });
  }
  try {
    const result = await supabaseRequest("/auth/v1/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, data: { name: String(name || "").trim() } })
    }, false);
    if (!result.response.ok) return res.status(result.response.status).json({ error: result.data?.msg || result.data?.message || "Account তৈরি করা যায়নি।" });
    res.status(201).json({ user: result.data.user || result.data, session: result.data.session || null, needsEmailConfirmation: !result.data.access_token });
  } catch (error) {
    res.status(502).json({ error: `Supabase signup error: ${error.message}` });
  }
});

app.post("/api/auth/login", async (req, res) => {
  if (!supabaseEnabled) return res.status(503).json({ error: "Supabase configure করুন।" });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email এবং password দিন।" });
  try {
    const result = await supabaseRequest("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }, false);
    if (!result.response.ok) return res.status(401).json({ error: result.data?.error_description || result.data?.msg || "Email বা password সঠিক নয়।" });
    res.json({ session: result.data, user: result.data.user });
  } catch (error) {
    res.status(502).json({ error: `Supabase login error: ${error.message}` });
  }
});

app.get("/api/auth/me", async (req, res) => {
  if (!supabaseEnabled) return res.status(503).json({ error: "Supabase configure করুন।" });
  try {
    const user = await getSupabaseUser(req);
    if (!user) return res.status(401).json({ error: "Sign in required." });
    res.json({ user });
  } catch (error) {
    res.status(502).json({ error: `Supabase auth error: ${error.message}` });
  }
});

app.get("/api/history", async (req, res) => {
  const user = await requireSupabaseUser(req, res);
  if (!user) return;
  const result = await supabaseRequest(`/rest/v1/chats?select=id,title,messages,created_at,updated_at&user_id=eq.${encodeURIComponent(user.id)}&order=updated_at.desc&limit=50`);
  if (!result.response.ok) return res.status(502).json({ error: "Cloud chat history load করা যায়নি।" });
  res.json({ history: result.data.map((item) => ({ id: item.id, title: item.title, messages: item.messages || [] })) });
});

app.post("/api/history", async (req, res) => {
  const user = await requireSupabaseUser(req, res);
  if (!user) return;
  const incoming = Array.isArray(req.body?.history) ? req.body.history.slice(-50) : [];
  const old = await supabaseRequest(`/rest/v1/chats?user_id=eq.${encodeURIComponent(user.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  if (!old.response.ok) return res.status(502).json({ error: "পুরোনো cloud history update করা যায়নি।" });
  if (incoming.length) {
    const rows = incoming.map((item) => ({
      user_id: user.id,
      title: String(item.title || "New chat").slice(0, 120),
      messages: Array.isArray(item.messages) ? item.messages.slice(-100) : []
    }));
    const result = await supabaseRequest("/rest/v1/chats", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
    if (!result.response.ok) return res.status(502).json({ error: "Cloud history save করা যায়নি।" });
  }
  res.json({ ok: true });
});

app.delete("/api/history", async (req, res) => {
  const user = await requireSupabaseUser(req, res);
  if (!user) return;
  const result = await supabaseRequest(`/rest/v1/chats?user_id=eq.${encodeURIComponent(user.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  if (!result.response.ok) return res.status(502).json({ error: "Cloud history clear করা যায়নি।" });
  res.json({ ok: true });
});

app.post("/api/chat", async (req, res) => {
  const { message, history = [], model, attachment } = req.body || {};
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "একটি বার্তা লিখুন।" });
  }

  const provider = getProvider();
  const apiKey = provider && (provider.name === "openrouter" ? getOpenRouterKeys()[0] : process.env[provider.key]);
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
    let activeProvider = provider;
    let activeKey = apiKey;
    let activeModel = model || process.env[provider.model] || provider.defaultModel;
    let result = await requestChat(activeProvider, activeKey, activeModel, messages);
    let { response, data } = result;
    if (!response.ok && provider.name === "openrouter") {
      const keys = getOpenRouterKeys();
      for (const backupKey of keys.slice(1)) {
        result = await requestChat(provider, backupKey, activeModel, messages);
        ({ response, data } = result);
        if (response.ok) {
          activeKey = backupKey;
          break;
        }
      }
    }
    const shouldFallback = provider.name === "openrouter" && !response.ok;
    const fallbackProvider = getConfiguredProvider("cloudflare");
    if (!response.ok && shouldFallback && fallbackProvider && process.env.CLOUDFLARE_ACCOUNT_ID) {
      activeProvider = fallbackProvider;
      activeKey = process.env[activeProvider.key];
      activeModel = process.env[activeProvider.model] || activeProvider.defaultModel;
      result = await requestChat(activeProvider, activeKey, activeModel, messages);
      ({ response, data } = result);
    }
    if (!response.ok) {
      const providerError = data.error?.message || data.errors?.[0]?.message || "AI provider উত্তর দিতে পারেনি।";
      return res.status(502).json({ error: `${activeProvider.name}: ${providerError}` });
    }
    const reply = result.reply || "কোনো উত্তর পাওয়া যায়নি।";
    return res.json({ reply, response: reply, mode: "live", provider: activeProvider.name, fallback: activeProvider.name !== provider.name });
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

app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "কোনো ফাইল পাওয়া যায়নি।" });
  const user = supabaseEnabled ? await requireSupabaseUser(req, res) : null;
  if (supabaseEnabled && !user) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return;
  }
  let extractedText = "";
  if (req.file.mimetype === "application/pdf") {
    try {
      extractedText = pdfParse(fs.readFileSync(req.file.path)).then((result) => result.text);
    } catch (error) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(422).json({ error: "PDF পড়া যাচ্ছে না।" });
    }
  }
  try {
    const text = extractedText && typeof extractedText.then === "function" ? await extractedText : "";
    const id = `${Date.now()}-${req.file.filename}`;
    if (supabaseEnabled) {
      const objectPath = `${user.id}/${id}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const storageUrl = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(supabaseBucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
      const storageResponse = await fetch(storageUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${supabaseServiceRoleKey}`, apikey: supabaseServiceRoleKey, "Content-Type": req.file.mimetype, "x-upsert": "false" },
        body: fs.readFileSync(req.file.path)
      });
      if (!storageResponse.ok) throw new Error("Supabase Storage upload failed");
      const metadata = { id, user_id: user.id, name: req.file.originalname, size: req.file.size, storage_path: objectPath, uploaded_at: new Date().toISOString() };
      const dbResult = await supabaseRequest("/rest/v1/files", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(metadata) });
      if (!dbResult.response.ok) throw new Error("Supabase file metadata save failed");
      return res.json({ id, name: req.file.originalname, size: req.file.size, text, message: `${req.file.originalname} attach হয়েছে। এখন প্রশ্ন লিখে Send চাপুন।` });
    }
    const files = readFileIndex();
    files.push({ id: req.file.filename, name: req.file.originalname, size: req.file.size, uploadedAt: new Date().toISOString() });
    writeFileIndex(files);
    res.json({ id: req.file.filename, name: req.file.originalname, size: req.file.size, text, message: `${req.file.originalname} attach হয়েছে। এখন প্রশ্ন লিখে Send চাপুন।` });
  } catch (error) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(422).json({ error: `ফাইল সংরক্ষণ করা যায়নি: ${error.message}` });
  } finally {
    if (supabaseEnabled && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});
app.get("/api/files", async (req, res) => {
  if (!supabaseEnabled) return res.json({ files: readFileIndex().reverse() });
  const user = await requireSupabaseUser(req, res);
  if (!user) return;
  const result = await supabaseRequest(`/rest/v1/files?select=id,name,size,uploaded_at&user_id=eq.${encodeURIComponent(user.id)}&order=uploaded_at.desc`);
  if (!result.response.ok) return res.status(502).json({ error: "Cloud files load করা যায়নি।" });
  res.json({ files: result.data.map((item) => ({ id: item.id, name: item.name, size: item.size, uploadedAt: item.uploaded_at })) });
});
app.delete("/api/files/:id", async (req, res) => {
  if (supabaseEnabled) {
    const user = await requireSupabaseUser(req, res);
    if (!user) return;
    const fileResult = await supabaseRequest(`/rest/v1/files?select=storage_path&id=eq.${encodeURIComponent(req.params.id)}&user_id=eq.${encodeURIComponent(user.id)}`);
    const file = fileResult.data?.[0];
    if (!file) return res.status(404).json({ error: "ফাইল পাওয়া যায়নি।" });
    await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(supabaseBucket)}/${file.storage_path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${supabaseServiceRoleKey}`, apikey: supabaseServiceRoleKey }
    });
    const result = await supabaseRequest(`/rest/v1/files?id=eq.${encodeURIComponent(req.params.id)}&user_id=eq.${encodeURIComponent(user.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    if (!result.response.ok) return res.status(502).json({ error: "ফাইল delete করা যায়নি।" });
    return res.json({ ok: true });
  }
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
