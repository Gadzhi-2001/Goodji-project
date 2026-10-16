// Личный кабинет клиента Luma: вход по коду, уровень лояльности, брони. Данные — из API бота (Supabase Edge Function).
(() => {
    const API = "https://kyacbhvnvbjwyjxdsgqu.supabase.co/functions/v1/luma-bot/api";
    const TOKEN_KEY = "luma-cabinet-token";
    const $ = (id) => document.getElementById(id);
    const show = (node, visible) => { node.hidden = !visible; };
    const rub = (n) => `${n.toLocaleString("ru-RU").replace(/\s/g, " ")} ₽`;

    const phoneForm = $("phone-form");
    const codeForm = $("code-form");
    let phone = "";
    let tgApp = null;

    const storage = {
        get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
        set: (v) => { try { localStorage.setItem(TOKEN_KEY, v); } catch { /* приватный режим */ } },
        clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* приватный режим */ } },
    };

    async function api(path, { method = "GET", body, auth = false } = {}) {
        const headers = { "content-type": "application/json" };
        const token = storage.get();
        if (auth && token) headers.authorization = `Bearer ${token}`;
        const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
        const data = await res.json().catch(() => ({}));
        return { status: res.status, data };
    }

    function setError(form, text) {
        const node = form.querySelector('[data-role="error"]');
        node.textContent = text;
        show(node, Boolean(text));
    }

    const ERRORS = {
        invalid_phone: "Проверьте номер телефона.",
        too_many_codes: "Слишком много запросов. Попробуйте через 10 минут.",
        delivery_unavailable: "Не получилось отправить код. Напишите нам в WhatsApp — поможем войти.",
        wrong_code: "Неверный код. Проверьте и попробуйте ещё раз.",
        code_expired: "Код устарел. Запросите новый.",
        too_many_attempts: "Слишком много попыток. Запросите новый код.",
    };

    // ---------- вход ----------

    phoneForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        setError(phoneForm, "");
        const raw = phoneForm.elements.phone.value.trim();
        if (raw.replace(/\D/g, "").length < 10) return setError(phoneForm, ERRORS.invalid_phone);
        if (!phoneForm.elements.consent.checked) return setError(phoneForm, "Нужно согласие на обработку персональных данных.");

        const button = phoneForm.querySelector("button[type=submit]");
        button.disabled = true;
        const { status, data } = await api("/auth/request", { method: "POST", body: { phone: raw } }).catch(() => ({ status: 0, data: {} }));
        button.disabled = false;
        if (status !== 200) return setError(phoneForm, ERRORS[data.error] ?? "Нет связи с сервером. Попробуйте ещё раз.");

        phone = raw;
        codeForm.querySelector('[data-role="sent-to"]').textContent = data.channel === "telegram"
            ? "Мы отправили код в Telegram — в чат с ботом Luma Studio."
            : `Мы отправили SMS с кодом на номер ${raw}.`;
        show(phoneForm, false);
        show(codeForm, true);
        codeForm.elements.code.focus();
    });

    codeForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        setError(codeForm, "");
        const code = codeForm.elements.code.value.replace(/\D/g, "");
        if (code.length !== 6) return setError(codeForm, "Введите 6 цифр из сообщения.");

        const button = codeForm.querySelector("button[type=submit]");
        button.disabled = true;
        const { status, data } = await api("/auth/verify", { method: "POST", body: { phone, code, tgInitData: tgApp?.initData || undefined } })
            .catch(() => ({ status: 0, data: {} }));
        button.disabled = false;
        if (status !== 200 || !data.token) return setError(codeForm, ERRORS[data.error] ?? "Не получилось войти. Попробуйте ещё раз.");

        storage.set(data.token);
        await loadAccount();
    });

    codeForm.elements.code.addEventListener("input", (event) => {
        if (event.target.value.replace(/\D/g, "").length === 6) codeForm.requestSubmit();
    });

    document.addEventListener("click", async (event) => {
        const action = event.target.closest("[data-action]")?.dataset.action;
        if (action === "change-phone") {
            show(codeForm, false);
            show(phoneForm, true);
        }
        if (action === "logout") {
            await api("/auth/logout", { method: "POST", auth: true }).catch(() => {});
            storage.clear();
            showLogin();
        }
        const cancelId = event.target.closest("[data-cancel]")?.dataset.cancel;
        if (cancelId && confirm("Отменить эту бронь?")) {
            const { status } = await api("/me/cancel", { method: "POST", body: { bookingId: cancelId }, auth: true });
            if (status !== 200) alert("Не получилось отменить. Напишите нам в WhatsApp.");
            await loadAccount();
        }
    });

    // ---------- кабинет ----------

    const STATUS = { tentative: "ждёт подтверждения", confirmed: "подтверждена", completed: "состоялась", cancelled: "отменена" };

    function bookingItem(b) {
        const li = document.createElement("li");
        li.className = "cab-booking";
        li.innerHTML = `
            <div>
                <p class="cab-booking__title"></p>
                <p class="cab-booking__when"></p>
            </div>
            <div class="cab-booking__side">
                <span class="cab-status cab-status--${b.status}"></span>
                <span class="cab-booking__price"></span>
            </div>`;
        li.querySelector(".cab-booking__title").textContent = b.title.replace(/\s—\s[^—]+$/, "");
        li.querySelector(".cab-booking__when").textContent = `${b.dateLabel}, ${b.time}`;
        // Прошедшая неотменённая бронь — это состоявшийся визит.
        const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
        const status = b.date < today && b.status !== "cancelled" ? "completed" : b.status;
        li.querySelector(".cab-status").textContent = STATUS[status] ?? status;
        li.querySelector(".cab-status").className = `cab-status cab-status--${status}`;
        li.querySelector(".cab-booking__price").textContent = b.price > 0 ? rub(b.price) : "";
        if (b.canCancel) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "cab-link";
            btn.dataset.cancel = b.id;
            btn.textContent = "Отменить";
            li.querySelector(".cab-booking__side").append(btn);
        }
        return li;
    }

    function fillList(role, items, empty) {
        const list = document.querySelector(`[data-role="${role}"]`);
        list.replaceChildren(...(items.length ? items.map(bookingItem) : [Object.assign(document.createElement("li"), { className: "cab-empty", textContent: empty })]));
    }

    function render(me) {
        const set = (role, text) => { document.querySelector(`[data-role="${role}"]`).textContent = text; };
        set("hello", me.name ? `Здравствуйте, ${me.name.split(" ")[0]}!` : "Здравствуйте!");
        set("tier-name", me.tier.name);
        set("visits", `Визитов: ${me.visits}`);
        set("discount", `${me.tier.discount}%`);

        const wrap = document.querySelector('[data-role="progress-wrap"]');
        if (me.next) {
            const from = me.tier.minVisits;
            const to = me.visits + me.next.visitsLeft; // порог следующего уровня
            const pct = Math.max(6, Math.min(100, ((me.visits - from) / (to - from)) * 100));
            document.querySelector('[data-role="progress"]').style.width = `${pct}%`;
            set("progress-text", `Ещё ${me.next.visitsLeft} ${plural(me.next.visitsLeft, "визит", "визита", "визитов")} — и скидка ${me.next.discount}% (уровень «${me.next.name}»)`);
            show(wrap, true);
        } else {
            set("progress-text", "У вас максимальный уровень — спасибо, что вы с нами!");
            document.querySelector('[data-role="progress"]').style.width = "100%";
        }

        document.querySelector('[data-role="tiers"]').replaceChildren(...me.tiers.map((t) => {
            const li = document.createElement("li");
            li.className = `cab-tiers__item${t.id === me.tier.id ? " is-current" : ""}${me.visits >= t.minVisits ? " is-reached" : ""}`;
            li.innerHTML = "<strong></strong><span></span><small></small>";
            li.querySelector("strong").textContent = `${t.discount}%`;
            li.querySelector("span").textContent = t.name;
            li.querySelector("small").textContent = t.minVisits === 0 ? "при регистрации" : `от ${t.minVisits} визитов`;
            return li;
        }));

        fillList("upcoming", me.upcoming, "Пока нет предстоящих броней.");
        fillList("history", me.history, "Здесь появятся ваши прошлые записи.");
    }

    function plural(n, one, few, many) {
        const m10 = n % 10, m100 = n % 100;
        if (m10 === 1 && m100 !== 11) return one;
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
        return many;
    }

    function showLogin() {
        show($("cab-loading"), false);
        show($("cab-account"), false);
        show($("cab-login"), true);
        show(phoneForm, true);
        show(codeForm, false);
    }

    async function loadAccount() {
        const { status, data } = await api("/me", { auth: true }).catch(() => ({ status: 0, data: {} }));
        if (status === 401) {
            storage.clear();
            return showLogin();
        }
        if (status !== 200) {
            show($("cab-loading"), true);
            $("cab-loading").textContent = "Не получилось загрузить кабинет. Обновите страницу.";
            return;
        }
        show($("cab-loading"), false);
        show($("cab-login"), false);
        show($("cab-account"), true);
        render(data);
    }

    // ---------- запуск ----------

    async function init() {
        if (document.documentElement.classList.contains("tg-app")) {
            await new Promise((resolve) => {
                const sdk = document.createElement("script");
                sdk.src = "https://telegram.org/js/telegram-web-app.js";
                sdk.onload = sdk.onerror = resolve;
                document.head.append(sdk);
            });
            tgApp = window.Telegram?.WebApp ?? null;
            tgApp?.ready();
            tgApp?.expand();
            // Telegram уже привязан к кабинету — входим без кода.
            if (tgApp?.initData && !storage.get()) {
                const { data } = await api("/auth/telegram", { method: "POST", body: { tgInitData: tgApp.initData } }).catch(() => ({ data: {} }));
                if (data.token) storage.set(data.token);
            }
        }
        if (storage.get()) return loadAccount();
        showLogin();
    }

    init();
})();
