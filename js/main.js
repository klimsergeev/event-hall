/* ============================================================
   Точка входа: собирает экран, связывает пан/зум ↔ компакт ↔ marquee.
   ============================================================ */
import { EVENT, SESSIONS, sessionTiers, sessionMin, MAX_SEATS, TWEAKS, formatPrice } from './data.js';
import { CompactTitle, alignActiveChip } from './header.js';
import { HallViewport } from './hall.js';
import { buildSeats, createSelectionLayer, applySessionPrices } from './seats.js';

/* --- Иконки (инлайн SVG) --- */
const icoChevronLeft =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 L5 8 L10 13"/></svg>';
const icoChevronRight =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5 L15 12 L9 19"/></svg>';
const icoCross =
    '<svg width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 5 L15 15 M15 5 L5 15"/></svg>';

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
const trackEl = $('.slider-track', sliderEl);
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
            `<span class="tab-price">от ${formatPrice(sessionMin(s))}</span>` +
            `<span class="tab-compact">` +
                `<span class="date">${s.date}</span>` +
                `<span class="sep"></span>` +
                `<span class="time">${s.time}</span>` +
            `</span>`;
        // активный чип некликабелен: реагируем только на клик по ДРУГОМУ чипу
        btn.addEventListener('click', () => { if (s.id !== activeId) onChipChange(s.id); });
        chipEls[s.id] = btn;
        scroller.appendChild(btn);
    });
}

/* Активный сеанс (объект) и его карта цен по цвету (для переоценки зала). */
function currentSession() {
    return SESSIONS.find((s) => s.id === activeId) || SESSIONS[0];
}
function priceMapFor(session) {
    return new Map(sessionTiers(session).map((t) => [t.color.toUpperCase(), t.price]));
}

/* --- Рендер легенды (цвет→цена АКТИВНОГО сеанса) --- */
function renderLegend() {
    legendEl.innerHTML = '';
    sessionTiers(currentSession()).forEach((t) => {
        const pill = document.createElement('span');
        pill.className = 'pill';
        pill.innerHTML = `<span class="sw" style="background:${t.color}"></span>${formatPrice(t.price)}`;
        legendEl.appendChild(pill);
    });
}

/* Переоценить зал под активный сеанс: цены мест (data-price) + легенда.
   Вызывается на старте (после инъекции SVG) и при смене сеанса. */
function repriceHall() {
    if (seats.length) applySessionPrices(seats, priceMapFor(currentSession()));
    renderLegend();
}

/* --- Корзина: выбранные места. Наполняется кликами по схеме, стартует ПУСТОЙ.
       Каждый элемент — объект-место из модели seats.js (ссылка), у него есть
       .seat/.row/.price/.selected. Максимум MAX_SEATS мест. --- */
const cart = [];

/* --- Галерея билетов: КАРУСЕЛЬ. Карточки едут по горизонтали. Якорь активной
       карточки зависит от её позиции в списке: первая → ЛЕВЫЙ край (peek справа),
       последняя → ПРАВЫЙ край (peek слева), середина → ЦЕНТР (peek с обеих сторон).
       Drag тянет трек ЗА ПАЛЬЦЕМ 1:1, по отпусканию — пружинный снап к ближайшей
       карточке (учёт скорости флика). Активная = последний выбранный на схеме
       билет; ручной свайп это переопределяет (активной становится ближайшая после
       снапа). Анимация перенесена из anim/carousel.js. --- */
/* Ширина карточек ПЕРЕМЕННАЯ (hug-content, Figma Hug у обоих состояний): неактивная
   узкая, активная шире (крупнее шрифт/паддинги/gap + крестик). Поэтому шаг между
   карточками (pitch) НЕ константа — геометрию карусели считаем по ФАКТИЧЕСКИМ
   offsetWidth (см. measureCards): cardW[i] — ширина карточки i, cardStart[i] — X её
   левого края внутри трека (кумулятивная сумма ширин + зазоров). */
const TICKET_GAP = 8;             // зазор между билетами (Figma: gap в карусели)

let activeTicket = 0;
const ticketEls = [];
let cardW = [];                   // фактическая ширина каждой карточки (offsetWidth)
let cardStart = [];               // X левого края карточки i внутри трека (кумулятивно)
let trackX = 0;                   // текущий сдвиг трека по X
let stopSpring = null;            // отмена активной пружины
let cardDX = [];                  // покадровый сдвиг каждой карточки по X (FLIP-реколл при удалении)
let reflowSpring = null;          // отмена пружины реколла соседей
let deleting = false;             // идёт анимация удаления — блок повторного удаления/драга

/* пружина (velocity-based, rAF) — из anim/carousel.js */
/* stiffness 840 (4× прежней 210 → ω вдвое выше → переход ~2× быстрее),
   damping 44 → ζ≈0.76: лёгкий overshoot ~2.5% (еле заметный баунс) */
