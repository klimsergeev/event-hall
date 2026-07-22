/* ============================================================
   Точка входа: собирает экран, связывает пан/зум ↔ компакт ↔ marquee.
   ============================================================ */
import { EVENT, SESSIONS, TIERS, TICKETS, CTA_TOTAL, TWEAKS } from './data.js';
import { CompactTitle, centerActiveChip } from './header.js';
import { HallViewport } from './hall.js';

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
        pill.innerHTML = `<span class="sw" style="background:${t.color}"></span>${t.label}`;
        legendEl.appendChild(pill);
    });
}

/* --- Рендер билетов (перекрывающиеся карточки) --- */
function renderTickets() {
    sliderEl.innerHTML = '';
    const pos = ['front', 'mid', 'back'];
    TICKETS.forEach((tk, i) => {
        const card = document.createElement('div');
        card.className = 'ticket ' + (pos[i] || 'back');
        card.innerHTML =
            `<span class="t-text">` +
                `<span class="t-seat">${tk.seat} место, ${tk.row} ряд</span>` +
                `<span class="t-price">${tk.price}</span>` +
            `</span>` +
            `<button class="t-x" type="button" aria-label="Убрать">${icoCross}</button>`;
        sliderEl.appendChild(card);
    });
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

/* --- Инлайн-SVG схемы (вектор в DOM, чёткий на зуме) --- */
function injectHall() {
    return fetch('assets/hall.svg')
        .then((r) => r.text())
        .then((svg) => { $('.hall-svg').innerHTML = svg; })
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
    // высота нижнего плавающего блока — чтобы можно было допанорамировать
    // низ схемы ВЫШЕ него (иначе нижние места остаются под оверлеем)
    bottomInset: () => (floatingEl ? floatingEl.getBoundingClientRect().height : 0),
});

// стартовое центрирование активного чипа
centerActiveChip(scroller, chipEls[activeId]);

// QA-хук: #compact — форсировать компактный режим (без взаимодействия)
if (location.hash === '#compact') applyCompact(true);
// QA-хуки (после инъекции SVG): #zoom, #edgeL/#edgeR/#edgeT/#edgeB — зум+пан к краю
hallReady.then(() => {
    const h = location.hash;
    const BIG = 99999;
    if (h === '#zoom') hall.zoomTo(2.6);
    if (h === '#edgeL') { hall.zoomTo(2.6); hall.panTo(BIG, 0); }
    if (h === '#edgeR') { hall.zoomTo(2.6); hall.panTo(-BIG, 0); }
    if (h === '#edgeT') { hall.zoomTo(2.6); hall.panTo(0, BIG); }
    if (h === '#edgeB') { hall.zoomTo(2.6); hall.panTo(0, -BIG); }
});
