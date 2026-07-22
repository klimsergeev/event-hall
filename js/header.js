/* ============================================================
   Шапка: бегущая строка (Web Animations API) + автоцентр чипа.
   Порт логики из handoff/header.jsx (CompactTitle, ChipBar).
   Тайминги/keyframes/пороги — как в референсе (выверены).
   ============================================================ */

/* --- Бегущая строка заголовка (компакт) --- */
export class CompactTitle {
    /* els: { inner, wrap, fadeL, fadeR } */
    constructor(els) {
        this.els = els;
        this.anims = [];
    }

    /* active — активна ли marquee (compact && shrinkTitle && marquee) */
    update(active) {
        const { inner, wrap, fadeL, fadeR } = this.els;

        // снять текущие анимации
        this.anims.forEach((a) => a.cancel());
        this.anims = [];
        if (inner) inner.style.transform = 'translateX(0)';
        if (fadeL) fadeL.style.opacity = '0';
        if (fadeR) fadeR.style.opacity = '0';
        if (!active || !inner || !wrap) return;

        // переполнение относительно фиксированного окна
        const overflow = inner.scrollWidth - wrap.clientWidth;
        if (overflow <= 1) return; // помещается — не двигаем

        const PAUSE = 2000;        // пауза в начале и конце
        const SPEED = 31;          // px/сек
        const scroll = (overflow / SPEED) * 1000;
        const total = PAUSE + scroll + PAUSE;
        const k1 = PAUSE / total;                // конец стартовой паузы
        const k2 = (PAUSE + scroll) / total;     // конец проезда
        const ramp = Math.min(0.05, (k2 - k1) / 4);
        const opts = { duration: total, iterations: Infinity, easing: 'linear' };

        const animInner = inner.animate([
            { transform: 'translateX(0)', offset: 0 },
            { transform: 'translateX(0)', offset: k1 },
            { transform: `translateX(${-overflow}px)`, offset: k2 },
            { transform: `translateX(${-overflow}px)`, offset: 1 },
        ], opts);

        const animL = fadeL && fadeL.animate([
            { opacity: 0, offset: 0 },
            { opacity: 0, offset: k1 },
            { opacity: 1, offset: Math.min(k2, k1 + ramp) },
            { opacity: 1, offset: 1 },
        ], opts);

        const animR = fadeR && fadeR.animate([
            { opacity: 1, offset: 0 },
            { opacity: 1, offset: Math.max(k1, k2 - ramp) },
            { opacity: 0, offset: k2 },
            { opacity: 0, offset: 1 },
        ], opts);

        this.anims = [animInner, animL, animR].filter(Boolean);
    }
}

/* --- Выравнивание активного чипа в ленте (АНИМИРОВАННО) --- */
/* Ставший активным чип встаёт ЛЕВЫМ краем к внутреннему левому краю .scroller
   (с учётом padding-left). Исключение — ПОСЛЕДНИЙ чип: лента доскроллена до конца
   (scrollLeft = max), чип у правого края. Скролл к этой позиции — БЫСТРЫЙ ПЛАВНЫЙ
   (rAF-спринг), без перемотки через начало.

   Механика: каждый кадр ПЕРЕСЧИТЫВАЕМ целевой scrollLeft и двигаем к нему текущий
   scrollLeft спрингом. Почему спринг с пересчётом цели каждый кадр, а не
   behavior:'smooth':
   • РАЗВОРОТ ИЗ КОМПАКТА (реальный сценарий): onChipChange зовёт alignActiveChip,
     когда лента ещё .compact; hall.reset() снимает .compact НЕ сразу (в середине
     своего 260ms-твина), после чего ширины чипов анимируются ~220ms (пилюля→156px).
     offsetLeft/scrollWidth всё это время растут — ЦЕЛЬ ДВИЖЕТСЯ. behavior:'smooth'
     нацеливается один раз и не доезжает до финала (прошлый баг). Спринг догоняет
     движущуюся цель и садится в ФИНАЛ. Выход — по СОСТОЯНИЮ (лента уже НЕ .compact
     И ширина чипа замерла) И сходимости спринга, а не по таймеру.
   • УЖЕ РАЗВЁРНУТО (смена даты без сжатия): геометрия финальна сразу → спринг просто
     плавно доезжает от текущей позиции к цели.
   Применяем позицию через scrollTo behavior:'instant' — это перекрывает CSS
   scroll-behavior:smooth (иначе браузер добавил бы СВОЮ анимацию поверх спринга),
   каждый кадр ставим ровно вычисленное спрингом значение. scrollLeft стартует с
   ТЕКУЩЕЙ позиции → нет прыжка в 0.

   Спринг критически демпфирован (ζ≈1): без overshoot, чтобы лента не выезжала за
   край и не «баунсила». Тайминг быстрый (τ≈33мс, оседание ~130–180мс). */