function spring({ from, to, velocity = 0, stiffness = 840, damping = 44, mass = 1, onUpdate, onDone }) {
    let x = from, v = velocity, last = performance.now(), raf;
    const step = (now) => {
        let dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
        const h = dt / sub;
        for (let i = 0; i < sub; i++) {
            const a = (-stiffness * (x - to) - damping * v) / mass;
            v += a * h;
            x += v * h;
        }
        onUpdate(x, v);
        if (Math.abs(x - to) < 0.35 && Math.abs(v) < 0.35) {
            onUpdate(to, 0);
            onDone && onDone();
            return;
        }
        raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
}

/* Проставить класс active по текущему activeTicket. Должно вызываться ПЕРЕД
   measureCards при смене активной, т.к. активная карточка шире (hug) — её ширина
   меняется мгновенно (без width-transition), и measureCards должен прочитать уже
   финальные offsetWidth. */
function applyActiveClass() {
    ticketEls.forEach((el, i) => el.classList.toggle('active', i === activeTicket));
}

/* Замер фактических ширин карточек и кумулятивных X-позиций их левых краёв в треке.
   cardStart[i] = сумма ширин карточек 0..i-1 + i зазоров (как во flex-раскладке с gap).
   Читает offsetWidth (border-box, включает padding) — форсирует reflow, поэтому даёт
   уже settled-значение (width не анимируем → без промежуточных кадров). */
function measureCards() {
    cardW = ticketEls.map((el) => el.offsetWidth);
    cardStart = new Array(cardW.length);
    let x = 0;
    for (let i = 0; i < cardW.length; i++) {
        cardStart[i] = x;
        x += cardW[i] + TICKET_GAP;
    }
}

/* Якорь активной карточки во вьюпорте зависит от её позиции в списке:
     • первая (i=0)      → ЛЕВЫЙ край галереи (offset 0), peek справа;
     • последняя (i=n-1) → ПРАВЫЙ край (offset = W - cardW[i]), peek слева;
     • середина          → ЦЕНТР (offset = (W - cardW[i]) / 2), peek с обеих сторон.
   Ширина карточки cardW[i] — фактическая (переменная), поэтому центрирование/якорение
   учитывает реальную ширину именно этой карточки. Возвращает X левого края карточки i
   во вьюпорте в её «домашней» позиции. */
function anchorOffset(i) {
    const n = ticketEls.length;
    if (i <= 0) return 0;                              // первая — левый край
    const W = sliderEl.clientWidth;
    const w = cardW[i] || 0;
    if (i >= n - 1) return W - w;                      // последняя — правый край
    return (W - w) / 2;                               // середина — центр
}

/* позиция трека, при которой карточка i стоит в своём якоре (left/center/right).
   cardStart[i] — фактический левый край карточки в треке (сумма реальных ширин). */
function targetXFor(i) {
    return anchorOffset(i) - (cardStart[i] || 0);
}

/* индекс карточки, чья якорная позиция ближе всего к текущему сдвигу трека x */
function nearestIndex(x) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < ticketEls.length; i++) {
        const d = Math.abs(x - targetXFor(i));
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

function setTrackX(px) {
    trackX = px;
    trackEl.style.transform = `translateX(${px}px)`;
    paintDepth();
}

/* глубина + active-состояние: активная (в своём якоре) — развёрнута
   (Selected=True, h64), соседи свёрнуты (Selected=False, h52). Дистанцию
   меряем от ЯКОРЯ активной карточки (левый/центр/правый), а не от левого края.
   height/radius переключает класс active. Прозрачность НЕ трогаем — все карточки
   полностью непрозрачны.
   ВАЖНО: scale-глубину соседей УБРАЛИ. При scale вокруг центра карточка ужимается
   к центру и её отрисованный край отходит от соседа → видимый зазор становится
   больше layout-зазора (8px → ~17px у активной, ~26px между соседями). Чтобы
   РЕАЛЬНЫЙ (после трансформа) зазор был ровно 8px = TICKET_GAP, ширина рендера
   должна равняться layout-ширине, т.е. scale=1. Иерархию активной даёт разница
   высот (h64 vs h52), а не scale. */
function paintDepth() {
    const anchor = anchorOffset(activeTicket);                // якорь активной во вьюпорте
    ticketEls.forEach((el, i) => {
        const cardLeft = trackX + (cardStart[i] || 0);        // фактический левый край карточки i
        const pitch = (cardW[i] || 0) + TICKET_GAP;           // локальный шаг (переменный)
        const dist = pitch ? Math.abs(cardLeft - anchor) / pitch : 0;   // ~0 у активной, ~1 у соседа
        const t = Math.min(1, dist);
        // без scale → рендер-ширина = 231 → видимый зазор = 8px. cardDX[i]=0 в покое
        // (translateX(0) ≡ none); ненулевой — только во время FLIP-реколла соседей при удалении.
        el.style.transform = `translateX(${cardDX[i] || 0}px)`;
        el.style.zIndex = String(100 - Math.round(t * 10));   // peek-слои: активная поверх соседей
        el.classList.toggle('active', i === activeTicket);
    });
}

/* Снап пружиной: выровнять карточку i по левому краю (velocity — инерция флика) */
function snapTo(i, velocity = 0) {
    activeTicket = clamp(i, 0, ticketEls.length - 1);
    // новая активная карточка мгновенно разворачивается (шире) → сперва проставляем
    // класс и перемеряем ширины, только потом считаем целевую позицию трека.
    applyActiveClass();
    measureCards();
    if (stopSpring) { stopSpring(); stopSpring = null; }
    stopSpring = spring({
        from: trackX, to: targetXFor(activeTicket), velocity,
        onUpdate: (x) => setTrackX(x),
        onDone: () => { stopSpring = null; },
    });
}

/* Внешний API для QA-хуков/× неактивного: сделать i активной и выровнять по левому */
function setActiveTicket(i) {
    snapTo(i);
}

/* Рецентрирование без анимации (resize) */
function recenterTickets() {
    if (deleting) return;                         // не сбивать FLIP-реколл во время удаления
    if (!ticketEls.length) return;
    // activeTicket мог быть выставлен извне (QA-хуки #anchorL/C/R) — актуализируем
    // класс active и ширины перед расчётом целевой позиции.
    applyActiveClass();
    measureCards();
    setTrackX(targetXFor(activeTicket));
}

function renderTickets(opts = {}) {
    trackEl.innerHTML = '';
    ticketEls.length = 0;
    cardDX = new Array(cart.length).fill(0);   // FLIP-сдвиги обнуляются на каждом ререндере
    cart.forEach((tk, idx) => {
        const card = document.createElement('div');
        card.className = 'ticket';
        card.innerHTML =
            `<span class="t-text">` +
                `<span class="t-seat">${tk.row} ряд, ${tk.seat} место</span>` +
                `<span class="t-price">${formatPrice(tk.price)}</span>` +
            `</span>` +
            `<button class="t-x" type="button" aria-label="Убрать">${icoCross}</button>`;
        card.addEventListener('pointerdown', (e) => onTicketDown(e, card));
        card.addEventListener('pointermove', onTicketMove);
        card.addEventListener('pointerup', onTicketUp);
        card.addEventListener('pointercancel', onTicketUp);
        // × — удалить билет ТОЛЬКО если он активен; иначе первый клик центрирует
        // (делает активным), удаление — повторным кликом.
        // глушим pointerdown, чтобы кнопка не стартовала drag карточки
        const xBtn = card.querySelector('.t-x');
        xBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        xBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const i = ticketEls.indexOf(card);   // актуальный индекс на момент клика
            if (i === activeTicket) {
                deleteActiveTicket(i);            // активный билет — удаляем с fade-анимацией
            } else {
                setActiveTicket(i);
            }
        });
        ticketEls.push(card);
        trackEl.appendChild(card);
    });
    if (ticketEls.length === 0) { cardW = []; cardStart = []; setTrackX(0); return; }
    // клампим активную в новые границы и центрируем карусель на ней
    activeTicket = clamp(activeTicket, 0, ticketEls.length - 1);
    // проставить active-класс и замерить фактические ширины ПЕРЕД расчётом позиций
    // (активная карточка шире — hug); дальше геометрия считается по реальным ширинам.
    applyActiveClass();
    measureCards();
    // instant — мгновенно в целевую позицию (без пружины): нужно при удалении,
    // чтобы поверх мгновенного лейаута наложить FLIP-реколл соседей.
    if (opts.instant) setTrackX(targetXFor(activeTicket));
    else snapTo(activeTicket);
}

