/* ============================================================
   Окно «твиков» — bottom-sheet по Figma 4960-122090 (Dialog / Mobile).
   Каркас окна из макета; КОНТЕНТ пустой (плейсхолдер под будущие твики).

   Открытие:
   - основной жест: долгое нажатие ДВУМЯ ПАЛЬЦАМИ ~600мс БЕЗ движения;
   - для десктоп-теста: клавиша T (toggle) + QA-хуки window.__*.

   Сосуществование с пинч-зумом схемы (hall.js): детектор жеста — ПАССИВНЫЙ
   слушатель в capture-фазе на document. Он лишь СТАРТУЕТ таймер на 2 касаниях
   и отменяет его при любом движении/смене числа касаний. preventDefault не
   зовём и распространение не глушим → пинч в hall.js работает как раньше.
   ============================================================ */

const HOLD_MS = 600;    // длительность удержания без движения до открытия
const MOVE_TOL = 10;    // порог движения (px): больше — это пинч/пан → отмена

const icoCross =
    '<svg width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round"><path d="M5 5 L15 15 M15 5 L5 15"/></svg>';

function buildDom() {
    const overlay = document.createElement('div');
    overlay.className = 'tweaks-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
        '<div class="tweaks-sheet" role="dialog" aria-modal="true" aria-label="Tweaks">' +
            '<div class="tweaks-head">' +
                '<div class="tweaks-title-wrap">' +
                    '<p class="tweaks-title">Tweaks</p>' +
                    '<p class="tweaks-sub">Подзаголовок</p>' +
                '</div>' +
                `<button class="tweaks-close" type="button" aria-label="Закрыть">${icoCross}</button>` +
            '</div>' +
            // пустая область — плейсхолдер под будущие контролы твиков
            '<div class="tweaks-body"></div>' +
            '<div class="tweaks-actions">' +
                '<button class="tweaks-btn tweaks-btn-primary tweaks-save" type="button">Сохранить</button>' +
                '<button class="tweaks-btn tweaks-btn-secondary tweaks-cancel" type="button">Отмена</button>' +
            '</div>' +
        '</div>';
    return overlay;
}

export function initTweaks() {
    const mount = document.querySelector('.app') || document.body;
    const overlay = buildDom();
    mount.appendChild(overlay);

    let open = false;

    const setOpen = (v) => {
        open = v;
        overlay.classList.toggle('is-open', v);
        overlay.setAttribute('aria-hidden', v ? 'false' : 'true');
        window.__tweaksOpen = v;
    };
    const openTweaks = () => setOpen(true);
    const closeTweaks = () => setOpen(false);
    const toggleTweaks = () => setOpen(!open);

    /* ---- закрытие: X, Отмена, Сохранить (пока просто закрывает), тап по оверлею ---- */
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeTweaks();   // тап по затемнению вне листа
    });
    overlay.querySelector('.tweaks-close').addEventListener('click', closeTweaks);
    overlay.querySelector('.tweaks-cancel').addEventListener('click', closeTweaks);
    overlay.querySelector('.tweaks-save').addEventListener('click', closeTweaks);

    /* ---- жест: 2 пальца, удержание без движения ---- */
    let timer = null;
    let startPts = null;   // снимок 2 касаний на старте: [{id,x,y}, ...]

    const snapshot = (touches) =>
        Array.from(touches).map((t) => ({ id: t.identifier, x: t.clientX, y: t.clientY }));

    const disarm = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        startPts = null;
        window.__tweaksArmed = false;
    };

    const onStart = (e) => {
        if (open) return;                       // уже открыто — жест не нужен
        if (e.touches.length === 2) {
            startPts = snapshot(e.touches);
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                window.__tweaksArmed = false;
                openTweaks();                   // удержание без движения дошло до конца
            }, HOLD_MS);
            window.__tweaksArmed = true;
        } else {
            disarm();                           // не 2 касания — не наш жест
        }
    };

    const onMove = (e) => {
        if (!startPts) return;
        if (e.touches.length !== 2) { disarm(); return; }   // число касаний изменилось
        const cur = snapshot(e.touches);
        for (const p of startPts) {
            const q = cur.find((c) => c.id === p.id);
            if (!q) { disarm(); return; }                   // палец сменился
            if (Math.hypot(q.x - p.x, q.y - p.y) > MOVE_TOL) { disarm(); return; } // движение → пинч/пан
        }
    };

    const onEnd = () => { disarm(); };   // палец убрали/добавили → отмена

    // capture + passive: только НАБЛЮДАЕМ, не вмешиваемся в пинч схемы
    const optsPassive = { capture: true, passive: true };
    document.addEventListener('touchstart', onStart, optsPassive);
    document.addEventListener('touchmove', onMove, optsPassive);
    document.addEventListener('touchend', onEnd, optsPassive);
    document.addEventListener('touchcancel', onEnd, optsPassive);

    /* ---- горячая клавиша T (десктоп-тест) + Esc для закрытия ---- */
    document.addEventListener('keydown', (e) => {
        const el = document.activeElement;
        const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
        if (typing) return;
        if (e.key === 't' || e.key === 'T' || e.key === 'е' || e.key === 'Е') {
            e.preventDefault();
            toggleTweaks();
        } else if (e.key === 'Escape' && open) {
            closeTweaks();
        }
    });

    /* ---- QA-хуки ---- */
    window.__openTweaks = openTweaks;
    window.__closeTweaks = closeTweaks;
    window.__toggleTweaks = toggleTweaks;
    window.__tweaksOpen = false;
    window.__tweaksArmed = false;   // true, пока жест-таймер «взведён» (для детерминированного теста)

    setOpen(false);
}
