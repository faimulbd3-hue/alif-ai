const $ = (selector) => document.querySelector(selector);
const messages = $("#messages");
const welcome = $("#welcome");
const input = $("#messageInput");
const chatHistory = $("#chatHistory");
const filesPanel = $("#filesPanel");
let history = JSON.parse(localStorage.getItem("alif-history") || "[]");
let activeTool = "assistant";
let selectedFile = null;
let isAuthMode = false;
let authToken = localStorage.getItem("alif-access-token") || "";
let activeChatIndex = null;
const apiHeaders = () => authToken ? { Authorization: `Bearer ${authToken}` } : {};

function toast(text) {
  const node = $("#toast"); node.textContent = text; node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 2800);
}
function createParticles() {
  const field = $("#particleField");
  if (!field) return;
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 22; index += 1) {
    const particle = document.createElement("i");
    particle.style.setProperty("--x", `${Math.random() * 100}%`);
    particle.style.setProperty("--y", `${Math.random() * 100}%`);
    particle.style.setProperty("--size", `${Math.random() * 3 + 1}px`);
    particle.style.setProperty("--delay", `${Math.random() * -12}s`);
    particle.style.setProperty("--duration", `${Math.random() * 8 + 10}s`);
    fragment.appendChild(particle);
  }
  field.appendChild(fragment);
}
function openModal(id) { const modal = $(`#${id}`); modal.hidden = false; modal.querySelector("input")?.focus(); }
function closeModal(id) { $(`#${id}`).hidden = true; }
async function updateProfile() {
  let user = null;
  if (authToken) {
    const response = await fetch("/api/auth/me", { headers: apiHeaders() });
    if (response.ok) user = (await response.json()).user;
    else { authToken = ""; localStorage.removeItem("alif-access-token"); }
  }
  $("#profileName").textContent = user?.user_metadata?.name || user?.email?.split("@")[0] || "Guest";
  $("#profilePlan").textContent = user ? "Free plan" : "Not signed in";
  document.querySelector('[data-profile-action="login"]').hidden = Boolean(user);
  document.querySelector('[data-profile-action="logout"]').hidden = !user;
  return user;
}
function showAuth(mode = "login") {
  isAuthMode = mode === "login";
  $("#authTitle").textContent = isAuthMode ? "Sign in to Alif AI" : "Create your Alif AI account";
  $("#authSubtitle").textContent = isAuthMode ? "Sign in securely with your Supabase account." : "Create a secure Alif AI account.";
  $("#authName").hidden = isAuthMode;
  $("#authName").required = !isAuthMode;
  $("#authForm button[type=submit]").textContent = isAuthMode ? "Sign in" : "Create account";
  $("#authSwitch").textContent = isAuthMode ? "New here? Create an account" : "Already have an account? Sign in";
  openModal("authModal");
}
function saveHistory() {
  localStorage.setItem("alif-history", JSON.stringify(history));
  renderHistory();
  if (authToken) fetch("/api/history", {
    method: "POST", headers: { ...apiHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ history })
  }).catch(() => toast("Cloud history sync হয়নি"));
}
async function loadCloudHistory() {
  if (!authToken) return;
  const response = await fetch("/api/history", { headers: apiHeaders() });
  if (!response.ok) return;
  const data = await response.json();
  if (Array.isArray(data.history) && data.history.length) {
    history = data.history;
    activeChatIndex = history.length - 1;
    localStorage.setItem("alif-history", JSON.stringify(history));
    activeChatIndex = history.length ? history.length - 1 : null;
    renderHistory();
  }
}
function renderHistory() {
  chatHistory.innerHTML = history.slice(-8).reverse().map((item) => {
    const index = history.indexOf(item);
    return `<div class="chat-item" data-history-index="${index}"><button class="chat-open"><span>✦</span>${escapeHtml(item.title)}</button><button class="chat-delete" aria-label="Delete chat" title="Delete chat">×</button></div>`;
  }).join("");
}
function startChat() {
  activeChatIndex = null;
  messages.innerHTML = "";
  messages.style.display = "none";
  welcome.style.display = "block";
  input.focus();
}
function ensureActiveChat(title) {
  if (activeChatIndex !== null && history[activeChatIndex]) return history[activeChatIndex];
  const chat = { title: title.slice(0, 38), messages: [] };
  history.push(chat);
  activeChatIndex = history.length - 1;
  return chat;
}
function loadChat(index) {
  const chat = history[index];
  if (!chat) return;
  activeChatIndex = index;
  messages.innerHTML = "";
  welcome.style.display = "none";
  messages.style.display = "flex";
  chat.messages.forEach((item) => addMessage(item.role === "assistant" ? "assistant" : "user", item.content));
  chatHistory.querySelectorAll(".chat-item").forEach((item) => item.classList.toggle("active", Number(item.dataset.historyIndex) === index));
}
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}
function renderReply(text) {
  const codeBlocks = [];
  const source = /^\s*<!doctype html[\s>]|^\s*<html[\s>]/i.test(text) && !text.includes("```")
    ? `\`\`\`html\n${text.trim()}\n\`\`\``
    : text;
  const withoutCode = source.replace(/```([^\r\n`]*)\r?\n?([\s\S]*?)```/g, (_match, language, code) => {
    const id = `code-${codeBlocks.length}`;
    codeBlocks.push({ id, language: language.trim().toLowerCase(), code: code.trim() });
    return `\u0000${id}\u0000`;
  });
  return withoutCode.split(/\u0000(code-\d+)\u0000/).map((part) => {
    const block = codeBlocks.find((item) => item.id === part);
    if (!block) return escapeHtml(part).replace(/\n/g, "<br>");
    const preview = block.language === "html" ? `<button class="code-action preview-code" data-code-id="${block.id}">Preview</button>` : "";
    return `<div class="code-box"><div class="code-toolbar"><span>${block.language || "code"}</span><div>${preview}<button class="code-action copy-code" data-code-id="${block.id}">Copy</button></div></div><pre><code>${escapeHtml(block.code)}</code></pre></div>`;
  }).join("");
}
function addMessage(role, text) {
  welcome.style.display = "none"; messages.style.display = "flex";
  const node = document.createElement("div"); node.className = `message ${role} message-enter`;
  node.innerHTML = `<div class="message-avatar">${role === "user" ? "F" : "A"}</div><div class="message-bubble"></div>`;
  const bubble = node.querySelector(".message-bubble");
  if (role === "assistant") {
    bubble.innerHTML = renderReply(text);
    bubble.querySelectorAll(".copy-code").forEach((button) => button.addEventListener("click", async () => {
      const code = bubble.querySelectorAll(".code-box")[Number(button.dataset.codeId.split("-")[1])]?.querySelector("code")?.textContent || "";
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        const area = document.createElement("textarea");
        area.value = code; document.body.appendChild(area); area.select();
        document.execCommand("copy"); area.remove();
      }
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = "Copy"; }, 1600);
    }));
    bubble.querySelectorAll(".preview-code").forEach((button) => button.addEventListener("click", () => {
      const code = bubble.querySelectorAll(".code-box")[Number(button.dataset.codeId.split("-")[1])]?.querySelector("code")?.textContent || "";
      const previewUrl = URL.createObjectURL(new Blob([code], { type: "text/html" }));
      const preview = document.createElement("a");
      preview.href = previewUrl;
      preview.target = "_blank";
      preview.rel = "noopener";
      preview.click();
      setTimeout(() => URL.revokeObjectURL(previewUrl), 60000);
    }));
  } else bubble.textContent = text;
  messages.appendChild(node);
  $(".conversation").scrollTop = $(".conversation").scrollHeight;
}
function showGenerating() {
  const node = document.createElement("div");
  node.className = "message assistant generating message-enter";
  node.innerHTML = `<div class="message-avatar">A</div><div class="message-bubble skeleton-bubble"><span class="loading-dots"></span><span class="skeleton-line"></span><span class="skeleton-line short"></span></div>`;
  messages.appendChild(node);
  $(".conversation").scrollTop = $(".conversation").scrollHeight;
}
function hideGenerating() {
  const node = messages.querySelector(".generating");
  if (node) node.remove();
}
async function loadFiles() {
  filesPanel.hidden = false;
  filesPanel.innerHTML = `<div class="files-title"><strong>Files & Documents</strong><button class="file-refresh">Refresh</button></div><input class="file-search" placeholder="Search uploaded files..." /><div class="file-list">Loading files...</div>`;
  try {
    const response = await fetch("/api/files", { headers: apiHeaders() });
    const data = await response.json();
    const render = (filter = "") => {
      const files = data.files.filter((file) => file.name.toLowerCase().includes(filter.toLowerCase()));
      filesPanel.querySelector(".file-list").innerHTML = files.length ? files.map((file) => `<div class="file-row"><span>▣</span><div><b>${escapeHtml(file.name)}</b><small>${Math.ceil(file.size / 1024)} KB</small></div><button class="file-delete" data-file-id="${file.id}">×</button></div>`).join("") : "<p class=\"empty-files\">কোনো file পাওয়া যায়নি।</p>";
    };
    render();
    filesPanel.querySelector(".file-search").addEventListener("input", (event) => render(event.target.value));
    filesPanel.querySelector(".file-refresh").addEventListener("click", loadFiles);
    filesPanel.querySelectorAll(".file-delete").forEach((button) => button.addEventListener("click", async () => {
      await fetch(`/api/files/${encodeURIComponent(button.dataset.fileId)}`, { method: "DELETE", headers: apiHeaders() });
      loadFiles();
    }));
  } catch (error) { filesPanel.querySelector(".file-list").textContent = `ফাইল লোড করা যায়নি: ${error.message}`; }
}
async function searchWeb(query) {
  showGenerating();
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Server error (${response.status})`);
    const lines = [`Search results for: ${data.query}`];
    if (data.answer) lines.push(`\n${data.answer}${data.source ? `\nSource: ${data.source}` : ""}`);
    if (data.results?.length) {
      lines.push("\nRelated results:");
      data.results.forEach((result, index) => lines.push(`${index + 1}. ${result.text}${result.url ? `\n   ${result.url}` : ""}`));
    }
    if (lines.length === 1) lines.push("\nNo instant results found. Try a more specific query.");
    hideGenerating();
    addMessage("assistant", lines.join("\n"));
  } catch (error) {
    hideGenerating();
    addMessage("assistant", `দুঃখিত, ${error.message}`);
  }
}
async function sendMessage(text) {
  const message = (text || input.value).trim(); if (!message && !selectedFile) return;
  if (selectedFile) {
    const fileToUpload = selectedFile;
    try {
      const uploadData = new FormData();
      uploadData.append("file", fileToUpload);
      const uploadResponse = await fetch("/api/upload", { method: "POST", headers: apiHeaders(), body: uploadData });
      const uploadResult = await uploadResponse.json();
      if (!uploadResponse.ok) throw new Error(uploadResult.error || "ফাইল upload হয়নি।");
      selectedFile = null;
      $("#attachmentPreview").hidden = true;
      $("#attachmentPreview").innerHTML = "";
      input.value = "";
      input.style.height = "auto";
      const question = message || `এই ফাইলটি সংক্ষেপে বিশ্লেষণ করো: ${uploadResult.name}`;
      const attachmentMessage = `📎 ${uploadResult.name}\n${Math.ceil(uploadResult.size / 1024)} KB\n\n${question}`;
      const chat = ensureActiveChat(question);
      const context = chat.messages.slice(-12);
      chat.messages.push({ role: "user", content: attachmentMessage });
      addMessage("user", attachmentMessage);
      saveHistory();
      showGenerating();
      const chatResponse = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, history: context, attachment: { name: uploadResult.name, text: uploadResult.text || "" } })
      });
      const chatResult = await chatResponse.json().catch(() => ({}));
      if (!chatResponse.ok) throw new Error(chatResult.error || "ফাইল বিশ্লেষণ করা যায়নি।");
      const reply = chatResult.reply || chatResult.response || "ফাইল থেকে কোনো উত্তর পাওয়া যায়নি।";
      chat.messages.push({ role: "assistant", content: reply });
      saveHistory();
      hideGenerating();
      addMessage("assistant", reply);
      toast(`${uploadResult.name} বিশ্লেষণ করা হয়েছে`);
      return;
    } catch (error) {
      toast(error.message);
      return;
    }
  }
  input.value = ""; input.style.height = "auto"; addMessage("user", message);
  if (activeTool === "search") return searchWeb(message);
  const chat = ensureActiveChat(message);
  const context = chat.messages.slice(-12);
  chat.messages.push({ role: "user", content: message });
  saveHistory();
  const button = $(".send-button"); button.disabled = true; button.textContent = "…";
  showGenerating();
  try {
    const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, history: context }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Server error (${response.status})`);
    const reply = data.reply || data.response || "কোনো উত্তর পাওয়া যায়নি।";
    chat.messages.push({ role: "assistant", content: reply });
    saveHistory();
    hideGenerating(); addMessage("assistant", reply);
    if (data.fallback) toast("OpenRouter limit শেষ — Cloudflare Workers AI ব্যবহার করা হয়েছে");
    else if (data.mode === "demo") toast("Demo mode — API key যোগ করুন");
  } catch (error) { hideGenerating(); addMessage("assistant", `দুঃখিত, ${error.message}`); toast("সংযোগে সমস্যা হয়েছে"); }
  finally { button.disabled = false; button.textContent = "↑"; }
}
$("#chatForm").addEventListener("submit", (event) => { event.preventDefault(); sendMessage(); });
input.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (!event.repeat) sendMessage();
});
input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; });
document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => sendMessage(button.dataset.prompt)));
$("#newChat").addEventListener("click", startChat);
chatHistory.addEventListener("click", (event) => {
  const item = event.target.closest(".chat-item");
  if (!item) return;
  const index = Number(item.dataset.historyIndex);
  if (event.target.closest(".chat-delete")) {
    history.splice(index, 1);
    if (activeChatIndex === index) startChat();
    else if (activeChatIndex !== null && activeChatIndex > index) activeChatIndex -= 1;
    saveHistory();
    return;
  }
  if (event.target.closest(".chat-open")) loadChat(index);
});
document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  const tool = button.dataset.tool;
  activeTool = tool;
  if (tool === "files") return loadFiles();
  if (tool === "coding") {
    input.placeholder = "Describe the code or bug you want help with...";
    input.value = "Help me debug this code step by step: ";
    input.focus();
    return;
  }
  if (tool === "search") {
    input.placeholder = "What would you like to search?";
    input.focus();
    toast("Search mode selected — type your question");
    return;
  }
  input.placeholder = "Message Alif AI...";
  input.focus();
}));
$("#themeToggle").addEventListener("click", () => { document.body.classList.toggle("dark"); localStorage.setItem("alif-theme", document.body.classList.contains("dark") ? "dark" : "light"); });
if (localStorage.getItem("alif-theme") === "dark") document.body.classList.add("dark");
const sidebar = $("#sidebar");
const closeSidebar = () => {
  sidebar.classList.remove("open");
  closeProfileMenu();
};
$("#menuToggle").addEventListener("click", () => sidebar.classList.toggle("open"));
$("#sidebarOverlay").addEventListener("click", closeSidebar);
document.querySelectorAll(".nav-link, .new-chat, .chat-open").forEach((button) => button.addEventListener("click", closeSidebar));
const profileButton = $("#profileButton");
const profileMenu = $("#profileMenu");
const setProfileMenu = (open) => {
  profileMenu.hidden = false;
  profileMenu.setAttribute("aria-hidden", String(!open));
  profileMenu.dataset.open = String(open);
  profileMenu.classList.toggle("open", open);
  profileButton.setAttribute("aria-expanded", String(open));
};
const closeProfileMenu = () => {
  setProfileMenu(false);
};
setProfileMenu(false);
profileButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const shouldOpen = profileMenu.getAttribute("aria-hidden") !== "false";
  setProfileMenu(shouldOpen);
});
$("#profileMenuClose").addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  closeProfileMenu();
});
profileMenu.addEventListener("click", (event) => {
  const action = event.target.closest("[data-profile-action]")?.dataset.profileAction;
  if (!action) return;
  if (action === "theme") $("#themeToggle").click();
  if (action === "login") showAuth("login");
  if (action === "settings") {
    $("#settingsTheme").checked = document.body.classList.contains("dark");
    openModal("settingsModal");
  }
  if (action === "logout") {
    authToken = "";
    localStorage.removeItem("alif-access-token");
    updateProfile();
    toast("আপনি sign out করেছেন");
  }
  closeProfileMenu();
});
$("#authForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const email = $("#authEmail").value.trim();
  const password = $("#authPassword").value;
  const endpoint = isAuthMode ? "/api/auth/login" : "/api/auth/signup";
  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: $("#authName").value.trim() })
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Authentication failed");
    if (!data.session?.access_token) {
      closeModal("authModal");
      $("#authForm").reset();
      return toast(data.message || "Account তৈরি হয়েছে। Email verify করে sign in করুন।");
    }
    authToken = data.session.access_token;
    localStorage.setItem("alif-access-token", authToken);
    await updateProfile();
    await loadCloudHistory();
    closeModal("authModal");
    $("#authForm").reset();
    toast(isAuthMode ? "Sign in সফল হয়েছে" : "Account তৈরি হয়েছে");
  }).catch((error) => toast(error.message));
});
$("#authSwitch").addEventListener("click", () => showAuth(isAuthMode ? "register" : "login"));
document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.closeModal)));
document.querySelectorAll(".modal-backdrop").forEach((modal) => modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(modal.id); }));
$("#settingsTheme").addEventListener("change", (event) => {
  document.body.classList.toggle("dark", event.target.checked);
  localStorage.setItem("alif-theme", event.target.checked ? "dark" : "light");
});
$("#clearHistory").addEventListener("click", async () => {
  history = []; saveHistory();
  if (authToken) await fetch("/api/history", { method: "DELETE", headers: apiHeaders() });
  messages.innerHTML = ""; messages.style.display = "none"; welcome.style.display = "block"; toast("Chat history cleared");
});
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".profile-wrap")) closeProfileMenu();
}, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSidebar();
    closeProfileMenu();
    closeModal("authModal");
    closeModal("settingsModal");
  }
});
$("#searchButton").addEventListener("click", () => {
  activeTool = "search";
  input.placeholder = "What would you like to search?";
  input.focus();
  toast("Search mode selected — type your question");
});
$("#voiceButton").addEventListener("click", () => { if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) return toast("এই browser-এ voice input নেই"); toast("বলুন, Alif AI শুনছে…"); });
$("#fileButton").addEventListener("click", () => $("#fileInput").click());
$("#fileInput").addEventListener("change", (event) => {
  const file = event.target.files[0]; if (!file) return;
  selectedFile = file;
  const preview = $("#attachmentPreview");
  preview.hidden = false;
  preview.innerHTML = `<span>📎</span><strong>${escapeHtml(file.name)}</strong><small>${Math.ceil(file.size / 1024)} KB</small><button type="button" class="remove-attachment" aria-label="Remove attachment">×</button>`;
  preview.querySelector(".remove-attachment").addEventListener("click", () => {
    selectedFile = null;
    preview.hidden = true;
    preview.innerHTML = "";
    $("#fileInput").value = "";
  });
  input.focus();
});
createParticles();
document.body.classList.add("page-ready");
renderHistory();
updateProfile().then(loadCloudHistory);