/* --- drag галереи: тянем трек за пальцем 1:1, по отпусканию — снап/флик.
       drag по карточке → карусель; drag по пустоте → пан схемы (не мешаем). --- */
let tDrag = null;
const TICKET_TAP = 8;             // px: движение меньше — это tap, а не drag
/* Правая зона активного билета = крестик × (padding-right 12 + иконка 24 = 36px)
   + комфортный буфер ~8px, суммарно 44px от ПРАВОГО края. Тап в этой зоне НЕ
   зумит схему (× удаляет своим хендлером; буфер вокруг × — no-op, чтобы на
   мобильном не промахнуться мимо удаления). Зона считается от r.right, поэтому
   устойчива к hug-ширине активного билета. */
const TICKET_X_ZONE = 44;

/* Тап пришёлся в правую зону (× + буфер) активной карточки index? */
function inTicketXZone(index, clientX) {
    const el = ticketEls[index];
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return clientX >= r.right - TICKET_X_ZONE;
}

function onTicketDown(e, el) {
    if (deleting) return;
    if (e.target.closest('.t-x')) return;
    if (stopSpring) { stopSpring(); stopSpring = null; }
    const t0 = performance.now();
    tDrag = {
        startX: e.clientX, startY: e.clientY,
        startTrack: trackX, pid: e.pointerId,
        lastX: e.clientX, lastT: t0, vx: 0,
        // окно последних сэмплов {t,x} для робастной оценки скорости флика
        // (одиночный last-frame занижает vx: палец тормозит перед отпусканием).
        samples: [{ t: t0, x: e.clientX }],
        index: ticketEls.indexOf(el),
    };
    try { el.setPointerCapture(e.pointerId); } catch {}
    sliderEl.classList.add('grabbing');
    e.preventDefault();
}

