import { ANGLES, MAX_BATCH, buildGroups, filterItems, groupKey, listEntries, readLocal, writeLocal } from "./store.js";

function el(tag, cls = "", text = "") {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
}
function button(text, action, cls = "") {
    const node = el("button", `pg-button ${cls}`, text);
    node.type = "button";
    node.addEventListener("click", action);
    return node;
}
function options(select, values, allLabel) {
    select.replaceChildren();
    if (allLabel) select.add(new Option(allLabel, ""));
    for (const value of values) select.add(new Option(value, value));
}
function field(label, input) {
    const node = el("label", "pg-field");
    node.append(el("span", "pg-label", label), input);
    return node;
}
function imageNode(url, alt, cls = "") {
    const image = el("img", cls);
    image.src = url;
    image.alt = alt;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => {
        image.classList.add("pg-image-missing");
        image.alt = "Imagem ausente; verifique o diretório do acervo";
    });
    return image;
}
function dialogShell(title, cls = "") {
    const dialog = el("dialog", `pg-dialog ${cls}`);
    dialog.setAttribute("aria-label", title);
    const header = el("header", "pg-dialog-header");
    header.append(el("h2", "", title), button("Fechar ×", () => dialog.close(), "pg-quiet"));
    dialog.append(header);
    dialog.addEventListener("click", event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    document.body.append(dialog);
    return dialog;
}

export class Gallery {
    constructor(container, adapter, initial = {}) {
        const { source = "builtin", targetId = "", expanded = false } = initial;
        this.host = container;
        this.adapter = adapter;
        this.state = { query: "", system: "", category: "", angle: "", collection: "all", grouped: true, shown: 48, ...initial, source, targetId: String(targetId) };
        this.expanded = expanded;
        this.items = [];
        this.groups = new Map();
        this.byId = new Map();
        this.selected = new Map();
        this.previewByGroup = new Map();
        this.ownedDialogs = new Set();
        this.abort = new AbortController();
        this.loadSerial = 0;
        this.build();
        this.load();
    }

    build() {
        this.root = el("section", "pg-app");
        this.root.setAttribute("aria-label", "Galeria de poses · referências em português");
        const header = el("header", "pg-header");
        const brand = el("div", "pg-brand");
        const title = el("div");
        title.append(el("div", "pg-eyebrow", "Galeria de poses"), el("h2", "pg-title", "Encontre uma boa pose"));
        this.stats = el("p", "pg-muted", "Lendo o acervo local…");
        title.append(this.stats);
        brand.append(el("span", "pg-brand-symbol", "P"), title);
        const actions = el("div", "pg-header-actions");
        actions.append(button("Configurar acervo", () => this.settings(), "pg-quiet"));
        if (!this.expanded) actions.append(button("Expandir ↗", () => {
            const picker = this.adapter.expand({ ...this.state, selectedIds: [...this.selected.keys()] });
            picker?.root.closest("dialog")?.addEventListener("close", () => {
                if (this.state.source === picker.state.source) {
                    this.selected = new Map(picker.selected); this.render(false);
                }
            }, { once: true });
        }, "pg-quiet"));
        header.append(brand, actions);
        const controls = el("div", "pg-controls");
        this.sourceSelect = el("select");
        this.sourceSelect.add(new Option("Acervo do plugin", "builtin"));
        this.sourceSelect.add(new Option("Diretório personalizado", "custom"));
        this.sourceSelect.value = this.state.source;
        this.sourceSelect.addEventListener("change", () => this.changeSource(this.sourceSelect.value));
        this.search = el("input", "pg-search");
        this.search.type = "search";
        this.search.placeholder = "Buscar pose, número, categoria…";
        this.search.setAttribute("aria-label", "Buscar poses");
        this.search.value = this.state.query;
        this.search.addEventListener("input", () => { this.state.query = this.search.value; this.render(); });
        controls.append(field("Acervo", this.sourceSelect), this.search);
        const filters = el("div", "pg-filters");
        for (const [name, label, allLabel] of [["system", "Série", "Todas as séries"], ["category", "Categoria", "Todas as categorias"], ["angle", "Ângulo", "Todos os ângulos"]]) {
            const select = el("select");
            this[`${name}Select`] = select;
            options(select, [], allLabel);
            select.addEventListener("change", () => {
                this.state[name] = select.value;
                if (name === "system") { this.state.category = ""; this.updateCategories(); }
                this.render();
            });
            filters.append(field(label, select));
        }
        options(this.angleSelect, ANGLES, "Todos os ângulos");
        this.angleSelect.value = this.state.angle;
        this.groupSelect = el("select");
        this.groupSelect.add(new Option("Agrupar por pose", "group"));
        this.groupSelect.add(new Option("Imagem por imagem", "single"));
        this.groupSelect.value = this.state.grouped ? "group" : "single";
        this.groupSelect.addEventListener("change", () => { this.state.grouped = this.groupSelect.value === "group"; this.render(); });
        filters.append(field("Exibição", this.groupSelect));
        controls.append(filters);
        const collection = el("div", "pg-collections");
        this.collectionButtons = [];
        for (const [key, label] of [["all", "Todas as poses"], ["favorites", "♡ Favoritas"], ["recent", "Recentes"]]) {
            const tab = button(label, () => { this.state.collection = key; this.render(); }, "pg-tab");
            tab.dataset.collection = key;
            this.collectionButtons.push(tab);
            collection.append(tab);
        }
        collection.append(button("Limpar filtros", () => this.resetFilters(), "pg-reset pg-quiet"));
        this.summary = el("div", "pg-summary");
        this.message = el("div", "pg-message");
        this.message.setAttribute("role", "status");
        this.message.setAttribute("aria-live", "polite");
        this.scroller = el("div", "pg-scroll");
        this.grid = el("div", "pg-grid");
        this.more = button("Carregar mais", () => { this.state.shown += 48; this.render(false); }, "pg-more");
        this.scroller.append(this.grid, this.more);
        const targetRow = el("div", "pg-target-row");
        this.target = el("select");
        this.target.setAttribute("aria-label", "Nó da galeria que recebe as poses");
        this.target.addEventListener("change", () => { this.state.targetId = this.target.value; });
        this.target.addEventListener("focus", () => this.refreshTargets());
        targetRow.append(field("Enviar para", this.target));
        this.selectionLabel = el("strong", "pg-selection-label", "0 selecionadas");
        const selectionActions = el("div", "pg-selection-actions");
        this.reviewButton = button("Ver seleção", () => this.reviewSelection(), "pg-quiet");
        this.clearButton = button("Limpar", () => { this.selected.clear(); this.render(false); }, "pg-quiet");
        this.sendButton = button("Enviar seleção", () => this.send([...this.selected.keys()], "batch"), "pg-primary");
        selectionActions.append(this.reviewButton, this.clearButton, this.sendButton);
        const bottom = el("footer", "pg-bottom");
        const selectedRow = el("div", "pg-selection-row");
        selectedRow.append(this.selectionLabel, selectionActions);
        bottom.append(targetRow, selectedRow);
        const credit = el("div", "pg-credit", "Imagens: ギア · dados: Anhao");
        credit.append(button("Como usar", () => this.help(), "pg-link"));
        bottom.append(credit);
        this.root.append(header, controls, collection, this.summary, this.message, this.scroller, bottom);
        this.host.replaceChildren(this.root);
        this.root.addEventListener("keydown", event => {
            if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) {
                event.preventDefault(); event.stopPropagation(); this.search.focus();
            }
        }, { signal: this.abort.signal });
        window.addEventListener("pose-gallery-nodes-changed", () => this.refreshTargets(), { signal: this.abort.signal });
        window.addEventListener("pose-gallery-storage-changed", () => this.render(false), { signal: this.abort.signal });
        window.addEventListener("pose-gallery-directory-changed", () => {
            if (this.state.source !== "custom") return;
            for (const dialog of this.ownedDialogs) if (!dialog.classList.contains("pg-settings")) dialog.close();
            this.selected.clear(); this.updateSelection(); this.load();
        }, { signal: this.abort.signal });
        this.refreshTargets();
        this.updateSelection();
    }

    async load() {
        const serial = ++this.loadSerial;
        this.notice("Lendo o acervo local…");
        this.grid.replaceChildren();
        this.more.hidden = true;
        try {
            const result = await this.adapter.request(`/catalogue?source=${this.state.source}`);
            if (serial !== this.loadSerial || this.abort.signal.aborted) return;
            this.items = result.items;
            this.byId = new Map(this.items.map(item => [item.id, item]));
            this.groups = buildGroups(this.items);
            if (this.state.selectedIds) {
                this.selected = new Map(this.state.selectedIds.filter(id => this.byId.has(id)).map(id => [id, this.byId.get(id)]));
                delete this.state.selectedIds;
            }
            this.stats.textContent = `${result.groups} poses · ${result.count} imagens de referência · offline`;
            options(this.systemSelect, [...new Set(this.items.map(item => item.serie))], "Todas as séries");
            this.systemSelect.value = this.state.system;
            this.updateCategories();
            this.notice("");
            this.render();
        } catch (error) {
            if (serial !== this.loadSerial || this.abort.signal.aborted) return;
            this.items = []; this.byId.clear(); this.groups.clear();
            this.stats.textContent = "Acervo indisponível";
            this.summary.textContent = "";
            this.notice(error.message, true);
            this.grid.append(el("div", "pg-empty", "Configure o diretório em «Configurar acervo» ou volte para o acervo do plugin."));
        }
    }

    changeSource(source) {
        this.state.source = source;
        this.sourceSelect.value = source;
        this.selected.clear(); this.previewByGroup.clear();
        this.resetFilters(false); this.updateSelection(); this.load();
    }

    resetFilters(render = true) {
        Object.assign(this.state, { query: "", system: "", category: "", angle: "", collection: "all" });
        this.search.value = this.systemSelect.value = this.categorySelect.value = this.angleSelect.value = "";
        this.updateCategories();
        if (render) this.render();
    }

    updateCategories() {
        options(this.categorySelect, [...new Set(this.items.filter(item => !this.state.system || item.serie === this.state.system).map(item => item.categoria))], "Todas as categorias");
        this.categorySelect.value = this.state.category;
    }

    favorites() { return readLocal(`favorites.${this.state.source}`, []); }
    recent() { return readLocal(`recent.${this.state.source}`, []); }
    isFavorite(id) { return this.favorites().includes(id); }
    toggleFavorite(id) {
        const list = this.favorites();
        writeLocal(`favorites.${this.state.source}`, list.includes(id) ? list.filter(value => value !== id) : [...list, id]);
        window.dispatchEvent(new Event("pose-gallery-storage-changed"));
    }

    render(reset = true) {
        if (reset) { this.state.shown = 48; this.scroller.scrollTop = 0; }
        const matching = filterItems(this.items, this.state, this.favorites(), this.recent());
        this.entries = listEntries(matching, this.state.grouped);
        this.summary.textContent = this.state.grouped ? `${this.entries.length} poses · ${matching.length} imagens` : `${matching.length} imagens`;
        for (const tab of this.collectionButtons) tab.setAttribute("aria-pressed", String(tab.dataset.collection === this.state.collection));
        this.grid.replaceChildren();
        if (!this.entries.length) this.grid.append(el("div", "pg-empty", this.state.collection === "favorites" ? "Nenhuma favorita corresponde aos filtros. Use o ♡ na imagem para favoritar este ângulo." : this.state.collection === "recent" ? "As poses usadas recentemente aparecem aqui." : "Nenhuma pose com esses critérios. Tente reduzir os filtros."));
        for (const entry of this.entries.slice(0, this.state.shown)) this.grid.append(this.card(entry));
        this.more.hidden = this.entries.length <= this.state.shown;
        if (!this.more.hidden) this.more.textContent = `Carregar mais · faltam ${this.entries.length - this.state.shown}`;
        this.updateSelection();
    }

    card(entry) {
        let item = this.byId.get(this.previewByGroup.get(entry.key)) || entry.item;
        if (!entry.matches.some(match => match.id === item.id)) item = entry.item;
        const card = el("article", "pg-card");
        const media = el("div", "pg-card-media");
        const open = button("", () => this.view(item), "pg-image-button");
        open.setAttribute("aria-label", `Ver ${item.nome} · ${item.angulo}`);
        open.append(imageNode(this.adapter.image(this.state.source, item.id, true), `${item.nome} ${item.angulo}`));
        const badges = el("div", "pg-badges");
        badges.append(el("span", "pg-badge", item.numero), el("span", "pg-badge pg-angle-badge", item.angulo));
        const favorite = button(this.isFavorite(item.id) ? "♥" : "♡", () => this.toggleFavorite(item.id), "pg-favorite");
        favorite.setAttribute("aria-label", `Favoritar ${item.nome} ${item.angulo}`);
        favorite.setAttribute("aria-pressed", String(this.isFavorite(item.id)));
        const checkbox = el("input");
        checkbox.type = "checkbox"; checkbox.checked = this.selected.has(item.id);
        checkbox.setAttribute("aria-label", `Selecionar ${item.nome} ${item.angulo}`);
        checkbox.addEventListener("change", () => { this.toggleSelection(item); this.render(false); });
        const checkLabel = el("label", "pg-check");
        checkLabel.append(checkbox, el("span", "", "Selecionar"));
        media.append(open, badges, favorite, checkLabel);
        const body = el("div", "pg-card-body");
        body.append(button(item.nome, () => this.view(item), "pg-card-title"), el("p", "pg-card-meta", `${item.serie} · ${item.categoria}`));
        card.append(media, body);
        if (this.state.grouped) {
            const strip = el("div", "pg-angle-strip");
            const group = this.groups.get(groupKey(item));
            for (const angle of ANGLES) {
                const candidate = group.items.find(value => value.angulo === angle);
                const angleButton = button(angle, () => {
                    this.previewByGroup.set(entry.key, candidate.id);
                    // A preview outside the current filter opens separately, preserving the grid's meaning.
                    if (!entry.matches.some(match => match.id === candidate.id)) this.view(candidate);
                    else this.render(false);
                }, candidate?.id === item.id ? "pg-angle pg-active" : "pg-angle");
                angleButton.disabled = !candidate;
                angleButton.title = candidate ? `${angle} · clique para trocar; na imagem grande dá para pegar todos os ângulos` : `${angle} sem imagem`;
                strip.append(angleButton);
            }
            card.append(strip);
        }
        return card;
    }

    toggleSelection(item) {
        if (this.selected.has(item.id)) this.selected.delete(item.id);
        else if (this.selected.size >= MAX_BATCH) this.notice(`No máximo ${MAX_BATCH} imagens por lote.`, true);
        else { this.selected.set(item.id, item); this.notice(""); }
        this.updateSelection();
    }

    updateSelection() {
        this.selectionLabel.textContent = `${this.selected.size} / ${MAX_BATCH} selecionadas`;
        this.sendButton.disabled = this.reviewButton.disabled = this.clearButton.disabled = !this.selected.size;
    }

    refreshTargets() {
        const current = this.state.targetId;
        this.target.replaceChildren(new Option("Criar novo nó da galeria", ""));
        for (const node of this.adapter.targets()) this.target.add(new Option(`#${node.displayId ?? node.id} ${node.title}`, String(node.id)));
        this.target.value = [...this.target.options].some(option => option.value === current) ? current : "";
        this.state.targetId = this.target.value;
    }

    async send(ids, mode, dialog = null) {
        if (!ids.length) return;
        try {
            this.adapter.apply({ ids, mode, source: this.state.source, targetId: this.state.targetId });
            const old = this.recent();
            writeLocal(`recent.${this.state.source}`, [...ids, ...old.filter(id => !ids.includes(id))].slice(0, 80));
            this.notice(`${ids.length} imagem(ns) enviada(s) ao nó da galeria.`);
            dialog?.close();
            window.dispatchEvent(new Event("pose-gallery-storage-changed"));
        } catch (error) { this.notice(error.message, true); if (dialog) this.dialogNotice(dialog, error.message); }
    }

    notice(message, error = false) {
        this.message.textContent = message; this.message.hidden = !message;
        this.message.classList.toggle("pg-error", error);
    }

    own(dialog) {
        this.ownedDialogs.add(dialog);
        dialog.addEventListener("close", () => this.ownedDialogs.delete(dialog), { once: true });
        return dialog;
    }

    dialogNotice(dialog, message) {
        let notice = dialog.querySelector(".pg-dialog-notice");
        if (!notice) { notice = el("p", "pg-dialog-notice pg-error"); dialog.append(notice); }
        notice.textContent = message;
    }

    view(initial) {
        let current = initial;
        const source = this.state.source;
        const dialog = this.own(dialogShell("Prévia da pose", "pg-viewer"));
        const content = el("div", "pg-viewer-content");
        const stage = el("div", "pg-stage");
        const image = imageNode(this.adapter.image(source, current.id), current.nome);
        image.loading = "eager";
        stage.append(image);
        const details = el("div", "pg-details");
        const number = el("div", "pg-eyebrow");
        const title = el("h3", "pg-viewer-title");
        const meta = el("p", "pg-muted");
        const id = el("code", "pg-id");
        const angles = el("div", "pg-viewer-angles");
        const nav = el("div", "pg-viewer-nav");
        nav.append(button("↑ Pose anterior", () => stepPose(-1)), button("Próxima pose ↓", () => stepPose(1)));
        const choose = button("Escolher este ângulo", () => { this.toggleSelection(current); update(); this.render(false); });
        const allAngles = button("Escolher todos os ângulos desta pose", () => {
            const group = this.groups.get(groupKey(current));
            const extra = group.items.filter(item => !this.selected.has(item.id));
            if (this.selected.size + extra.length > MAX_BATCH) { this.dialogNotice(dialog, `No máximo ${MAX_BATCH} imagens por lote. Remova parte da seleção.`); return; }
            for (const item of group.items) this.selected.set(item.id, item);
            this.updateSelection(); update(); this.render(false);
        });
        const use = button("Usar esta pose", () => this.send([current.id], "single", dialog), "pg-primary");
        const download = el("a", "pg-button pg-download", "Baixar original");
        download.download = `${current.id}.png`;
        const copy = button("Copiar ID da imagem", async () => {
            try { await navigator.clipboard.writeText(current.id); copy.textContent = "Copiado"; }
            catch { this.dialogNotice(dialog, `ID da imagem: ${current.id}`); }
        }, "pg-quiet");
        const hint = el("p", "pg-hint", "← → troca o ângulo · ↑ ↓ troca a pose · Esc fecha");
        details.append(number, title, meta, id, angles, nav, choose, allAngles, use, download, copy, hint);
        content.append(stage, details); dialog.append(content);
        const update = () => {
            number.textContent = current.numero; title.textContent = current.nome;
            meta.textContent = `${current.serie} · ${current.categoria} · ${current.angulo}`; id.textContent = current.id;
            image.classList.remove("pg-image-missing"); image.src = this.adapter.image(source, current.id); image.alt = `${current.nome} ${current.angulo}`;
            download.href = this.adapter.image(source, current.id); download.download = current.id + "." + current.original.split(".").pop();
            choose.textContent = this.selected.has(current.id) ? "✓ Ângulo escolhido · clique para remover" : "Escolher este ângulo";
            copy.textContent = "Copiar ID da imagem";
            angles.replaceChildren();
            const group = this.groups.get(groupKey(current));
            for (const angle of ANGLES) {
                const item = group.items.find(value => value.angulo === angle);
                const tab = button(angle, () => { current = item; update(); }, item?.id === current.id ? "pg-active" : "");
                tab.disabled = !item; angles.append(tab);
            }
        };
        const stepAngle = step => {
            const list = this.groups.get(groupKey(current)).items;
            current = list[(list.indexOf(current) + step + list.length) % list.length]; update();
        };
        const stepPose = step => {
            const visibleGroups = [...new Set(this.entries.map(entry => groupKey(entry.item)))];
            const position = visibleGroups.indexOf(groupKey(current));
            const next = visibleGroups[position + step];
            if (!next) return;
            const list = this.groups.get(next).items;
            current = list.find(item => item.angulo === current.angulo) || list[0]; update();
        };
        dialog.addEventListener("keydown", event => {
            if (["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) return;
            const action = { ArrowLeft: () => stepAngle(-1), ArrowRight: () => stepAngle(1), ArrowUp: () => stepPose(-1), ArrowDown: () => stepPose(1) }[event.key];
            if (action) { event.preventDefault(); event.stopPropagation(); action(); }
        });
        let startX = null;
        stage.addEventListener("touchstart", event => { if (event.touches.length === 1) startX = event.touches[0].clientX; }, { passive: true });
        stage.addEventListener("touchend", event => {
            if (startX !== null && Math.abs(event.changedTouches[0].clientX - startX) > 60) stepAngle(event.changedTouches[0].clientX < startX ? 1 : -1);
            startX = null;
        }, { passive: true });
        update(); dialog.showModal();
    }

    reviewSelection() {
        const dialog = this.own(dialogShell("Seleção · a saída segue esta ordem", "pg-review"));
        const list = el("div", "pg-review-list");
        const update = () => {
            list.replaceChildren();
            for (const [id, item] of this.selected) {
                const row = el("div", "pg-review-row");
                const text = el("div"); text.append(el("strong", "", item.nome), el("p", "pg-muted", `${item.angulo} · ${id}`));
                row.append(imageNode(this.adapter.image(this.state.source, id, true), item.nome), text, button("Remover", () => { this.selected.delete(id); update(); this.render(false); }));
                list.append(row);
            }
            if (!this.selected.size) list.append(el("p", "pg-muted", "A seleção está vazia."));
        };
        dialog.append(list, button("Enviar seleção", () => this.send([...this.selected.keys()], "batch", dialog), "pg-primary pg-dialog-action"));
        update(); dialog.showModal();
    }

    async settings() {
        const dialog = this.own(dialogShell("Configurar acervo", "pg-settings"));
        const content = el("div", "pg-settings-content");
        content.append(el("h3", "", "O acervo vem no plugin e já funciona"), el("p", "pg-muted", "Por padrão são lidos os diretórios data, img e thumbs do plugin. A galeria e os nós de imagem não usam internet nem modelos extras."));
        const input = el("input"); input.type = "text"; input.placeholder = "Deixe vazio para usar o acervo do plugin"; input.autocomplete = "off";
        input.disabled = true;
        content.append(field("Diretório personalizado (opcional)", input), el("p", "pg-muted", "Informe um caminho absoluto no computador onde o ComfyUI roda; em uso remoto não é o caminho do computador do navegador. O diretório precisa ter data/pose-pt.json e as imagens citadas na lista."));
        const status = el("p", "pg-settings-status"); status.setAttribute("role", "status");
        const save = button("Verificar e salvar", async () => {
            save.disabled = true; status.textContent = "Verificando o diretório…";
            try {
                const result = await this.adapter.request("/settings", { method: "POST", body: { custom_directory: input.value } });
                input.value = result.custom_directory; status.textContent = "Salvo. Troque de acervo no topo da galeria."; status.classList.remove("pg-error");
                if (this.state.source === "custom" && !result.custom_directory) this.changeSource("builtin");
                window.dispatchEvent(new Event("pose-gallery-directory-changed"));
            } catch (error) { status.textContent = error.message; status.classList.add("pg-error"); }
            finally { save.disabled = false; }
        }, "pg-primary");
        save.disabled = true;
        content.append(status, save, button("Limpar o campo", () => { input.value = ""; status.textContent = "Clique em salvar para aplicar."; }, "pg-quiet"), el("p", "pg-hint", "O diretório é salvo no diretório de usuário do ComfyUI desta máquina. Cada nó guarda o próprio acervo e ID de imagem; trocar de acervo na galeria não altera os nós existentes."));
        dialog.append(content); dialog.showModal();
        try {
            const result = await this.adapter.request("/settings");
            if (!dialog.isConnected) return;
            input.value = result.custom_directory; input.disabled = save.disabled = false;
        } catch (error) { status.textContent = error.message; status.classList.add("pg-error"); }
    }

    help() {
        const dialog = this.own(dialogShell("Como usar e origem do acervo", "pg-settings"));
        const content = el("div", "pg-settings-content");
        for (const [title, text] of [
            ["Uma imagem", "Busque e abra a pose, confirme o ângulo e clique em «Usar esta pose». Por padrão é criado um nó de imagem única; você também pode indicar um nó existente no rodapé."],
            ["Em lote", "Marque as imagens e clique em «Enviar seleção». A ordem da seleção vai para o nó de lote, que também pode devolver todos os ângulos disponíveis de uma pose."],
            ["Controlar a pose gerada", "Esta galeria entrega imagens de referência. Ligue antes um pré-processador DWPose/OpenPose e depois o ControlNet de pose correspondente; a galeria não extrai o esqueleto."],
            ["Favoritas e fluxos", "Favoritas e recentes ficam neste navegador. O ID da pose, o acervo e os parâmetros de tamanho são salvos com o fluxo; quem receber o fluxo também precisa do plugin e do acervo."],
            ["Origem do acervo", "Imagens e dados originais: ギア (giaaibusi). Dados em chinês e código da galeria original: Anhao. O acervo tem referências artísticas de pose para público adulto; as imagens e os dados originais não estão sob a licença MIT do código — veja o LICENSE do repositório."],
        ]) content.append(el("h3", "", title), el("p", "pg-muted", text));
        const link = el("a", "pg-source-link", "Projeto original e licença ↗");
        link.href = "https://github.com/anhao/ai-pose-gallery-zh"; link.target = "_blank"; link.rel = "noopener noreferrer";
        content.append(link); dialog.append(content); dialog.showModal();
    }

    destroy() {
        this.abort.abort(); this.loadSerial++;
        for (const dialog of this.ownedDialogs) dialog.close();
        this.host.replaceChildren();
    }
}
