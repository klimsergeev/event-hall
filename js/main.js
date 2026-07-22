/* ============================================================
   Точка входа: собирает экран, связывает пан/зум ↔ компакт ↔ marquee.
   ============================================================ */
import { EVENT, SESSIONS, TIERS, MAX_SEATS, TWEAKS, formatPrice } from './data.js';
import { CompactTitle, centerActiveChip } from './header.js';
import { HallViewport } from './hall.js';
import { buildSeats, createSelectionLayer } from './seats.js';

/* --- Иконки (инлайн SVG) --- */
const icoChevronLeft =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 L5 8 L10 13"/></svg>';
const icoChevronRight =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5 L15 12 L9 19"/></svg>';
const icoCross =
    '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 5 L15 15 M15 5 L5 15"/></svg>';

const $ = (sel, root = document) => root.querySelector(sel);

/* --- Состояние --- */
let activeId = SESSIONS[0].id;
let compact = false;

/* --- DOM-ссылки --- */
const header = $('.header');
const tabsWrap = $('.tabs');
const scroller = $('.scroller', tabsWrap);
const legendEl = $('.legend');
const subEl = $('.sub');
const sliderEl = $('.slider');
const ctaEl = $('.cta');
const floatingEl = $('.floating');
const mapViewportEl = $('.map-viewport');
const mapContentEl = $('.map-content');

/* --- Заголовок / marquee --- */
$('.ttl-inner').textContent = EVENT.title;
const marquee = new CompactTitle({
    inner: $('.ttl-inner'),
    wrap: $('.ttl'),
    fadeL: $('.ttl-fade-l'),
    fadeR: $('.ttl-fade-r'),
});
$('.icon-btn').innerHTML = icoChevronLeft;

/* --- Рендер табов --- */
const chipEls = {};
function renderTabs() {
    scroller.innerHTML = '';
    SESSIONS.forEach((s) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tab' + (s.id === activeId ? ' active' : '');
        btn.dataset.id = s.id;
        btn.innerHTML =
            `<span class="tab-date${s.weekend ? ' weekend' : ''}">` +
                `<span class="wd">${s.wd},</span>` +
                `<span class="dt">${s.date}</span>` +
                `<span class="tm">${s.time}</span>` +
            `</span>` +
            `<span class="tab-price">${s.from}</span>` +
            `<span class="tab-compact">` +
                `<span class="date">${s.date}</span>` +
                `<span class="sep"></span>` +
                `<span class="time">${s.time}</span>` +
            `</span>`;
        btn.addEventListener('click', () => onChipChange(s.id));
        chipEls[s.id] = btn;
        scroller.appendChild(btn);
    });
}

/* --- Рендер легенды --- */
function renderLegend() {
    legendEl.innerHTML = '';
    TIERS.forEach((t) => {
        const pill = document.createElement('span');
        pill.className = 'pill';
        pill.innerHTML = `<span class="sw" style="background:${t.color}"></span>${formatPrice(t.price)}`;
        legendEl.appendChild(pill);
    });
}

/* --- Корзина: выбранные места. Наполняется кликами по схеме, стартует ПУСТОЙ.
       Каждый элемент — объект-место из модели seats.js (ссылка), у него есть
       .seat/.row/.price/.selected. Максимум MAX_SEATS мест. --- */
const cart = [];

/* --- Галерея билетов: карточки строятся из cart, активная переключается
       классами, drag по горизонтали снапит к соседней --- */
let activeTicket = 0;
const ticketEls = [];
let tDrag = null;                 // { startX, startActive, pid }
const TICKET_STEP = 64;           // px перетаскивания на одну карточку

function renderTickets() {
    sliderEl.innerHTML = '';
    ticketEls.length = 0;
    cart.forEach((tk) => {
        const card = document.createElement('div');
        card.className = 'ticket';
        card.innerHTML =
            `<span class="t-text">` +
                `<span class="t-seat">${tk.seat} место, ${tk.row} ряд</span>` +
                `<span class="t-price">${formatPrice(tk.price)}</span>` +
            `</span>` +
            `<button class="t-x" type="button" aria-label="Убрать">${icoCross}</button>`;
        card.addEventListener('pointerdown', (e) => onTicketDown(e, card));
        card.addEventListener('pointermove', onTicketMove);
        card.addEventListener('pointerup', onTicketUp);
        card.addEventListener('pointercancel', onTicketUp);
        // × — удалить билет; глушим pointerdown, чтобы кнопка не стартовала drag карточки
        const xBtn = card.querySelector('.t-x');
        xBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        xBtn.addEventListener('click', (e) => { e.stopPropagation(); removeSeat(tk); });
        ticketEls.push(card);
        sliderEl.appendChild(card);
    });
    // клампим активную карточку в новые границы
    activeTicket = Math.max(0, Math.min(cart.length - 1, activeTicket));
    layoutTickets();
    sizeTicketOverlap();
}