function onTicketMove(e) {
    if (!tDrag || e.pointerId !== tDrag.pid) return;
    const now = performance.now();
    const dt = now - tDrag.lastT;
    if (dt > 0) tDrag.vx = (e.clientX - tDrag.lastX) / dt * 1000;   // last-segment (шумный)
    tDrag.lastX = e.clientX;
    tDrag.lastT = now;
    // копим окно сэмплов; чистим всё старше VX_WINDOW от текущего момента
    tDrag.samples.push({ t: now, x: e.clientX });
    const cutoff = now - VX_WINDOW;
    let k = 0;
    while (k < tDrag.samples.length - 1 && tDrag.samples[k + 1].t < cutoff) k++;
    if (k > 0) tDrag.samples.splice(0, k);

    let x = tDrag.startTrack + (e.clientX - tDrag.startX);   // follow-the-finger 1:1
    // резина за краями
    const min = targetXFor(ticketEls.length - 1);
    const max = targetXFor(0);
    if (x > max) x = max + (x - max) * 0.35;
    if (x < min) x = min + (x - min) * 0.35;
    setTrackX(x);
}

/* --- Скорость жеста: РОБАСТНОЕ окно вместо last-frame ---
   Один последний сегмент перед отпусканием занижает скорость (палец тормозит),
   поэтому даже сильный флик давал низкий release-vx → карусель всегда шла +1.
   Берём среднюю скорость по последним VX_WINDOW мс: (Δx / Δt) на всём окне.
   Флик так надёжно отдаёт свою реальную высокую скорость. */
const VX_WINDOW = 70;             // мс: окно усреднения скорости отпускания
function windowedVX(samples, now) {
    if (!samples || samples.length < 2) return 0;
    const cutoff = now - VX_WINDOW;
    // первый сэмпл внутри окна (или предыдущий к нему, чтобы окно не схлопнулось)
    let i = samples.length - 1;
    while (i > 0 && samples[i - 1].t >= cutoff) i--;
    const a = samples[i], b = samples[samples.length - 1];
    const dt = b.t - a.t;
    return dt > 0 ? (b.x - a.x) / dt * 1000 : 0;
}

/* --- Маппинг «сила жеста → число шагов»: проекция инерции в ПЕЙЧАХ карточки ---
   Не привязываемся к магическим px/s. Тормозной путь флика proj = |vx|·VX_TAU
   (VX_TAU — время затухания инерции, с) делим на PITCH — фактический шаг НЕАКТИВНОЙ
   карточки (её ширина + зазор, ~128px). Округляем → сколько карточек пролетел бросок.
   Это self-calibrating к ширине карточек и НЕ зависит от сжатия якорей у краёв
   (важно: у левого края якорь 0→1 сжат до ~48px — проекция «на якорь» перескакивала
   бы соседа; счёт в пейчах карточки этого лишён). Достижение края — через clamp:
   у последней карточки якорь почти совпадает с предпоследним, так что сильный флик
   всегда доводит до края.
     • INTENT_FRACTION 0.32 — доля пути до соседа: прошли её → жест намеренный;
     • INTENT_VX 250 px/s — либо короткий, но быстрый флик тоже намеренный;
     • VX_TAU 0.26 c — тормозное время (замерено на реальных жестах: обычный свайп
       vx≈480–550 → ровно сосед; уверенный флик ≈1600 → +3; сильный ≈3400–3600 →
       через весь список до края). round(proj/PITCH): 1 шаг держится до vx≈770. */
const INTENT_FRACTION = 0.32;
const INTENT_VX = 250;
const VX_TAU = 0.26;

/* Дискретный выбор целевого индекса по параметрам жеста.
   cur — активный на старте жеста; n — число билетов; deltaX — смещение пальца по X
   (px; влево < 0); vx — РОБАСТНАЯ оконная скорость при отпускании (px/s; влево < 0);
   stepDist — расстояние до соседнего якоря (px, > 0; для порога намеренности);
   pitch — шаг неактивной карточки (px; единица счёта шагов; опц. → fallback stepDist).
   Направление — от ЗНАКА жеста; дальность — проекция инерции в пейчах карточки. */
