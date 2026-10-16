// Онлайн-запись на главной: услуги, свободные слоты и заявки берутся из API бота (Supabase Edge Function).
(() => {
    const API = "https://kyacbhvnvbjwyjxdsgqu.supabase.co/functions/v1/luma-bot/api";
    const STORAGE_KEY = "luma-book-contacts";

    const form = document.getElementById("booking-form");
    if (!form) return;
    const role = (name) => form.querySelector(`[data-role="${name}"]`);
    const show = (node, visible) => { node.hidden = !visible; };

    const state = {
        config: null,
        locationId: null,
        serviceId: null,
        option: null,
        extras: new Set(),
        date: null,
        time: null,
        noDate: false,
        slots: null, // null — загружаются
        startedAt: Date.now(),
        submitting: false,
    };
    const slotsCache = new Map();

    // Мини-приложение Telegram: сайт открыт кнопкой «Записаться» в боте (?from=tg).
    const inTelegram = new URLSearchParams(location.search).get("from") === "tg";
    let tgApp = null;
    if (inTelegram) {
        const sdk = document.createElement("script");
        sdk.src = "https://telegram.org/js/telegram-web-app.js";
        sdk.onload = () => {
            tgApp = window.Telegram?.WebApp ?? null;
            if (!tgApp) return;
            tgApp.ready();
            tgApp.expand();
            const user = tgApp.initDataUnsafe?.user;
            if (user?.first_name && !form.elements.name.value) {
                form.elements.name.value = [user.first_name, user.last_name].filter(Boolean).join(" ");
            }
        };
        document.head.append(sdk);
    }

    const rub = (n) => `${n.toLocaleString("ru-RU").replace(/\s/g, " ")} ₽`;
    const service = () => state.config?.services.find((s) => s.id === state.serviceId);
    const option = () => service()?.options[state.option];
    const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const range = (t) => `${t}–${toTime(toMinutes(t) + option().minutes)}`;

    function el(tag, attrs = {}, children = []) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (key === "class") node.className = value;
            else if (key === "text") node.textContent = value;
            else node.setAttribute(key, value);
        }
        for (const child of [].concat(children)) if (child) node.append(child);
        return node;
    }

    function choice(action, value, pressed, content, extraClass = "choice") {
        return el("button", { type: "button", class: extraClass, "data-action": action, "data-value": value, "aria-pressed": String(pressed) }, content);
    }

    function priceFrom(s) {
        if (s.custom) return "Стоимость — индивидуально";
        const min = Math.min(...s.options.map((o) => o.price));
        return s.options.length > 1 ? `от ${rub(min)}` : rub(min);
    }

    // ---------- отрисовка шагов ----------

    function renderLocations() {
        const locations = state.config.locations;
        show(document.getElementById("step-location"), locations.length > 1);
        role("locations").replaceChildren(
            ...locations.map((l) =>
                choice("location", l.id, l.id === state.locationId, [
                    el("span", { class: "choice__title", text: l.name }),
                    el("span", { class: "choice__desc", text: l.address }),
                ]),
            ),
        );
    }

    function renderServices() {
        role("services").replaceChildren(
            ...state.config.services.map((s) =>
                choice("service", s.id, s.id === state.serviceId, [
                    el("span", { class: "choice__title", text: s.title }),
                    el("span", { class: "choice__desc", text: s.description }),
                    el("span", { class: "choice__price", text: priceFrom(s) }),
                ]),
            ),
        );
    }

    function renderExtras() {
        const custom = Boolean(service()?.custom);
        show(document.getElementById("step-extras"), custom);
        if (!custom) return;
        role("extras").replaceChildren(
            ...state.config.extras.map((e) => choice("extra", e.id, state.extras.has(e.id), e.label)),
        );
    }

    function renderOptions() {
        const s = service();
        show(document.getElementById("step-duration"), Boolean(s));
        if (!s) return;
        role("options").replaceChildren(
            ...s.options.map((o, i) => {
                const [duration, price] = o.label.split(" — ");
                return choice("option", String(i), i === state.option, [
                    el("span", { class: "choice__title", text: duration }),
                    price ? el("span", { class: "choice__sub", text: price.replace(/\s(?=\d{3}\b)/g, "\u00a0") }) : null,
                ]);
            }),
        );
    }

    function renderDates() {
        const visible = Boolean(option());
        show(document.getElementById("step-date"), visible);
        if (!visible) return;

        const dates = role("dates");
        const times = role("times");
        const note = role("slots-note");

        if (state.slots === null) {
            dates.replaceChildren(el("p", { class: "step__hint", text: "Загружаем свободное время…" }));
            times.replaceChildren();
            show(note, false);
            return;
        }

        const chips = state.slots.map((d) => {
            const [wd, day] = d.label.split(" ");
            return choice("date", d.date, d.date === state.date && !state.noDate, [
                el("span", { class: "date__wd", text: wd }),
                el("span", { class: "date__day", text: day }),
            ], "date");
        });
        if (service().custom) chips.push(choice("nodate", "1", state.noDate, "Дата пока не определена", "date date--nodate"));
        dates.replaceChildren(...chips);

        const day = state.slots.find((d) => d.date === state.date);
        times.replaceChildren(...(day && !state.noDate ? day.times.map((t) => choice("time", t, t === state.time, range(t))) : []));

        if (state.slots.length === 0) {
            note.textContent = "На ближайшие две недели под этот формат свободного времени нет. Напишите нам — подберём вариант.";
        } else if (!state.date && !state.noDate) {
            note.textContent = "Выберите дату — покажем свободное время.";
        } else {
            note.textContent = "";
        }
        show(note, Boolean(note.textContent));
    }

    function renderContacts() {
        const ready = Boolean(option() && (state.time || state.noDate));
        show(document.getElementById("step-contacts"), ready);
        show(document.getElementById("summary"), ready);
        const custom = Boolean(service()?.custom);
        role("comment-label").firstChild.textContent = custom ? "Опишите задачу " : "Комментарий ";
        if (ready) renderSummary();
    }

    function renderSummary() {
        const s = service();
        const o = option();
        const location = state.config.locations.find((l) => l.id === state.locationId);
        const day = state.slots?.find((d) => d.date === state.date);
        const extras = state.config.extras.filter((e) => state.extras.has(e.id)).map((e) => e.label).join(", ");

        const rows = [
            state.config.locations.length > 1 ? ["Локация", location?.name] : null,
            ["Формат", s.title],
            s.custom && extras ? ["Наполнение", extras] : null,
            ["Время", o.label],
            ["Когда", state.noDate ? "Дата пока не определена" : `${day?.long ?? ""}, ${range(state.time)}`],
        ].filter(Boolean);

        role("summary").replaceChildren(
            ...rows.map(([k, v]) => el("div", { class: "summary__row" }, [el("dt", { text: k }), el("dd", { text: v })])),
        );
        const total = role("total");
        const discount = o.price > 0 ? state.loyalty?.discount ?? 0 : 0;
        if (discount > 0) {
            // Скидка по программе лояльности (клиент вошёл в личный кабинет); округление — как на сервере.
            const final = Math.round((o.price * (100 - discount)) / 100 / 10) * 10;
            total.innerHTML = `<s class="summary__old"></s> ${rub(final)}`;
            total.querySelector("s").textContent = rub(o.price);
        } else {
            total.textContent = o.price > 0 ? rub(o.price) : "рассчитаем индивидуально";
        }
        const loyaltyNote = role("loyalty");
        if (loyaltyNote) {
            loyaltyNote.innerHTML = discount > 0
                ? `Ваша скидка <strong>${discount}%</strong> — уровень «${state.loyalty.tierName}»`
                : o.price > 0 ? `<a href="./cabinet/">Войдите в личный кабинет</a> — скидка 5% на эту и все следующие записи` : "";
            show(loyaltyNote, Boolean(loyaltyNote.innerHTML));
        }
        total.classList.toggle("is-text", o.price === 0);
        role("submit").textContent = state.noDate ? "Отправить запрос" : "Отправить заявку";
    }

    function render() {
        renderLocations();
        renderServices();
        renderExtras();
        renderOptions();
        renderDates();
        renderContacts();
    }

    // ---------- данные ----------

    async function loadSlots() {
        const o = option();
        if (!o || !state.locationId) return;
        const key = `${state.locationId}:${o.minutes}`;
        if (slotsCache.has(key)) {
            state.slots = slotsCache.get(key);
        } else {
            state.slots = null;
            render();
            try {
                const res = await fetch(`${API}/slots?location=${encodeURIComponent(state.locationId)}&minutes=${o.minutes}`);
                const data = await res.json();
                slotsCache.set(key, data.dates ?? []);
                if (option()?.minutes !== o.minutes) return; // пользователь уже выбрал другое
                state.slots = data.dates ?? [];
            } catch {
                state.slots = [];
            }
        }
        const day = state.slots.find((d) => d.date === state.date);
        if (!day) state.date = state.slots[0]?.date ?? null;
        if (state.time && !state.slots.find((d) => d.date === state.date)?.times.includes(state.time)) state.time = null;
        render();
    }

    function selectService(id) {
        const s = state.config.services.find((x) => x.id === id);
        if (!s) return;
        if (state.serviceId !== id) {
            state.serviceId = id;
            state.option = s.options.length === 1 ? 0 : null;
            state.extras.clear();
            state.time = null;
            state.noDate = false;
        }
        render();
        if (state.option !== null) loadSlots();
    }

    // ---------- события ----------

    form.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        const { action, value } = button.dataset;
        setMessage("");

        switch (action) {
            case "location":
                state.locationId = value;
                state.time = null;
                slotsCache.clear();
                render();
                loadSlots();
                break;
            case "service":
                selectService(value);
                break;
            case "extra":
                state.extras.has(value) ? state.extras.delete(value) : state.extras.add(value);
                render();
                break;
            case "option":
                state.option = Number(value);
                state.time = null;
                render();
                loadSlots();
                break;
            case "date":
                state.date = value;
                state.time = null;
                state.noDate = false;
                render();
                break;
            case "nodate":
                state.noDate = true;
                state.time = null;
                render();
                scrollTo("step-contacts");
                break;
            case "time": {
                const first = !state.time;
                state.time = value;
                render();
                if (first) scrollTo("step-contacts");
                break;
            }
        }
    });

    function scrollTo(id) {
        const node = document.getElementById(id);
        if (!node) return;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        node.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }

    function setMessage(text) {
        const message = role("message");
        message.textContent = text;
        show(message, Boolean(text));
    }

    function saveContacts(name, phone) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ name, phone }));
        } catch {
            /* приватный режим — не страшно */
        }
    }

    // Клиент вошёл в личный кабинет — подставляем имя, телефон и скидку.
    async function loadLoyalty() {
        let token = null;
        try { token = localStorage.getItem("luma-cabinet-token"); } catch { /* приватный режим */ }
        if (!token) return;
        try {
            const res = await fetch(`${API}/me`, { headers: { authorization: `Bearer ${token}` } });
            if (!res.ok) return;
            const me = await res.json();
            state.loyalty = { discount: me.tier.discount, tierName: me.tier.name };
            if (me.name && !form.elements.name.value) form.elements.name.value = me.name;
            if (!form.elements.phone.value) form.elements.phone.value = `+${me.phone}`;
        } catch { /* кабинет недоступен — запись работает без скидки в интерфейсе */ }
    }

    function restoreContacts() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
            if (saved?.name) form.elements.name.value = saved.name;
            if (saved?.phone) form.elements.phone.value = saved.phone;
        } catch {
            /* нет сохранённых данных */
        }
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (state.submitting) return;

        const name = form.elements.name.value.trim();
        const phone = form.elements.phone.value.trim();
        const digits = phone.replace(/\D/g, "");
        const nameOk = name.length >= 2;
        const phoneOk = digits.length >= 10 && digits.length <= 15;
        form.elements.name.setAttribute("aria-invalid", String(!nameOk));
        form.elements.phone.setAttribute("aria-invalid", String(!phoneOk));
        if (!nameOk || !phoneOk) {
            setMessage(!nameOk ? "Укажите, пожалуйста, имя." : "Проверьте номер телефона.");
            return;
        }

        state.submitting = true;
        const submit = role("submit");
        submit.disabled = true;
        submit.textContent = "Отправляем…";

        try {
            const res = await fetch(`${API}/book`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    locationId: state.locationId,
                    serviceId: state.serviceId,
                    option: state.option,
                    date: state.noDate ? undefined : state.date,
                    time: state.noDate ? undefined : state.time,
                    noDate: state.noDate,
                    extras: [...state.extras],
                    comment: form.elements.comment.value.trim(),
                    name,
                    phone,
                    website: form.elements.website.value,
                    tgInitData: tgApp?.initData || undefined,
                    startedAt: state.startedAt,
                }),
            });
            const data = await res.json().catch(() => ({}));

            if (res.ok && data.ok) {
                saveContacts(name, phone);
                showSuccess(data.kind, phone, data.telegram);
                return;
            }
            if (res.status === 409) {
                setMessage("Это время только что заняли — выберите, пожалуйста, другое.");
                slotsCache.clear();
                state.time = null;
                await loadSlots();
                scrollTo("step-date");
            } else if (res.status === 429) {
                setMessage("Слишком много заявок с этого устройства. Напишите нам в WhatsApp — забронируем вручную.");
            } else {
                setMessage("Не получилось отправить заявку. Проверьте данные или напишите нам в WhatsApp.");
            }
        } catch {
            setMessage("Нет связи с сервером. Проверьте интернет или напишите нам в WhatsApp.");
        } finally {
            state.submitting = false;
            submit.disabled = false;
            if (!document.getElementById("booking-success").hidden) return;
            renderSummary();
        }
    });

    function showSuccess(kind, phone, viaTelegram) {
        const day = state.slots?.find((d) => d.date === state.date);
        const confirm = viaTelegram ? "Подтверждение придёт в чат с ботом." : `Подтвердим бронь в течение часа — позвоним или напишем в WhatsApp на номер ${phone}.`;
        const text = kind === "request" || state.noDate || !state.time
            ? "Мы свяжемся с вами, чтобы обсудить детали, дату и стоимость."
            : `${day?.long ?? ""}, ${range(state.time)}. ${confirm}`;
        if (tgApp) tgApp.HapticFeedback?.notificationOccurred("success");
        document.querySelector('[data-role="success-text"]').textContent = text;
        show(form, false);
        show(document.getElementById("booking-success"), true);
        scrollTo("booking");
    }

    // ---------- запуск ----------

    async function init() {
        try {
            const res = await fetch(`${API}/config`);
            if (!res.ok) throw new Error(String(res.status));
            state.config = await res.json();
        } catch {
            show(document.getElementById("booking-loading"), false);
            show(document.getElementById("booking-error"), true);
            return;
        }

        const tgLink = document.querySelector('[data-role="tg-link"]');
        if (tgLink && state.config.botUsername) tgLink.href = `https://t.me/${state.config.botUsername}`;
        state.locationId = state.config.locations[0]?.id ?? null;
        restoreContacts();
        await loadLoyalty();

        show(document.getElementById("booking-loading"), false);
        show(form, true);
        render();

        // Ссылка вида /?service=rent_pro#booking (в т.ч. редирект со старой /book) сразу открывает нужную услугу.
        const preset = pendingService ?? new URLSearchParams(location.search).get("service");
        if (preset) selectService(preset);
    }

    // Кнопки тарифов: <a href="#booking" data-book-service="rent_pro"> — прокрутка к форме с выбранной услугой.
    let pendingService = null;
    document.addEventListener("click", (event) => {
        const link = event.target.closest("[data-book-service]");
        if (!link) return;
        const id = link.dataset.bookService;
        if (state.config) {
            restart();
            selectService(id);
        } else {
            pendingService = id;
        }
    });

    function restart() {
        state.time = null;
        state.noDate = false;
        state.startedAt = Date.now();
        slotsCache.clear();
        setMessage("");
        show(document.getElementById("booking-success"), false);
        show(form, true);
    }

    document.getElementById("booking-restart")?.addEventListener("click", () => {
        restart();
        render();
        loadSlots();
        scrollTo("booking");
    });

    init();
})();