/* Ширина карточки Ticket из Figma (4898-91318): обе версии — 231px. */
const TICKET_W = 231;

/* Перекрытие карточек вычисляется из ФАКТИЧЕСКОЙ ширины галереи.
   Галерея (.slider) = ширине кнопки CTA (тот же padded-контейнер .floating),
   т.е. ширина экрана минус 16px с каждой стороны. Чтобы N карточек легли
   ТОЧНО в эту ширину с одинаковым перекрытием:
       C + (N - 1) * visible = W  →  visible = (W - C) / (N - 1)
   где C = 231 (ширина карточки), W = ширина галереи, N = число карточек.
   visible — видимый край соседа; отрицательный margin = visible - C (одинаков
   для всех пар). Правый край последней карточки попадает ровно на W. */
function sizeTicketOverlap() {
    const n = ticketEls.length;
    if (n === 0) return;
    const w = sliderEl.clientWidth;
    const visible = n > 1 ? (w - TICKET_W) / (n - 1) : w;
    sliderEl.style.setProperty('--ticket-step', visible + 'px');
}

/* Разложить карточки под текущий activeTicket (снап-состояние, без анимации).
   Все карточки одинаковой ширины (231) и перекрыты (шаг --ticket-step); z-index
   убывает с удалением от активной → активная сверху и развёрнута, соседи под ней:
   те, что левее, выглядывают левым краем (номер+цена), правее — правым (×). */
function layoutTickets() {
    ticketEls.forEach((el, i) => {
        el.classList.toggle('active', i === activeTicket);
        el.style.zIndex = String(10 - Math.abs(i - activeTicket));
    });
}

function setActiveTicket(i) {
    const n = Math.max(0, Math.min(cart.length - 1, i));
    if (n === activeTicket) return;
    activeTicket = n;
    layoutTickets();
}

/* drag по карточкам → переключение активной; drag по пустоте → пан схемы (карта) */
function onTicketDown(e, el) {
    tDrag = { startX: e.clientX, startActive: activeTicket, pid: e.pointerId };
    try { el.setPointerCapture(e.pointerId); } catch {}
    sliderEl.classList.add('grabbing');
    e.preventDefault();
}
function onTicketMove(e) {
    if (!tDrag || e.pointerId !== tDrag.pid) return;
    const dx = e.clientX - tDrag.startX;
    // тащим влево (dx<0) → следующая карточка; снап к ближайшей
    setActiveTicket(tDrag.startActive + Math.round(-dx / TICKET_STEP));
}
function onTicketUp(e) {
    if (!tDrag || e.pointerId !== tDrag.pid) return;
    tDrag = null;
    sliderEl.classList.remove('grabbing');
}

/* --- CTA: сумма = сумме цен выбранных мест. Пустая корзина → кнопки нет. --- */
function renderCTA() {
    if (cart.length === 0) {
        ctaEl.style.display = 'none';
        ctaEl.innerHTML = '';
        return;
    }
    const total = cart.reduce((acc, s) => acc + (s.price || 0), 0);
    ctaEl.style.display = '';
    ctaEl.innerHTML =
        `<span>Оформить заказ на ${formatPrice(total)}</span>` +
        `<span class="cta-ico">${icoChevronRight}</span>`;
}

/* --- Корзина ↔ схема: выбор/снятие мест --- */
/* Перерисовать зависимые от корзины UI (галерея + CTA + отметки на схеме) */
function refreshCart() {
    renderTickets();
    renderCTA();
    if (renderSelection) renderSelection(seats);
}

/* Добавить место: отметить selected, положить в корзину, показать билет,
   центрировать схему на месте с приближением. Молча игнорируем 9-е место. */
function addSeat(seat) {
    if (cart.length >= MAX_SEATS) return;
    seat.selected = true;
    cart.push(seat);
    activeTicket = cart.length - 1;     // новый билет — активная карточка
    refreshCart();
    focusSeat(seat);
}

/* Убрать место: снять selected, выкинуть из корзины, вернуть в дефолт. */
function removeSeat(seat) {
    const i = cart.indexOf(seat);
    if (i === -1) return;
    seat.selected = false;
    cart.splice(i, 1);
    refreshCart();
}

