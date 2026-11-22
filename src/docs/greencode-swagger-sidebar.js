/* GreenCode Swagger UI sidebar. This augments Swagger UI navigation only; all
 * operations, schemas, authorization and Try it out remain native Swagger UI. */
(() => {
  const NAV_GROUPS = [
    { title: "Começar", tags: ["Autenticação", "Saúde"] },
    { title: "Administração interna", tags: ["Usuários", "Organizações", "Contratos", "Parâmetros", "Auditoria"] },
    { title: "Parceiros e credenciais", tags: ["Parceiros", "API Keys"] },
    { title: "Integração externa", tags: ["API Pública", "Rastreabilidade"] },
    { title: "Indicadores e relatórios", tags: ["Análises", "Relatórios Assíncronos", "Relatórios"] },
    { title: "Operação", tags: ["Lotes", "Equipamentos", "Movimentações"] },
  ];
  const METHOD_NAMES = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
  let refreshQueued = false;
  let currentTheme = "light";
  const THEME_STORAGE_KEY = "greencode-swagger-theme";

  function applyTheme(theme, persist = false) {
    currentTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-gc-theme", currentTheme);
    document.documentElement.style.colorScheme = currentTheme;
    const control = document.querySelector("#gc-theme-toggle");
    if (control) {
      const icon = control.querySelector(".gc-theme-icon");
      const label = control.querySelector(".gc-theme-label");
      const nextTheme = currentTheme === "light" ? "escuro" : "claro";
      if (icon) icon.textContent = currentTheme === "light" ? "☀" : "☾";
      if (label) label.textContent = currentTheme === "light" ? "Tema claro" : "Tema escuro";
      control.setAttribute("aria-label", `Tema atual ${currentTheme === "light" ? "claro" : "escuro"}. Alternar para tema ${nextTheme}.`);
      control.setAttribute("aria-pressed", String(currentTheme === "dark"));
      control.title = `Alternar para tema ${nextTheme}`;
    }
    if (persist) {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
      } catch {
        // Preferência não persistível não deve impedir o uso do Swagger.
      }
    }
  }

  function initializeTheme() {
    let storedTheme = null;
    try {
      storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Primeira visita e storage indisponível usam Light como padrão.
    }
    applyTheme(storedTheme === "dark" ? "dark" : "light");
  }

  const slug = (value) => String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  function ensureShell() {
    const root = document.querySelector("#swagger-ui");
    if (!root || document.querySelector("#gc-doc-sidebar")) return;

    const sidebar = document.createElement("aside");
    sidebar.id = "gc-doc-sidebar";
    sidebar.className = "gc-doc-sidebar";
    sidebar.setAttribute("aria-label", "Navegação da documentação");
    sidebar.innerHTML = `
      <div class="gc-sidebar-brand">
        <span class="gc-brand-mark" aria-hidden="true">G</span>
        <span><strong>GreenCode</strong><small>Referência da API · AV3</small></span>
      </div>
      <button class="gc-theme-toggle" id="gc-theme-toggle" type="button" aria-label="Alternar tema" aria-pressed="false">
        <span class="gc-theme-icon" aria-hidden="true">☀</span>
        <span class="gc-theme-label">Tema claro</span>
      </button>
      <p class="gc-sidebar-caption">DOCUMENTAÇÃO</p>
      <nav class="gc-sidebar-nav" aria-label="Grupos de operações"></nav>
      <div class="gc-sidebar-footer"><span class="gc-status-dot"></span> API REST · OpenAPI</div>`;
    document.body.appendChild(sidebar);
    const themeToggle = sidebar.querySelector("#gc-theme-toggle");
    if (themeToggle) {
      themeToggle.addEventListener("click", () => {
        applyTheme(currentTheme === "light" ? "dark" : "light", true);
      });
    }
    applyTheme(currentTheme);

    const overlay = document.createElement("button");
    overlay.type = "button";
    overlay.id = "gc-sidebar-overlay";
    overlay.className = "gc-sidebar-overlay";
    overlay.setAttribute("aria-label", "Fechar navegação");
    overlay.addEventListener("click", closeMobileSidebar);
    document.body.appendChild(overlay);

    const topbar = document.querySelector(".swagger-ui .topbar .wrapper");
    if (topbar && !document.querySelector("#gc-sidebar-toggle")) {
      const toggle = document.createElement("button");
      toggle.id = "gc-sidebar-toggle";
      toggle.className = "gc-sidebar-toggle";
      toggle.type = "button";
      toggle.textContent = "☰";
      toggle.setAttribute("aria-label", "Abrir ou recolher navegação");
      toggle.setAttribute("aria-expanded", "true");
      toggle.addEventListener("click", toggleSidebar);
      topbar.prepend(toggle);
    }
  }

  function closeMobileSidebar() {
    document.body.classList.remove("gc-sidebar-mobile-open");
    const toggle = document.querySelector("#gc-sidebar-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  function toggleSidebar() {
    const mobile = window.matchMedia("(max-width: 900px)").matches;
    if (mobile) {
      document.body.classList.toggle("gc-sidebar-mobile-open");
      const expanded = document.body.classList.contains("gc-sidebar-mobile-open");
      const toggle = document.querySelector("#gc-sidebar-toggle");
      if (toggle) toggle.setAttribute("aria-expanded", String(expanded));
      return;
    }
    document.body.classList.toggle("gc-sidebar-collapsed");
    const expanded = !document.body.classList.contains("gc-sidebar-collapsed");
    const toggle = document.querySelector("#gc-sidebar-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", String(expanded));
  }

  function textForTag(tagElement) {
    const copy = tagElement.cloneNode(true);
    copy.querySelectorAll("small, svg, .arrow").forEach((node) => node.remove());
    return copy.textContent.trim().replace(/\s+/g, " ");
  }

  function tagSections() {
    return Array.from(document.querySelectorAll(".swagger-ui .opblock-tag-section"));
  }

  function buildSidebar() {
    ensureShell();
    const nav = document.querySelector("#gc-doc-sidebar .gc-sidebar-nav");
    if (!nav) return;

    const sections = tagSections();
    if (!sections.length) return;

    const discovered = new Map();
    sections.forEach((section) => {
      const tag = section.querySelector(":scope > .opblock-tag") || section.querySelector(".opblock-tag");
      if (!tag) return;
      const title = textForTag(tag);
      if (!title) return;
      const id = `gc-tag-${slug(title)}`;
      section.id = id;
      discovered.set(title, { title, id, section, tag });
    });

    nav.replaceChildren();
    NAV_GROUPS.forEach((group) => {
      const entries = group.tags.map((name) => discovered.get(name)).filter(Boolean);
      if (!entries.length) return;
      const block = document.createElement("section");
      block.className = "gc-sidebar-group";
      const heading = document.createElement("h2");
      heading.textContent = group.title;
      block.appendChild(heading);
      const list = document.createElement("ul");
      entries.forEach((entry) => {
        const item = document.createElement("li");
        const link = document.createElement("button");
        link.type = "button";
        link.className = "gc-sidebar-tag";
        link.textContent = entry.title;
        link.addEventListener("click", () => {
          entry.section.scrollIntoView({ behavior: "smooth", block: "start" });
          const expanded = entry.tag.getAttribute("aria-expanded");
          if (expanded === "false") entry.tag.click();
          closeMobileSidebar();
        });
        item.appendChild(link);
        const operations = Array.from(entry.section.querySelectorAll(".opblock"));
        if (operations.length) {
          const operationList = document.createElement("ul");
          operationList.className = "gc-sidebar-operations";
          operations.forEach((operation) => {
            const summary = operation.querySelector(".opblock-summary");
            const methodNode = operation.querySelector(".opblock-summary-method");
            const pathNode = operation.querySelector(".opblock-summary-path");
            if (!summary || !methodNode || !pathNode) return;
            const method = methodNode.textContent.trim().toUpperCase();
            if (!METHOD_NAMES.has(method)) return;
            const row = document.createElement("li");
            const operationButton = document.createElement("button");
            operationButton.type = "button";
            operationButton.className = "gc-sidebar-operation";
            const badge = document.createElement("span");
            badge.className = `gc-method gc-method-${method.toLowerCase()}`;
            badge.textContent = method;
            const path = document.createElement("span");
            path.className = "gc-operation-path";
            path.textContent = pathNode.textContent.trim();
            operationButton.append(badge, path);
            operationButton.addEventListener("click", () => {
              operation.scrollIntoView({ behavior: "smooth", block: "start" });
              if (!operation.classList.contains("is-open")) summary.click();
              closeMobileSidebar();
            });
            row.appendChild(operationButton);
            operationList.appendChild(row);
          });
          item.appendChild(operationList);
        }
        list.appendChild(item);
      });
      block.appendChild(list);
      nav.appendChild(block);
    });

    const ungrouped = Array.from(discovered.values()).filter((entry) => !NAV_GROUPS.some((group) => group.tags.includes(entry.title)));
    if (ungrouped.length) {
      const block = document.createElement("section");
      block.className = "gc-sidebar-group";
      const heading = document.createElement("h2");
      heading.textContent = "Outros recursos";
      block.appendChild(heading);
      const list = document.createElement("ul");
      ungrouped.forEach((entry) => {
        const item = document.createElement("li");
        const link = document.createElement("button");
        link.className = "gc-sidebar-tag";
        link.type = "button";
        link.textContent = entry.title;
        link.addEventListener("click", () => entry.section.scrollIntoView({ behavior: "smooth", block: "start" }));
        item.appendChild(link);
        list.appendChild(item);
      });
      block.appendChild(list);
      nav.appendChild(block);
    }
  }

  function scheduleBuild() {
    if (refreshQueued) return;
    refreshQueued = true;
    window.requestAnimationFrame(() => {
      refreshQueued = false;
      buildSidebar();
    });
  }

  function start() {
    initializeTheme();
    const root = document.querySelector("#swagger-ui");
    if (!root) {
      window.setTimeout(start, 100);
      return;
    }
    ensureShell();
    const observer = new MutationObserver(scheduleBuild);
    observer.observe(root, { childList: true, subtree: true });
    scheduleBuild();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
