/* ============================================================
   Точка входа: собирает экран, связывает пан/зум ↔ компакт ↔ marquee.
   ============================================================ */
import { EVENT, SESSIONS, TIERS, TICKETS, CTA_TOTAL, TWEAKS, formatPrice } from './data.js';
import { CompactTitle, centerActiveChip } from './header.js';
import { HallViewport } from './hall.js';
import { buildSeats } from './seats.js';

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

/* --- Галерея билетов: карточки строятся ОДИН раз, активная переключается
       классами (без пересборки DOM), drag по горизонтали снапит к соседней --- */
let activeTicket = 0;
const ticketEls = [];
let tDrag = null;                 // { startX, startActive, pid }
const TICKET_STEP = 64;           // px перетаскивания на одну карточку

function renderTickets() {
    sliderEl.innerHTML = '';
    ticketEls.length = 0;
    TICKETS.forEach((tk, i) => {
        const card = document.createElement('div');
        card.className = 'ticket';
        card.innerHTML =
            `<span class="t-text">` +
                `<span class="t-seat">${tk.seat} место, ${tk.row} ряд</span>` +
                `<span class="t-price">${tk.price}</span>` +
            `</span>` +
            `<button class="t-x" type="button" aria-label="Убрать">${icoCross}</button>`;
        card.addEventListener('pointerdown', (e) => onTicketDown(e, card));
        card.addEventListener('pointermove', onTicketMove);
        card.addEventListener('pointerup', onTicketUp);
        card.addEventListener('pointercancel', onTicketUp);
        ticketEls.push(card);
        sliderEl.appendChild(card);
    });
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
    const n = Math.max(0, Math.min(TICKETS.length - 1, i));
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

/* --- CTA --- */
function renderCTA() {
    ctaEl.innerHTML =
        `<span>Оформить заказ на ${CTA_TOTAL}</span>` +
        `<span class="cta-ico">${icoChevronRight}</span>`;
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
    if (compact) {
        hall.reset();          // сброс зума/пана → разворот шапки через onInteractEnd
    }
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
let seats = [];   // модель мест (ряд/место/цена/секция/статус), см. js/seats.js
function injectHall() {
    return fetch('assets/hall.svg')
        .then((r) => r.text())
        .then((svg) => {
            $('.hall-svg').innerHTML = svg;
            // привязать к местам схемы данные (ряд/место/цена) + разметить DOM
            seats = buildSeats($('.hall-svg svg'));
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
if (location.hash === '#drag') {
    const el = ticketEls[0];
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const P = (type, x) => el.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x, clientY: cy, bubbles: true }));
    P('pointerdown', cx); P('pointermove', cx - 130); P('pointerup', cx - 130);
}
// QA-хуки (после инъекции SVG): #zoom, #edgeL/#edgeR/#edgeT/#edgeB — зум+пан к краю
hallReady.then(() => {
    const h = location.hash;
    const BIG = 99999;
    if (h === '#zoom') hall.zoomTo(5);
    if (h === '#edgeL') { hall.zoomTo(5); hall.panTo(BIG, 0); }
    if (h === '#edgeR') { hall.zoomTo(5); hall.panTo(-BIG, 0); }
    if (h === '#edgeT') { hall.zoomTo(5); hall.panTo(0, BIG); }
    if (h === '#edgeB') { hall.zoomTo(5); hall.panTo(0, -BIG); }
});
