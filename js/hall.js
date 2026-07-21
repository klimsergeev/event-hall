/* ============================================================
   Схема зала: пан/зум вьюпорт.
   Порт логики из handoff/prototype-full.jsx (SeatViewport):
   пороги компактификации, clampPan, pinch/wheel/drag, dbl-click reset.
   ============================================================ */

const MIN_SCALE = 1;
const MAX_SCALE = 3.2;

export class HallViewport {
    /* opts: { compactionMode, onInteractStart, onInteractEnd, onScale, onScaleShow } */
    constructor(viewport, content, opts = {}) {
        this.vp = viewport;
        this.content = content;
        this.opts = Object.assign({ compactionMode: 'any' }, opts);

        this.scale = 1;
        this.tx = 0;
        this.ty = 0;
        this.notified = false;

        this.drag = { active: false, startX: 0, startY: 0, baseTx: 0, baseTy: 0, pid: null };
        this.pinch = { active: false, baseDist: 0, baseScale: 1 };
        this.touchPan = { active: false, startX: 0, startY: 0, baseTx: 0, baseTy: 0 };
        this._hideT = null;

        this._bind();
    }

    _bind() {
        const vp = this.vp;
        vp.addEventListener('pointerdown', this._onPointerDown);
        vp.addEventListener('pointermove', this._onPointerMove);
        vp.addEventListener('pointerup', this._onPointerUp);
        vp.addEventListener('pointercancel', this._onPointerUp);
        vp.addEventListener('wheel', this._onWheel, { passive: false });
        vp.addEventListener('touchstart', this._onTouchStart, { passive: false });
        vp.addEventListener('touchmove', this._onTouchMove, { passive: false });
        vp.addEventListener('touchend', this._onTouchEnd);
        vp.addEventListener('dblclick', () => this.reset());
    }

    _clampPan(nx, ny, s) {
        const w = this.vp.clientWidth;
        const h = this.vp.clientHeight;
        const maxX = ((s - 1) * w) / 2 + 40;
        const maxY = ((s - 1) * h) / 2 + 40;
        return [Math.max(-maxX, Math.min(maxX, nx)), Math.max(-maxY, Math.min(maxY, ny))];
    }

    _apply(s, nx, ny, anim) {
        const [cx, cy] = this._clampPan(nx, ny, s);
        this.scale = s;
        this.tx = cx;
        this.ty = cy;
        this.content.classList.toggle('animated', !!anim);
        this.content.style.transform = `translate(${cx}px, ${cy}px) scale(${s})`;

        // индикатор масштаба (появляется ненадолго)
        if (this.opts.onScaleShow) this.opts.onScaleShow(s, this._interacted());
        clearTimeout(this._hideT);
        this._hideT = setTimeout(() => {
            if (this.opts.onScaleShow) this.opts.onScaleShow(this.scale, false);
        }, 900);

        this._checkCompact();
    }

    _interacted() {
        const zoomed = this.scale > 1.001;
        const panned = Math.abs(this.tx) > 0.5 || Math.abs(this.ty) > 0.5;
        return zoomed || panned;
    }

    _shouldCompact() {
        const zoomed = this.scale > 1.001;
        const panned = Math.abs(this.tx) > 0.5 || Math.abs(this.ty) > 0.5;
        const mode = this.opts.compactionMode;
        if (mode === 'never') return false;
        if (mode === 'zoom-only') return zoomed;
        return zoomed || panned; // 'any'
    }

    _checkCompact() {
        const should = this._shouldCompact();
        if (should && !this.notified) {
            this.notified = true;
            this.opts.onInteractStart && this.opts.onInteractStart();
        } else if (!should && this.notified) {
            this.notified = false;
            this.opts.onInteractEnd && this.opts.onInteractEnd();
        }
    }

    reset() {
        this._apply(1, 0, 0, true);
    }

    zoomBy(delta) {
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale + delta));
        this._apply(next, this.tx, this.ty, true);
    }

    /* ---- pointer (мышь): drag-пан ---- */
    _onPointerDown = (e) => {
        if (e.pointerType === 'touch') return; // тач — отдельно
        e.preventDefault();
        this.drag = { active: true, startX: e.clientX, startY: e.clientY, baseTx: this.tx, baseTy: this.ty, pid: e.pointerId };
        try { this.vp.setPointerCapture(e.pointerId); } catch {}
        this.vp.classList.add('grabbing');
    };
    _onPointerMove = (e) => {
        if (!this.drag.active || e.pointerType === 'touch') return;
        const dx = e.clientX - this.drag.startX;
        const dy = e.clientY - this.drag.startY;
        this._apply(this.scale, this.drag.baseTx + dx, this.drag.baseTy + dy, false);
    };
    _onPointerUp = (e) => {
        this.drag.active = false;
        this.vp.classList.remove('grabbing');
        try { this.vp.releasePointerCapture(e.pointerId); } catch {}
    };

    /* ---- wheel: зум ---- */
    _onWheel = (e) => {
        e.preventDefault();
        const delta = -e.deltaY * 0.003;
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale + delta));
        this._apply(next, this.tx, this.ty, false);
    };

    /* ---- touch: pinch-зум + 1-палец пан ---- */
    _onTouchStart = (e) => {
        if (e.touches.length === 2) {
            const [a, b] = e.touches;
            this.pinch = {
                active: true,
                baseDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
                baseScale: this.scale,
            };
            this.touchPan.active = false;
        } else if (e.touches.length === 1) {
            const t = e.touches[0];
            this.touchPan = { active: true, startX: t.clientX, startY: t.clientY, baseTx: this.tx, baseTy: this.ty };
            this.pinch.active = false;
            this.vp.classList.add('grabbing');
        }
    };
    _onTouchMove = (e) => {
        if (this.pinch.active && e.touches.length === 2) {
            e.preventDefault();
            const [a, b] = e.touches;
            const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            const ratio = d / (this.pinch.baseDist || 1);
            const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.pinch.baseScale * ratio));
            this._apply(next, this.tx, this.ty, false);
        } else if (this.touchPan.active && e.touches.length === 1) {
            e.preventDefault();
            const t = e.touches[0];
            const dx = t.clientX - this.touchPan.startX;
            const dy = t.clientY - this.touchPan.startY;
            this._apply(this.scale, this.touchPan.baseTx + dx, this.touchPan.baseTy + dy, false);
        }
    };
    _onTouchEnd = () => {
        this.pinch.active = false;
        this.touchPan.active = false;
        this.vp.classList.remove('grabbing');
    };
}