/* Полный сброс корзины (смена сеанса): снять выбор со всех мест. */
function clearCart() {
    if (cart.length === 0) return;
    cart.forEach((s) => { s.selected = false; });
    cart.length = 0;
    refreshCart();
}

/* Центрировать+приблизить схему к месту (центр rect'а = x+4, y+4 в SVG-юнитах) */
const FOCUS_SCALE = 3;   // уровень приближения при выборе (место крупно + видны соседи)
function focusSeat(seat) {
    if (!hall) return;
    const x = +seat.el.getAttribute('x') + 4;
    const y = +seat.el.getAttribute('y') + 4;
    hall.focusOnSvgPoint(x, y, FOCUS_SCALE);
}

/* Тап по схеме → hit-test ближайшего места → выбрать/снять.
   Серые (occupied/unknown) места некликабельны. */
function findNearestSeat(sx, sy, maxR) {
    let best = null;
    let bestD = maxR;
    for (const s of seats) {
        const cx = +s.el.getAttribute('x') + 4;
        const cy = +s.el.getAttribute('y') + 4;
        const d = Math.hypot(cx - sx, cy - sy);
        if (d < bestD) { bestD = d; best = s; }
    }
    return best;
}
function handleTap(clientX, clientY) {
    const p = hall.clientToSvg(clientX, clientY);
    if (!p) return;
    const seat = findNearestSeat(p.x, p.y, 8);   // R=8 SVG-юнитов (место 8 + зазор)
    if (!seat) return;
    if (seat.status !== 'available') return;      // серое место — не выбирается
    if (seat.selected) { removeSeat(seat); return; }   // повторный тап — снять
    addSeat(seat);
}

/* --- Смена активного сеанса --- */
function setActive(id) {
    activeId = id;
    Object.entries(chipEls).forEach(([k, el]) => el.classList.toggle('active', k === id));
    const s = SESSIONS.find((x) => x.id === id) || SESSIONS[0];
    subEl.textContent = s.venue;
}
function onChipChange(id) {
    setActive(id);
    // смена сеанса: корзина сбрасывается (выбор не сохраняется между сеансами)
    clearCart();
    // и схема сбрасывается к загрузочному виду (зум/пан),
    // а через onInteractEnd разворачивает шапку из компакта
    hall.reset();
    centerActiveChip(scroller, chipEls[id]);
}

/* --- Компактификация шапки --- */
function applyCompact(on) {
    compact = on;
    const cls = TWEAKS.shrinkTitle && on;
    header.classList.toggle('compact', cls);
    header.classList.toggle('marquee', cls && TWEAKS.marquee);
    tabsWrap.classList.toggle('compact', on);
    // marquee активна только когда compact && shrinkTitle && marquee
    marquee.update(cls && TWEAKS.marquee);
    // при разворачивании/схлопывании — держим активный чип в зоне видимости
    centerActiveChip(scroller, chipEls[activeId]);
}

/* --- Пересчёт схемы под размеры вьюпорта ---
   Схема — cover-слой на весь вьюпорт (см. hall.js). Коробка .map-content
   заполняет вьюпорт через CSS (inset:0), JS лишь переприменяет viewBox под
   текущее состояние (после resize/смены высоты оверлеев). */
function fitHall() {
    if (hall) hall.refit();
}

/* --- Инлайн-SVG схемы (вектор в DOM, чёткий на зуме) --- */
let seats = [];            // модель мест (ряд/место/цена/секция/статус), см. js/seats.js
let renderSelection = null; // fn(seats) — перерисовать слой выбранных мест
function injectHall() {
    return fetch('assets/hall.svg')
        .then((r) => r.text())
        .then((svg) => {
            $('.hall-svg').innerHTML = svg;
            const svgEl = $('.hall-svg svg');
            // привязать к местам схемы данные (ряд/место/цена) + разметить DOM
            seats = buildSeats(svgEl);
            // слой selected-отметок поверх мест (оранжевый + галочка)
            renderSelection = createSelectionLayer(svgEl);
            window.__seats = seats;   // QA-хук: доступ к модели из консоли
        })
        .catch((e) => console.error('hall.svg load failed', e));
}

/* --- Инициализация --- */
const hallReady = injectHall();
renderTabs();
renderLegend();
renderTickets();
renderCTA();
setActive(activeId);

