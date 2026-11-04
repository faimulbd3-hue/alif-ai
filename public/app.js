const $ = (selector) => document.querySelector(selector);
const messages = $("#messages");
const welcome = $("#welcome");
const input = $("#messageInput");
const chatHistory = $("#chatHistory");
let history = JSON.parse(localStorage.getItem("alif-history") || "[]");

function toast(text) {
  const node = $("#toast"); node.textContent = text; node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 2800);
}
function saveHistory() { localStorage.setItem("alif-history", JSON.stringify(history)); renderHistory(); }
function renderHistory() {
  chatHistory.innerHTML = history.slice(-8).reverse().map((item, index) => `<button class="chat-item ${index === 0 ? "active" : ""}"><span>✦</span>${item.title}</button>`).join("");
}
function addMessage(role, text) {
  welcome.style.display = "none"; messages.style.display = "flex";
  const node = document.createElement("div"); node.className = `message ${role}`;
  node.innerHTML = `<div class="message-avatar">${role === "user" ? "F" : "A"}</div><div class="message-bubble"></div>`;
  node.querySelector(".message-bubble").textContent = text; messages.appendChild(node);
  $(".conversation").scrollTop = $(".conversation").scrollHeight;
}
function showGenerating() {
  const node = document.createElement("div");
  node.className = "message assistant generating";
  node.innerHTML = `<div class="message-avatar">A</div><div class="message-bubble"><span class="loading-dots"></span> Generating answer, please wait...</div>`;
  messages.appendChild(node);
  $(".conversation").scrollTop = $(".conversation").scrollHeight;
}
function hideGenerating() {
  const node = messages.querySelector(".generating");
  if (node) node.remove();
}
async function sendMessage(text) {
  const message = (text || input.value).trim(); if (!message) return;
  input.value = ""; input.style.height = "auto"; addMessage("user", message);
  history.push({ title: message.slice(0, 38), messages: [{ role: "user", content: message }] }); saveHistory();
  const button = $(".send-button"); button.disabled = true; button.textContent = "…";
  showGenerating();
  try {
    const context = history.flatMap((item) => item.messages || []).slice(-12);
    const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, history: context }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Server error (${response.status})`);
    hideGenerating(); addMessage("assistant", data.reply || "কোনো উত্তর পাওয়া যায়নি।"); if (data.mode === "demo") toast("Demo mode — API key যোগ করুন");
  } catch (error) { hideGenerating(); addMessage("assistant", `দুঃখিত, ${error.message}`); toast("সংযোগে সমস্যা হয়েছে"); }
  finally { button.disabled = false; button.textContent = "↑"; }
}
$("#chatForm").addEventListener("submit", (event) => { event.preventDefault(); sendMessage(); });
input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; });
document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => sendMessage(button.dataset.prompt)));
$("#newChat").addEventListener("click", () => { messages.innerHTML = ""; messages.style.display = "none"; welcome.style.display = "block"; input.focus(); });
$("#themeToggle").addEventListener("click", () => { document.body.classList.toggle("dark"); localStorage.setItem("alif-theme", document.body.classList.contains("dark") ? "dark" : "light"); });
if (localStorage.getItem("alif-theme") === "dark") document.body.classList.add("dark");
$("#menuToggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#searchButton").addEventListener("click", () => toast("Web Search tool শিগগিরই আসছে"));
$("#voiceButton").addEventListener("click", () => { if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) return toast("এই browser-এ voice input নেই"); toast("বলুন, Alif AI শুনছে…"); });
$("#fileButton").addEventListener("click", () => $("#fileInput").click());
$("#fileInput").addEventListener("change", async (event) => {
  const file = event.target.files[0]; if (!file) return;
  const data = new FormData(); data.append("file", file);
  try { const response = await fetch("/api/upload", { method: "POST", body: data }); const result = await response.json(); if (!response.ok) throw new Error(result.error); toast(result.message); }
  catch (error) { toast(error.message); }
});
renderHistory();
