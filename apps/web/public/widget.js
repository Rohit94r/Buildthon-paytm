/*! LayerFlow Assistant widget — drop-in AI comparison / Q&A chat for any website.
 *
 *  <script src="https://YOUR-LAYERFLOW-DOMAIN/widget.js"
 *          data-key="lf_pk_..."            (required, API key with the assistant:chat scope)
 *          data-dataset="colleges"         (dataset slug)  — or —  data-assistant="<agent id>"
 *          data-title="Compare colleges"   (optional)
 *          data-color="#2563eb"            (optional brand colour)
 *          data-position="right"           (optional: right | left)
 *          data-greeting="Hi! Ask me..."   (optional)
 *          data-inline="#element-id"       (optional: render inline inside an element instead of a floating bubble)
 *          defer></script>
 *
 *  No dependencies. Renders inside a Shadow DOM so the host site's CSS cannot break it (and vice versa).
 *  Talks only to POST {origin}/api/public/v1/chat.
 */
(function () {
  "use strict";
  var script = document.currentScript || (function () {
    var all = document.querySelectorAll("script[data-key]");
    return all[all.length - 1];
  })();
  if (!script) return;

  var ds = script.dataset;
  var cfg = {
    key: ds.key || "",
    dataset: ds.dataset || "",
    assistant: ds.assistant || "",
    title: ds.title || "Ask & compare",
    color: /^#[0-9a-f]{3,8}$/i.test(ds.color || "") ? ds.color : "#2563eb",
    position: ds.position === "left" ? "left" : "right",
    greeting: ds.greeting || "Hi! Ask me anything — or compare two options side by side.",
    inline: ds.inline || "",
    api: (ds.api || new URL(script.src, location.href).origin).replace(/\/$/, ""),
  };
  if (!cfg.key) {
    console.warn("[LayerFlow] widget.js: data-key is required");
    return;
  }

  var history = [];
  var busy = false;

  /* ---------------- helpers ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Minimal, safe markdown: escape first, then **bold**, *italic*, `code`, lists, line breaks.
  function md(src) {
    var lines = esc(src).split(/\r?\n/);
    var out = [], list = null;
    lines.forEach(function (line) {
      var m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (m) {
        if (!list) { list = []; }
        list.push("<li>" + inline(m[1]) + "</li>");
        return;
      }
      if (list) { out.push("<ul>" + list.join("") + "</ul>"); list = null; }
      var h = line.match(/^#{1,4}\s+(.*)$/);
      if (h) out.push("<p><strong>" + inline(h[1]) + "</strong></p>");
      else if (line.trim()) out.push("<p>" + inline(line) + "</p>");
    });
    if (list) out.push("<ul>" + list.join("") + "</ul>");
    return out.join("");
  }
  function inline(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }
  function fmt(v, field) {
    if (v == null || v === "") return "—";
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "number") {
      var n = v.toLocaleString("en-IN");
      if (field && field.type === "currency") return (field.unit || "₹") + n;
      if (field && field.unit) return n + " " + field.unit;
      return n;
    }
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v);
  }

  /* ---------------- DOM ---------------- */
  var host = document.createElement("div");
  host.setAttribute("data-layerflow-widget", "");
  var mount = cfg.inline ? document.querySelector(cfg.inline) : null;
  (mount || document.body).appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  var side = cfg.position === "left" ? "left" : "right";
  var css = "" +
    ":host{all:initial}" +
    "*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}" +
    ".lf-bubble{position:fixed;bottom:20px;" + side + ":20px;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;background:" + cfg.color + ";color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;z-index:2147483000;transition:transform .15s}" +
    ".lf-bubble:hover{transform:scale(1.05)}" +
    ".lf-panel{position:fixed;bottom:88px;" + side + ":20px;width:min(400px,calc(100vw - 32px));height:min(600px,calc(100vh - 120px));background:#fff;color:#0f172a;border-radius:16px;box-shadow:0 20px 60px rgba(15,23,42,.25);display:none;flex-direction:column;overflow:hidden;z-index:2147483000;border:1px solid #e2e8f0}" +
    ".lf-panel.open{display:flex}" +
    ".lf-inline .lf-panel{position:static;display:flex;width:100%;height:560px;box-shadow:0 1px 3px rgba(15,23,42,.08)}" +
    ".lf-head{padding:14px 16px;background:" + cfg.color + ";color:#fff;display:flex;align-items:center;gap:10px}" +
    ".lf-head b{font-size:15px;font-weight:600;flex:1}" +
    ".lf-head small{display:block;font-size:11px;opacity:.85;font-weight:400}" +
    ".lf-x{background:transparent;border:0;color:#fff;cursor:pointer;font-size:20px;line-height:1;padding:4px}" +
    ".lf-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#f8fafc}" +
    ".lf-msg{max-width:92%;padding:10px 12px;border-radius:12px;font-size:13.5px;line-height:1.5;word-wrap:break-word}" +
    ".lf-msg p{margin:0 0 6px}.lf-msg p:last-child{margin:0}.lf-msg ul{margin:4px 0 6px;padding-left:18px}.lf-msg code{background:#eef2f7;padding:1px 4px;border-radius:4px;font-size:12px}" +
    ".lf-user{align-self:flex-end;background:" + cfg.color + ";color:#fff;border-bottom-right-radius:4px}" +
    ".lf-bot{align-self:flex-start;background:#fff;border:1px solid #e2e8f0;border-bottom-left-radius:4px}" +
    ".lf-err{align-self:center;color:#b91c1c;font-size:12px}" +
    ".lf-table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}" +
    ".lf-table th,.lf-table td{border-bottom:1px solid #e2e8f0;padding:6px;text-align:left;vertical-align:top}" +
    ".lf-table th{background:#f1f5f9;font-weight:600}" +
    ".lf-table td.win{background:#ecfdf5;color:#047857;font-weight:600}" +
    ".lf-scroll{overflow-x:auto;max-width:100%}" +
    ".lf-sugs{display:flex;flex-wrap:wrap;gap:6px}" +
    ".lf-sug{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:5px 10px;font-size:12px;cursor:pointer;color:#334155}" +
    ".lf-sug:hover{border-color:" + cfg.color + ";color:" + cfg.color + "}" +
    ".lf-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;background:#fff}" +
    ".lf-in{flex:1;border:1px solid #cbd5e1;border-radius:10px;padding:10px 12px;font-size:13.5px;outline:none;color:#0f172a;background:#fff}" +
    ".lf-in:focus{border-color:" + cfg.color + "}" +
    ".lf-send{border:0;border-radius:10px;padding:0 14px;background:" + cfg.color + ";color:#fff;font-weight:600;cursor:pointer;font-size:13px}" +
    ".lf-send:disabled{opacity:.5;cursor:default}" +
    ".lf-dots span{display:inline-block;width:6px;height:6px;margin:0 2px;border-radius:50%;background:#94a3b8;animation:lfb 1s infinite}" +
    ".lf-dots span:nth-child(2){animation-delay:.15s}.lf-dots span:nth-child(3){animation-delay:.3s}" +
    "@keyframes lfb{0%,80%,100%{opacity:.3}40%{opacity:1}}" +
    ".lf-foot{font-size:10.5px;color:#94a3b8;text-align:center;padding:4px 0 8px;background:#fff}" +
    "@media (prefers-color-scheme:dark){.lf-panel{background:#0f172a;color:#e2e8f0;border-color:#1e293b}.lf-body{background:#0b1220}.lf-bot{background:#111a2e;border-color:#1e293b;color:#e2e8f0}.lf-form,.lf-foot{background:#0f172a;border-color:#1e293b}.lf-in{background:#0b1220;border-color:#334155;color:#e2e8f0}.lf-table th{background:#1e293b}.lf-table th,.lf-table td{border-color:#1e293b}.lf-table td.win{background:#064e3b;color:#a7f3d0}.lf-sug{background:#111a2e;border-color:#334155;color:#cbd5e1}.lf-msg code{background:#1e293b}}";

  var chatIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  root.innerHTML =
    "<style>" + css + "</style>" +
    '<div class="' + (mount ? "lf-inline" : "") + '">' +
    (mount ? "" : '<button class="lf-bubble" type="button" aria-label="Open assistant">' + chatIcon + "</button>") +
    '<section class="lf-panel" role="dialog" aria-label="' + esc(cfg.title) + '">' +
    '<header class="lf-head"><b>' + esc(cfg.title) + "<small>AI answers from verified data</small></b>" +
    (mount ? "" : '<button class="lf-x" type="button" aria-label="Close">×</button>') + "</header>" +
    '<div class="lf-body" aria-live="polite"></div>' +
    '<form class="lf-form"><input class="lf-in" type="text" maxlength="500" placeholder="Ask or compare…" aria-label="Message" />' +
    '<button class="lf-send" type="submit">Send</button></form>' +
    '<div class="lf-foot">Powered by LayerFlow</div>' +
    "</section></div>";

  var panel = root.querySelector(".lf-panel");
  var body = root.querySelector(".lf-body");
  var form = root.querySelector(".lf-form");
  var input = root.querySelector(".lf-in");
  var send = root.querySelector(".lf-send");
  var bubble = root.querySelector(".lf-bubble");
  var closeBtn = root.querySelector(".lf-x");

  function toggle(open) {
    panel.classList.toggle("open", open);
    if (open) setTimeout(function () { input.focus(); }, 50);
  }
  if (bubble) bubble.addEventListener("click", function () { toggle(!panel.classList.contains("open")); });
  if (closeBtn) closeBtn.addEventListener("click", function () { toggle(false); });

  function add(cls, html) {
    var el = document.createElement("div");
    el.className = "lf-msg " + cls;
    el.innerHTML = html;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  function tableHtml(t) {
    if (!t || !t.rows || !t.rows.length || !t.fields) return "";
    var head = "<tr><th></th>" + t.rows.map(function (r) { return "<th>" + esc(r.key) + "</th>"; }).join("") + "</tr>";
    var rows = t.fields.map(function (f) {
      var winner = t.winners ? t.winners[f.key] : null;
      return "<tr><th>" + esc(f.label) + "</th>" + t.rows.map(function (r) {
        var win = winner && winner === r.key ? ' class="win"' : "";
        return "<td" + win + ">" + esc(fmt(r.values[f.key], f)) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    return '<div class="lf-scroll"><table class="lf-table">' + head + rows + "</table></div>";
  }

  function suggestions(list) {
    if (!list || !list.length) return;
    var wrap = document.createElement("div");
    wrap.className = "lf-sugs";
    list.slice(0, 3).forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "lf-sug";
      b.textContent = s;
      b.addEventListener("click", function () { wrap.remove(); ask(s); });
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
    body.scrollTop = body.scrollHeight;
  }

  function ask(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    busy = true;
    send.disabled = true;
    add("lf-user", esc(text));
    var typing = add("lf-bot", '<span class="lf-dots"><span></span><span></span><span></span></span>');
    var payload = { message: text, history: history.slice(-8) };
    if (cfg.assistant) payload.assistant_id = cfg.assistant;
    if (cfg.dataset) payload.dataset = cfg.dataset;
    fetch(cfg.api + "/api/public/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": cfg.key },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) throw new Error((d && d.error && d.error.message) || "Request failed (" + r.status + ")");
          return d;
        });
      })
      .then(function (d) {
        typing.innerHTML = md(d.answer || "") + tableHtml(d.table);
        history.push({ role: "user", content: text }, { role: "assistant", content: d.answer || "" });
        suggestions(d.suggestions);
      })
      .catch(function (e) {
        typing.remove();
        var el = document.createElement("div");
        el.className = "lf-err";
        el.textContent = e.message || "Something went wrong. Please try again.";
        body.appendChild(el);
      })
      .then(function () {
        busy = false;
        send.disabled = false;
        body.scrollTop = body.scrollHeight;
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var v = input.value;
    input.value = "";
    ask(v);
  });

  add("lf-bot", md(cfg.greeting));

  // Public API for host pages: window.LayerFlow.open() / .close() / .ask("…")
  window.LayerFlow = {
    open: function () { toggle(true); },
    close: function () { toggle(false); },
    ask: function (q) { toggle(true); ask(q); },
  };
})();