const ALIGN_STIFFNESS = 900;               // жёсткость: τ = 1/√k ≈ 33мс
const ALIGN_DAMPING = 60;                  // 2·√k — критическое демпфирование, без перелёта

export function alignActiveChip(scroller, activeEl, isLast = false) {
    if (!scroller || !activeEl) return;
    const tabs = scroller.parentElement;   // .tabs (обёртка scroller)

    // целевой scrollLeft для ТЕКУЩЕЙ геометрии (пересчитывается каждый кадр)
    const computeTarget = () => {
        const maxScroll = scroller.scrollWidth - scroller.clientWidth;
        let target;
        if (isLast) {
            target = maxScroll;                       // последний — правый край фрейма
        } else {
            const padL = parseFloat(getComputedStyle(scroller).paddingLeft) || 0;
            target = activeEl.offsetLeft - padL;      // левый край с учётом padding
        }
        return Math.max(0, Math.min(target, maxScroll));
    };
    // мгновенно выставить scrollLeft в обход CSS scroll-behavior:smooth
    const apply = (x) => scroller.scrollTo({ left: x, behavior: 'instant' });

    requestAnimationFrame(() => {
        let x = scroller.scrollLeft;       // старт с текущей позиции — без прыжка в 0
        let v = 0;                         // скорость спринга, px/сек
        let last = performance.now();
        const t0 = last;
        // детект «геометрия замерла» — по состоянию, как раньше (надёжнее таймера)
        let prevW = -1, stable = 0, wasCompact = tabs && tabs.classList.contains('compact');

        const step = (now) => {
            // быструю смену чипа перехватывает новый вызов — этот прекращаем
            if (!activeEl.classList.contains('active')) return;

            const target = computeTarget();
            // интеграция спринга с субшагами (устойчивость при просадках FPS)
            let dt = Math.min((now - last) / 1000, 1 / 30);
            last = now;
            const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
            const h = dt / sub;
            for (let i = 0; i < sub; i++) {
                const a = -ALIGN_STIFFNESS * (x - target) - ALIGN_DAMPING * v;
                v += a * h;
                x += v * h;
            }
            apply(x);

            // готовность геометрии: лента развёрнута И ширина чипа замерла
            const nowCompact = tabs && tabs.classList.contains('compact');
            if (wasCompact && !nowCompact) stable = 0;   // старт разворота — считаем заново
            wasCompact = nowCompact;
            const w = activeEl.offsetWidth;
            stable = (w === prevW) ? stable + 1 : 0;
            prevW = w;
            const geomSettled = !nowCompact && stable >= 3;

            // финиш: геометрия финальна И спринг сошёлся → точное попадание (delta 0)
            if (geomSettled && Math.abs(x - target) < 0.5 && Math.abs(v) < 0.5) {
                apply(target);
                return;
            }
            // предохранитель (2000ms): edge без разворота — не крутим вечно, ставим финал
            if (now - t0 > 2000) { apply(computeTarget()); return; }
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    });
}