function chooseTicketTarget({ cur, n, deltaX, vx, stepDist, pitch }) {
    // свайп влево (deltaX < 0) → следующий билет (+1); при нулевом смещении — по vx
    let dir = deltaX < 0 ? 1 : deltaX > 0 ? -1 : 0;
    if (dir === 0) dir = vx < 0 ? 1 : vx > 0 ? -1 : 0;
    if (dir === 0) return cur;

    const travel = Math.abs(deltaX);
    const speed = Math.abs(vx);
    // намеренность: прошли заметную долю пути ЛИБО фликнули достаточно быстро
    const intentional = travel >= stepDist * INTENT_FRACTION || speed >= INTENT_VX;

    const P = pitch > 0 ? pitch : (stepDist > 0 ? stepDist : 1);
    const proj = speed * VX_TAU;                      // тормозной путь инерции, px
    let steps = Math.round(proj / P);                 // сколько карточек пролетел бросок
    if (!intentional && steps < 1) return cur;        // слабый свайп → снап на текущий
    if (steps < 1) steps = 1;                         // намеренный → минимум сосед
    return clamp(cur + dir * steps, 0, n - 1);        // насыщение до края списка
}

function onTicketUp(e) {
    if (!tDrag || e.pointerId !== tDrag.pid) return;
    const d = tDrag;
    tDrag = null;
    sliderEl.classList.remove('grabbing');
    const moved = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
    if (moved < TICKET_TAP) {
        // tap по НЕактивной карточке (любая её область) → активировать и центрировать
        if (d.index !== -1 && d.index !== activeTicket) { snapTo(d.index); return; }
        // tap по АКТИВНОЙ карточке ВНЕ зоны ×+буфер → подзум схемы на место этого
        // билета (тот же зум/центрирование, что при выборе места на схеме).
        // Место НЕ удаляется, корзина/активность не меняются. В зоне ×+буфер — no-op
        // (сам × удаляет своим click-хендлером; его pointerdown не стартует tDrag).
        if (d.index === activeTicket && !inTicketXZone(d.index, e.clientX)) {
            const seat = cart[d.index];
            if (seat) focusSeat(seat);
        }
        return;
    }
    // ручной свайп: целевой индекс ДИСКРЕТНО от текущего активного — направление по
    // знаку жеста, число шагов по скорости флика (см. chooseTicketTarget). Позицию
    // momentum НЕ используем для выбора индекса: узкие карточки иначе перескакивают.
    const cur = activeTicket;
    const n = ticketEls.length;
    const deltaX = e.clientX - d.startX;
    // РОБАСТНАЯ скорость отпускания по окну (не шумный last-frame d.vx)
    const vxWin = windowedVX(d.samples, performance.now());
    // расстояние по треку до соседа в сторону жеста (для порога намеренности).
    // targetXFor читается при текущем активном (cur шире) — реальная геометрия снапа.
    const dirGuess = deltaX < 0 ? 1 : deltaX > 0 ? -1 : (vxWin < 0 ? 1 : -1);
    const nb = clamp(cur + dirGuess, 0, n - 1);
    const stepDist = Math.abs(targetXFor(nb) - targetXFor(cur)) || ((cardW[cur] || 0) + TICKET_GAP);
    // PITCH — шаг НЕАКТИВНОЙ карточки (её ширина + зазор). Единица счёта шагов флика,
    // устойчивая к сжатию якорей у краёв. nb инактивна при cur-активном → её ширина.
    const pitch = ((cardW[nb] || cardW[cur] || 0) + TICKET_GAP);
    const target = chooseTicketTarget({ cur, n, deltaX, vx: vxWin, stepDist, pitch });
    // QA-хук: состояние жеста в момент отпускания (для детерминированной проверки)
    window.__lastTicketRelease = {
        cur, target, deltaX, stepDist, trackX,        // trackX — позиция трека при отпускании
        vxLast: d.vx, vxWin,                          // last-frame vs робастное окно
        steps: Math.abs(target - cur),
    };
    // тот же velocity-based пружинный снап — меняется только целевой индекс.
    // В пружину отдаём оконную скорость: анимация соответствует силе флика.
    snapTo(target, vxWin);
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* --- Подложка галереи: видна только при непустой корзине. Пустая корзина →
   display:none, чтобы белый градиент не рисовался и высота не резервировалась
   (низ схемы зала не перекрывается белой пеленой). --- */
function syncFloating() {
    if (!floatingEl) return;
    floatingEl.style.display = cart.length === 0 ? 'none' : '';
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
        `<span>Оформить: ${formatPrice(total)}</span>`;
}

/* --- Корзина ↔ схема: выбор/снятие мест --- */
/* Перерисовать зависимые от корзины UI (галерея + CTA + отметки на схеме) */
function refreshCart() {
    renderTickets();
    renderCTA();
    syncFloating();
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

/* Убрать место: снять selected, выкинуть из корзины, вернуть в дефолт.
   Мгновенный путь (тап по месту на схеме). Удаление через × активного билета
   идёт через deleteActiveTicket (с fade-анимацией). */
function removeSeat(seat) {
    const i = cart.indexOf(seat);
    if (i === -1) return;
    seat.selected = false;
    cart.splice(i, 1);
    refreshCart();
}

/* ============================================================
   Удаление активного билета — CONCEPT «fade» (портирован из anim/del-fade.js).
   Тайминги:
     • exit-клон уходящей карточки: scale 1→.2 + opacity 1→0 на месте
       (origin center), 140ms, cubic-bezier(.4,0,1,1) — быстрое «схлопывание точкой»;
       рисуется поверх слайдера вне потока, чтобы не ломать layout карусели;
     • реколл соседей: FLIP + velocity-spring (stiffness 940 / damping 41, ζ≈0.67) —
       карточки плавно закрывают зазор на месте удалённой.
   deleting-флаг блокирует повторное удаление/драг во время анимации.
   Боевая логика удаления (снять selected, splice корзины, пересчёт CTA, схема
   в дефолт, пустая корзина → скрыть кнопку) — сохранена, идёт синхронно. */
const EXIT_MS = 140;
const EXIT_EASING = 'cubic-bezier(.4,0,1,1)';

function spawnExit(leavingEl) {
    const sr = sliderEl.getBoundingClientRect();
    const lr = leavingEl.getBoundingClientRect();
    const clone = leavingEl.cloneNode(true);
    clone.classList.add('exit-clone');
    if (leavingEl.classList.contains('active')) clone.classList.add('active');
    clone.style.left = (lr.left - sr.left) + 'px';
    clone.style.top = (lr.top - sr.top) + 'px';
    clone.style.width = lr.width + 'px';
    clone.style.height = lr.height + 'px';
    clone.style.transformOrigin = 'center center';
    clone.style.transition = `transform ${EXIT_MS}ms ${EXIT_EASING}, opacity ${EXIT_MS}ms ${EXIT_EASING}`;
    sliderEl.appendChild(clone);
    requestAnimationFrame(() => {
        clone.style.transform = 'scale(.2)';
        clone.style.opacity = '0';
    });
    setTimeout(() => clone.remove(), EXIT_MS + 60);
}

function deleteActiveTicket(idx) {
    if (deleting) return;
    const seat = cart[idx];
    if (!seat) return;
    deleting = true;
    if (stopSpring) { stopSpring(); stopSpring = null; }   // погасить возможный снап
    const leavingEl = ticketEls[idx];

    // FLIP: запомнить X оставшихся карточек ДО удаления (ключ — объект-место, стабильная ссылка)
    const firstMap = new Map();
    ticketEls.forEach((el, i) => { if (i !== idx) firstMap.set(cart[i], el.getBoundingClientRect().left); });

    spawnExit(leavingEl);

    // --- боевая логика удаления (без изменений по сути) ---
    seat.selected = false;              // место схемы → дефолт
    cart.splice(idx, 1);                // выкинуть из корзины
    renderCTA();                        // пересчитать сумму / скрыть кнопку при пустой корзине
    if (renderSelection) renderSelection(seats);   // перерисовать отметки на схеме

    if (cart.length === 0) {
        renderTickets();
        // последний билет уходит с fade: exit-клон живёт внутри .floating > .slider,
        // поэтому подложку прячем ПОСЛЕ завершения exit-анимации (иначе display:none
        // мгновенно оборвёт fade). Тайминг = удаление клона в spawnExit.
        setTimeout(syncFloating, EXIT_MS + 60);
        deleting = false;
        return;
    }

    activeTicket = clamp(idx, 0, cart.length - 1);
    renderTickets({ instant: true });   // мгновенный лейаут без пружины

    // FLIP invert: сдвинуть каждую карточку обратно к её прежней позиции
    const dx0 = ticketEls.map((el, i) => {
        const f = firstMap.get(cart[i]);
        const l = el.getBoundingClientRect().left;
        return f == null ? 0 : (f - l);
    });
    cardDX = dx0.slice();
    setTrackX(trackX);

    // play: пружина ведёт сдвиги к 0 — соседи плавно закрывают зазор
    if (reflowSpring) reflowSpring();
    reflowSpring = spring({
        from: 1, to: 0, stiffness: 940, damping: 41,
        onUpdate: (p) => { for (let i = 0; i < cardDX.length; i++) cardDX[i] = dx0[i] * p; setTrackX(trackX); },
        onDone: () => { cardDX = cardDX.map(() => 0); setTrackX(trackX); reflowSpring = null; deleting = false; },
    });
}

/* Полный сброс корзины (смена сеанса): снять выбор со всех мест. */
function clearCart() {
    if (cart.length === 0) return;
    cart.forEach((s) => { s.selected = false; });
    cart.length = 0;
    refreshCart();
}

/* Центрировать+приблизить схему к месту (центр rect'а = x+4, y+4 в SVG-юнитах) */
const FOCUS_SCALE = 1.8;   // уровень приближения при выборе (мягкий: место видно + видны соседи, без гипер-зума)
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
    if (deleting) return;                         // не трогаем корзину во время анимации удаления
    const p = hall.clientToSvg(clientX, clientY);
    if (!p) return;
    const seat = findNearestSeat(p.x, p.y, 8);   // R=8 SVG-юнитов (место 8 + зазор)
    // Попадание в ДОСТУПНОЕ место → выбрать/снять + подзум (поведение как раньше)
    if (seat && seat.status === 'available') {
        if (seat.selected) { removeSeat(seat); return; }   // повторный тап — снять
        addSeat(seat);
        return;
    }
    // Промах (пустая область ИЛИ серое/недоступное место): только на МИНИМАЛЬНОМ
    // масштабе подзумливаем по точке тапа, как при выборе места, но БЕЗ выбора
    // (корзина не меняется). Если уже подзумлен — ничего не делаем (как раньше).
    if (hall.atMinScale()) {
        hall.focusOnSvgPoint(p.x, p.y, FOCUS_SCALE);
    }
}

/* --- Смена активного сеанса --- */
function setActive(id) {
    activeId = id;
    Object.entries(chipEls).forEach(([k, el]) => el.classList.toggle('active', k === id));
    const s = SESSIONS.find((x) => x.id === id) || SESSIONS[0];
    subEl.textContent = s.venue;
    // зал переоценивается под сеанс: цены мест + легенда
    repriceHall();
}
function onChipChange(id) {
    setActive(id);
    // смена сеанса: корзина сбрасывается (выбор не сохраняется между сеансами)
    clearCart();
    // и схема сбрасывается к загрузочному виду (зум/пан),
    // а через onInteractEnd разворачивает шапку из компакта
    hall.reset();
    // ставший активным чип: левый край ленты (последний — правый край).
    // Без центрирования и без перемотки через начало — чистый одиночный скролл.
    const isLast = SESSIONS.findIndex((s) => s.id === id) === SESSIONS.length - 1;
    alignActiveChip(scroller, chipEls[id], isLast);
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
    // БЕЗ автоцентрирования при разворачивании/схлопывании: разворот (компакт→полный)
    // = обратная анимация сжатию, чипы растут на месте, лента НЕ перематывается
    // (scrollLeft сохраняется).
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
            // переоценить зал под активный сеанс (цены мест + легенда)
            repriceHall();
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
syncFloating();
setActive(activeId);

const hall = new HallViewport($('.map-viewport'), $('.map-content'), {
    compactionMode: TWEAKS.compactionMode,
    onInteractStart: () => applyCompact(true),
    onInteractEnd: () => applyCompact(false),
    // высоты плавающих оверлеев (шапка / нижний блок) — расширяют пан-слэк,
    // чтобы верхние/нижние места можно было вывести ИЗ-ПОД оверлеев
    topInset: () => (header ? header.getBoundingClientRect().height : 0),
    bottomInset: () => (floatingEl ? floatingEl.getBoundingClientRect().height : 0),
    // Оффсет покоя: при ПУСТОЙ корзине (загрузка — снизу нет кнопки) опускаем
    // вписанную схему на половину высоты развёрнутой шапки, чтобы вертикальный
    // воздух распределился симметрично, а не сваливался весь вниз. Есть билеты
    // (кнопка снизу) → 0 → композиция как раньше.
    restOffsetY: () => (cart.length === 0 && header ? header.getBoundingClientRect().height / 2 : 0),
    // тап по схеме (не пан) → выбрать/снять место под указателем
    onTap: (cx, cy) => handleTap(cx, cy),
});
window.__hall = hall;   // QA-хук: доступ к вьюпорту схемы из консоли/тестов

// стартовое выравнивание активного чипа (по умолчанию — левый край; последний — правый)
{
    const isLast = SESSIONS.findIndex((s) => s.id === activeId) === SESSIONS.length - 1;
    alignActiveChip(scroller, chipEls[activeId], isLast);
}

// вписать всю схему в кадр (contain) сразу и после первого лейаута
fitHall();
requestAnimationFrame(fitHall);

// пересчёт при смене размеров вьюпорта: рецентрирование карусели + фит схемы,
// затем переприменить viewBox под новые размеры коробки
window.addEventListener('resize', () => {
    recenterTickets();
    fitHall();
    hall.panTo(hall.tx, hall.ty);   // реклампинг + перерисовка viewBox
});
requestAnimationFrame(recenterTickets);   // добор после первого лейаута

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
    if (h === '#selx') { avail().slice(0, 2).forEach(addSeat); const x = ticketEls[0].querySelector('.t-x'); x.click(); x.click(); }  // × неактивного первого билета: клик1 активирует, клик2 удаляет → в корзине 1
    if (h === '#selxinactive') { avail().slice(0, 2).forEach(addSeat); ticketEls[0].querySelector('.t-x').click(); }  // × НЕактивного билета → только активируется, в корзине 2
    if (h === '#selbodyinactive') {  // tap по ТЕЛУ НЕактивного билета → активируется, в корзине 2
        avail().slice(0, 2).forEach(addSeat);   // activeTicket = 1 (последний)
        const el = ticketEls[0];                // билет 0 — НЕактивный
        const r = el.getBoundingClientRect();
        const cx = r.left + 20, cy = r.top + r.height / 2;   // тело карточки, не ×
        const P = (type) => el.dispatchEvent(new PointerEvent(type, { pointerId: 3, clientX: cx, clientY: cy, bubbles: true }));
        P('pointerdown'); P('pointerup');
    }
    if (h === '#selxactive') { avail().slice(0, 2).forEach(addSeat); ticketEls[activeTicket].querySelector('.t-x').click(); }  // × активного билета → удаляется, в корзине 1
    if (h === '#hittest') tapSeat(avail()[0]);                         // реальный тап выбирает место
    if (h === '#selchip') { avail().slice(0, 2).forEach(addSeat); onChipChange(SESSIONS[1].id); }  // смена чипа → корзина сброшена

    /* ---- QA-хуки удаления (fade) ---- */
    // #delfade — 3 билета, активный средний, живой прогон удаления через 400ms
    if (h === '#delfade') {
        avail().slice(0, 3).forEach(addSeat);
        activeTicket = 1; recenterTickets();
        setTimeout(() => deleteActiveTicket(activeTicket), 400);
    }
    // #delframe — заморозить ~50% кадр удаления среднего билета (клон уменьшен, сосед на полпути)
    if (h === '#delframe') {
        avail().slice(0, 3).forEach(addSeat);
        activeTicket = 1; recenterTickets();
        const idx = activeTicket;
        const leavingEl = ticketEls[idx];
        const firstMap = new Map();
        ticketEls.forEach((el, i) => { if (i !== idx) firstMap.set(cart[i], el.getBoundingClientRect().left); });
        const sr = sliderEl.getBoundingClientRect();
        const lr = leavingEl.getBoundingClientRect();
        const clone = leavingEl.cloneNode(true);
        clone.classList.add('exit-clone');
        if (leavingEl.classList.contains('active')) clone.classList.add('active');
        clone.style.left = (lr.left - sr.left) + 'px';
        clone.style.top = (lr.top - sr.top) + 'px';
        clone.style.width = lr.width + 'px';
        clone.style.height = lr.height + 'px';
        clone.style.transformOrigin = 'center center';
        clone.style.transform = 'scale(.6)';   // середина уменьшения
        clone.style.opacity = '0.45';
        sliderEl.appendChild(clone);
        const seat = cart[idx]; seat.selected = false;
        cart.splice(idx, 1); renderCTA(); if (renderSelection) renderSelection(seats);
        activeTicket = clamp(idx, 0, cart.length - 1);
        renderTickets({ instant: true });
        ticketEls.forEach((el, i) => {
            const f = firstMap.get(cart[i]);
            const l = el.getBoundingClientRect().left;
            cardDX[i] = f == null ? 0 : (f - l) * 0.5;   // сосед на полпути
        });
        setTrackX(trackX);
        deleting = true;
    }

    /* ---- QA-хуки якоря галереи (3 билета, активный k, без анимации) ---- */
    const anchorTest = (k) => {
        avail().slice(0, 3).forEach(addSeat);
        if (stopSpring) { stopSpring(); stopSpring = null; }
        activeTicket = k;
        recenterTickets();                      // мгновенно в целевую позицию
    };
    if (h === '#anchorL') anchorTest(0);        // первый активен → влево, peek справа
    if (h === '#anchorC') anchorTest(1);        // средний активен → центр, peek с обеих сторон
    if (h === '#anchorR') anchorTest(2);        // последний активен → вправо, peek слева

    window.__cart = cart;                       // QA-доступ к корзине
    window.__addSeat = addSeat;                 // QA: программный выбор места
    window.__tapSeat = tapSeat;                 // QA: тап по месту
    window.__chooseTicketTarget = chooseTicketTarget;  // QA: детерминированный выбор индекса снапа

    /* QA: прогнать РЕАЛИСТИЧНЫЙ жест по карусели через НАСТОЯЩИЕ события
       (pointerdown → серия pointermove с реальным таймингом → pointerup).
       toStart — сделать активным индекс перед жестом; moves — [{dx, dt(мс)}].
       Возвращает состояние отпускания (__lastTicketRelease) + итоговый activeTicket. */
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    window.__runTicketGesture = async ({ toStart, moves = [], settle = 480 } = {}) => {
        if (typeof toStart === 'number') { setActiveTicket(toStart); await sleep(settle); }
        const el = ticketEls[activeTicket];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        let x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const id = 1;
        const pe = (type, cx) => new PointerEvent(type, {
            pointerId: id, clientX: cx, clientY: y,
            bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true,
        });
        el.dispatchEvent(pe('pointerdown', x));
        for (const m of moves) {
            await sleep(m.dt);
            x += m.dx;
            el.dispatchEvent(pe('pointermove', x));
        }
        el.dispatchEvent(pe('pointerup', x));
        await sleep(settle);
        return { ...window.__lastTicketRelease, activeTicket };
    };
});