const hall = new HallViewport($('.map-viewport'), $('.map-content'), {
    compactionMode: TWEAKS.compactionMode,
    onInteractStart: () => applyCompact(true),
    onInteractEnd: () => applyCompact(false),
    // высоты плавающих оверлеев (шапка / нижний блок) — расширяют пан-слэк,
    // чтобы верхние/нижние места можно было вывести ИЗ-ПОД оверлеев
    topInset: () => (header ? header.getBoundingClientRect().height : 0),
    bottomInset: () => (floatingEl ? floatingEl.getBoundingClientRect().height : 0),
    // тап по схеме (не пан) → выбрать/снять место под указателем
    onTap: (cx, cy) => handleTap(cx, cy),
});

// стартовое центрирование активного чипа
centerActiveChip(scroller, chipEls[activeId]);

// вписать всю схему в кадр (contain) сразу и после первого лейаута
fitHall();
requestAnimationFrame(fitHall);

// пересчёт при смене размеров вьюпорта: перекрытие галереи + фит схемы,
// затем переприменить viewBox под новые размеры коробки
window.addEventListener('resize', () => {
    sizeTicketOverlap();
    fitHall();
    hall.panTo(hall.tx, hall.ty);   // реклампинг + перерисовка viewBox
});
requestAnimationFrame(sizeTicketOverlap);   // добор после первого лейаута

// QA-хук: #compact — форсировать компактный режим (без взаимодействия)
if (location.hash === '#compact') applyCompact(true);
// QA-хуки: #t0/#t1/#t2 — форсировать активный билет (проверка 3 состояний галереи)
if (location.hash === '#t1') setActiveTicket(1);
if (location.hash === '#t2') setActiveTicket(2);
// QA-хук: #drag — синтетический drag первой карточки влево (проверка pipeline pointer)
if (location.hash === '#drag' && ticketEls[0]) {
    const el = ticketEls[0];
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const P = (type, x) => el.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x, clientY: cy, bubbles: true }));
    P('pointerdown', cx); P('pointermove', cx - 130); P('pointerup', cx - 130);
}
// QA-хуки (после инъекции SVG): #zoom, #edgeL/#edgeR/#edgeT/#edgeB — зум+пан к краю
hallReady.then(() => {
    fitHall();   // SVG уже в DOM → отрисовать загрузочный viewBox через состояние (= min-зум)
    const h = location.hash;
    const BIG = 99999;
    if (h === '#zoom') hall.zoomTo(5);
    if (h === '#minzoom') { hall.zoomTo(5); hall.zoomTo(0); }  // зум-ин, затем зум-аут до упора (= загрузочный вид)
    if (h === '#edgeL') { hall.zoomTo(5); hall.panTo(BIG, 0); }
    if (h === '#edgeR') { hall.zoomTo(5); hall.panTo(-BIG, 0); }
    if (h === '#edgeT') { hall.zoomTo(5); hall.panTo(0, BIG); }
    if (h === '#edgeB') { hall.zoomTo(5); hall.panTo(0, -BIG); }

    /* ---- QA-хуки корзины/выбора мест ---- */
    const avail = () => seats.filter((s) => s.status === 'available');
    const occupied = () => seats.filter((s) => s.status === 'occupied');
    // реальный тап по центру rect'а места (проверка hit-testing сквозь весь пайплайн)
    const tapSeat = (s) => {
        const r = s.el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const P = (type) => mapViewportEl.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'mouse', clientX: cx, clientY: cy, bubbles: true }));
        P('pointerdown'); P('pointerup');
    };

    if (h === '#sel3') avail().slice(0, 3).forEach(addSeat);           // 3 места → 3 билета + сумма
    if (h === '#sel1') addSeat(avail()[0]);                            // 1 место → selected-вид + фокус
    if (h === '#selmax') avail().slice(0, 9).forEach(addSeat);         // 9 попыток → в корзине 8 (макс)
    if (h === '#selgrey') tapSeat(occupied()[0]);                      // тап по серому → ничего (корзина пуста, CTA нет)
    if (h === '#seltoggle') { const s = avail()[0]; addSeat(s); tapSeat(s); }  // выбрать и снять → пусто
    if (h === '#selx') { avail().slice(0, 2).forEach(addSeat); ticketEls[0].querySelector('.t-x').click(); }  // × первого билета → в корзине 1
    if (h === '#hittest') tapSeat(avail()[0]);                         // реальный тап выбирает место
    if (h === '#selchip') { avail().slice(0, 2).forEach(addSeat); onChipChange(SESSIONS[1].id); }  // смена чипа → корзина сброшена

    window.__cart = cart;                       // QA-доступ к корзине
    window.__addSeat = addSeat;                 // QA: программный выбор места
    window.__tapSeat = tapSeat;                 // QA: тап по месту
});
