/**
 * The landing object: one field split by a vertical seam whose profile is the real SHA-256 of a
 * fresh 32-byte secret. Squares left of the seam are USDC units, circles right of it are PUSD units;
 * they drift but never cross. A swap gathers a lock ring on each side, one bone-white secret crosses
 * the seam, and both rings release to new owners. Every fourth swap no secret arrives and both rings
 * refund after their timeouts (1 h runs out before 4 h).
 */
type Bytes = Uint8Array;
interface Secret { s: Bytes; h: Bytes; sx: string; hx: string }

const toHex = (b: Bytes) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
async function freshSecret(): Promise<Secret> {
  const s = crypto.getRandomValues(new Uint8Array(32));
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', s));
  return { s, h, sx: toHex(s), hx: toHex(h) };
}

interface Unit { side: 0 | 1; hx: number; hy: number; ph: number; sp: number; role: 0 | 1; slot: number; hollow: number }

export interface SeamFieldHandle { destroy(): void; replay(): void }

export async function startSeamField(cv: HTMLCanvasElement, panel: HTMLElement, stepsList: HTMLOListElement, watch?: HTMLElement): Promise<SeamFieldHandle> {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = cv.getContext('2d')!;
  const stepEls = [...stepsList.querySelectorAll('li')];
  const l4 = stepsList.querySelector('.l4') as HTMLElement;
  const l5 = stepsList.querySelector('.l5') as HTMLElement;
  const C = { ink: '20,12,8', bone: '255,243,234', bg: '#e4471d' };
  const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const eo = (t: number) => 1 - Math.pow(1 - clamp(t), 4);
  const eio = (t: number) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  const pr = (t: number, a: number, d: number) => clamp((t - a) / d);
  let seed = 0x2545f491;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 1000003) / 1000003; };

  let W = 0, H = 0, dpr = 1, mob = false, SX = 0, AMP = 16, pTop = 0, pBot = 0, cx0 = 0, cx1 = 0, stepTop = 0;
  let cur = await freshSecret(), nxt = await freshSecret();
  let prof = Float32Array.from(cur.h), from = Float32Array.from(cur.h);
  let units: Unit[] = [];
  let alive = true;

  function seamX(y: number) {
    const S = H / 32; let i = Math.floor(y / S); if (i < 0) i = 0; if (i > 31) i = 31;
    const f = (y - i * S) / S;
    return SX + (i % 2 ? 1 : -1) * AMP * (0.38 + 0.62 * prof[i]! / 255) * Math.sin(Math.PI * f);
  }
  function build() {
    units = []; const sp = mob ? 18 : 22; const ox = (SX % sp) - sp / 2;
    for (let y = sp * 0.5; y < H; y += sp) for (let x = ox; x < W + sp; x += sp) {
      if (x < 4 || x > W - 4) continue; const s = seamX(y); if (Math.abs(x - s) < 7) continue;
      units.push({ side: x < s ? 0 : 1, hx: x, hy: y, ph: rnd() * 6.283, sp: 0.3 + rnd() * 0.5, role: 0, slot: 0, hollow: 0 });
    }
  }
  function resize() {
    const r = cv.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mob = W < 640; SX = W / 2; AMP = mob ? 11 : 16; const pad = mob ? 16 : 24; const cw = Math.min(W - 2 * pad, 1240); cx0 = (W - cw) / 2; cx1 = cx0 + cw;
    const p = panel.getBoundingClientRect(); pTop = p.top - r.top; pBot = p.bottom - r.top;
    stepTop = stepsList.getBoundingClientRect().top - r.top;
    build();
  }

  const N = { b1: 0, b2: 0.9, b3: 2.0, b4: 3.1, b5: 4.2, end: 5.9, len: 7.0 };
  const R = { b1: 0, b2: 0.9, b3: 2.0, b4: 3.1, b5: 99, outB: 3.9, outA: 6.3, end: 7.6, len: 8.6 };
  let swapN = 0, t = 1.15, last = performance.now(), crossF = 0;
  let sw: { y: number; L: { x: number; y: number }; R: { x: number; y: number }; units: [Unit[], Unit[]] } | null = null;
  const isRefund = () => swapN % 4 === 3;
  // The swap plays right under the panel, so headline and swap read as one focal group.
  function defaultY() {
    const y = pBot + (mob ? 70 : 92);
    return Math.min(y, stepTop - (mob ? 50 : 60));
  }
  const RING = () => (mob ? 22 : 30), K = () => (mob ? 24 : 32), OFF = () => (mob ? 40 : 56);
  function placeSwap(y: number) {
    const sx = seamX(y); sw = { y, L: { x: sx - OFF(), y }, R: { x: sx + OFF(), y }, units: [[], []] };
    for (const s of [0, 1] as const) {
      const c = s ? sw.R : sw.L;
      const cand = units.filter((u) => u.side === s && u.role === 0)
        .map((u) => [u, (u.hx - c.x) ** 2 + (u.hy - c.y) ** 2] as const).sort((a, b) => a[1] - b[1]).slice(0, K()).map((a) => a[0]);
      cand.sort((a, b) => Math.atan2(a.hy - c.y, a.hx - c.x) - Math.atan2(b.hy - c.y, b.hx - c.x)).forEach((u, i) => { u.role = 1; u.slot = i; });
      sw.units[s] = cand;
    }
  }
  function endSwap() { if (!sw) return; const ref = isRefund(); for (const s of [0, 1] as const) for (const u of sw.units[s]) { u.role = 0; if (!ref) u.hollow = 1; } sw = null; }
  async function startSwap(y: number) { endSwap(); from = Float32Array.from(prof); cur = await freshSecret(); t = 0; placeSwap(y); }

  function label(txt: string, x: number, y: number, o: { size?: number; color?: string; align?: CanvasTextAlign; font?: 'mono' | 'sans'; weight?: number } = {}) {
    const { size = 11, color = `rgba(${C.ink},.92)`, align = 'left', font = 'mono', weight = 400 } = o;
    ctx.font = font === 'mono' ? `400 ${size}px "Geist Mono",ui-monospace,monospace` : `${weight} ${size}px "General Sans",system-ui,sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.strokeStyle = C.bg;
    ctx.strokeText(txt, x, y); ctx.fillStyle = color; ctx.fillText(txt, x, y);
  }
  const short = (h: string, a: number, b: number) => h.slice(0, a) + '…' + h.slice(-b);
  function setSteps(i: number, ref: boolean) {
    stepEls.forEach((el, j) => { el.classList.toggle('on', j === i); el.classList.toggle('done', j < i); });
    l4.textContent = ref ? 'No secret · timeouts run' : 'Secret crosses'; l5.textContent = ref ? 'Both refund' : 'Both open';
  }

  function draw(staticEnd: boolean) {
    const ref = !staticEnd && isRefund(), T = ref ? R : N, tt = staticEnd ? N.b5 + 0.25 : t, now = performance.now() / 1000;
    ctx.clearRect(0, 0, W, H);
    if (!staticEnd) for (let i = 0; i < 32; i++) prof[i] = lerp(from[i]!, cur.h[i]!, eio(pr(tt, 0.05 + i * 0.015, 0.6)));
    else prof = Float32Array.from(cur.h);
    const gA = staticEnd ? 1 : eio(pr(tt, T.b2, 0.9)), gB = staticEnd ? 1 : eio(pr(tt, T.b3, 0.9));
    const relN = staticEnd ? 0 : ref ? 0 : eio(pr(tt, T.b5 + 0.15, 1.3));
    const rbB = ref ? eio(pr(tt, R.outB, 1.0)) : 0, rbA = ref ? eio(pr(tt, R.outA, 1.0)) : 0;
    const RG = RING(), KK = K(); const sq = mob ? 3 : 3.7, cr = mob ? 1.6 : 2;
    const fillP = new Path2D(), holP = new Path2D(), dimP = new Path2D();
    for (const u of units) {
      let x = u.hx + Math.sin(now * u.sp + u.ph) * 1.8, y = u.hy + Math.cos(now * u.sp * 0.8 + u.ph) * 1.6, hol = u.hollow > 0.5;
      if (u.role === 1 && sw) {
        const c = u.side ? sw.R : sw.L, g = u.side ? gB : gA; const a = (u.slot / KK) * 6.283 + (u.side ? Math.PI / KK : 0);
        const rx = c.x + Math.cos(a) * RG, ry = c.y + Math.sin(a) * RG; x = lerp(x, rx, g); y = lerp(y, ry, g);
        if (!ref) { x = lerp(x, u.hx, relN); y = lerp(y, u.hy, relN); if (relN > 0.5) hol = true; }
        else { const r = u.side ? rbB : rbA; x = lerp(x, u.hx, r); y = lerp(y, u.hy, r); }
      }
      const s = seamX(y); if (u.side === 0 && x > s - 6) x = s - 6; if (u.side === 1 && x < s + 6) x = s + 6;
      const quiet = y < 76 || (y > stepTop - 6 && y < stepTop + 40 && Math.abs(x - SX) < 330);
      const P = hol ? holP : quiet ? dimP : fillP;
      if (u.side === 0) P.rect(x - sq / 2, y - sq / 2, sq, sq); else { P.moveTo(x + cr, y); P.arc(x, y, cr, 0, 6.283); }
    }
    ctx.fillStyle = `rgba(${C.ink},.62)`; ctx.fill(fillP);
    ctx.fillStyle = `rgba(${C.ink},.22)`; ctx.fill(dimP);
    ctx.strokeStyle = `rgba(${C.ink},.7)`; ctx.lineWidth = 1; ctx.stroke(holP);

    ctx.beginPath(); for (let y = 0; y <= H; y += 1.5) { const x = seamX(y); if (y) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.strokeStyle = `rgba(${C.ink},.92)`; ctx.lineWidth = 1.3; ctx.stroke();
    if (crossF > 0.01 && sw) {
      const g = ctx.createLinearGradient(0, sw.y - 70, 0, sw.y + 70);
      g.addColorStop(0, `rgba(${C.bone},0)`); g.addColorStop(0.5, `rgba(${C.bone},${crossF})`); g.addColorStop(1, `rgba(${C.bone},0)`);
      ctx.beginPath(); for (let y = sw.y - 70; y <= sw.y + 70; y += 1.5) { const x = seamX(y); if (y > sw.y - 70) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.strokeStyle = g; ctx.lineWidth = 2.6; ctx.stroke();
    }
    // Side names sit level with the swap, at the container edges.
    // On narrow screens the swap labels need the row, so the side names sit just above it.
    const ny = sw ? (mob ? sw.y - 44 : sw.y) : pBot + (mob ? 22 : 30);
    if (ny < H - 60) {
      ctx.fillStyle = `rgba(${C.ink},.9)`; ctx.fillRect(cx0, ny - sq / 2 - 0.5, sq + 1, sq + 1);
      label(mob ? 'USDC · Base' : 'USDC · Base, Arbitrum, OP, Polygon', cx0 + 12, ny, { size: mob ? 12 : 13.5, font: 'sans', weight: 600 });
      ctx.fillStyle = `rgba(${C.ink},.9)`; ctx.beginPath(); ctx.arc(cx1 - cr - 0.5, ny, cr + 0.5, 0, 6.283); ctx.fill();
      label(mob ? 'PUSD · BCH' : 'PUSD · Bitcoin Cash', cx1 - 12, ny, { size: mob ? 12 : 13.5, align: 'right', font: 'sans', weight: 600 });
    }
    if (!sw) return;
    const lab = mob ? 10 : 11, gap = RG + (mob ? 11 : 16);
    const lkA = staticEnd ? 0 : pr(tt, T.b2 + 0.7, 0.4) * (ref ? 1 - pr(tt, R.outA, 0.4) : 1 - pr(tt, T.b5, 0.4));
    const lkB = staticEnd ? 0 : pr(tt, T.b3 + 0.7, 0.4) * (ref ? 1 - pr(tt, R.outB, 0.4) : 1 - pr(tt, T.b5, 0.4));
    const ringO = (c: { x: number; y: number }, o: number) => { if (o < 0.01) return; ctx.strokeStyle = `rgba(${C.ink},${0.45 * o})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(c.x, c.y, RG + 7, 0, 6.283); ctx.stroke(); };
    ringO(sw.L, staticEnd ? 1 : gA * (ref ? 1 - rbA : 1 - relN)); ringO(sw.R, staticEnd ? 1 : gB * (ref ? 1 - rbB : 1 - relN));
    if (lkA > 0.01) label(mob ? '1.00 USDC · 4 h' : 'Locked on Base · 1.00 USDC · 4 h', sw.L.x - gap, sw.y, { size: lab, align: 'right', color: `rgba(${C.ink},${lkA})` });
    if (lkB > 0.01) label(mob ? '1.00 PUSD · 1 h' : 'Locked on BCH · 1.00 PUSD · 0-conf · 1 h', sw.R.x + gap, sw.y, { size: lab, color: `rgba(${C.ink},${lkB})` });
    if (ref) {
      const v = pr(tt, R.b4, 0.3); const ta = 1 - clamp((tt - R.b4) / (R.outA - R.b4)), tb = 1 - clamp((tt - R.b4) / (R.outB - R.b4));
      ctx.strokeStyle = `rgba(${C.bone},${0.95 * v})`; ctx.lineWidth = 1.6;
      if (ta > 0) { ctx.beginPath(); ctx.arc(sw.L.x, sw.L.y, RG + 7, -Math.PI / 2, -Math.PI / 2 + 6.283 * ta); ctx.stroke(); }
      if (tb > 0) { ctx.beginPath(); ctx.arc(sw.R.x, sw.R.y, RG + 7, -Math.PI / 2, -Math.PI / 2 + 6.283 * tb); ctx.stroke(); }
      const fa = 1 - pr(tt, R.end, 0.8), a1 = pr(tt, R.outB + 0.3, 0.4) * fa, a2 = pr(tt, R.outA + 0.3, 0.4) * fa;
      if (a1 > 0.01) label(mob ? 'refunded · 1 h' : 'Refunded automatically · 1 h', sw.R.x + gap, sw.y, { size: lab, color: `rgba(${C.ink},${a1})` });
      if (a2 > 0.01) label(mob ? 'refunded · 4 h' : 'Refunded automatically · 4 h', sw.L.x - gap, sw.y, { size: lab, align: 'right', color: `rgba(${C.ink},${a2})` });
    } else {
      const ra = staticEnd ? 1 : pr(tt, T.b5 + 0.3, 0.4) * (1 - pr(tt, T.end, 0.8));
      if (ra > 0.01) {
        label(mob ? 'USDC → solver' : 'Opened · 1.00 USDC → solver', sw.L.x - gap, sw.y, { size: lab, align: 'right', color: `rgba(${C.ink},${ra})` });
        label(mob ? 'PUSD → you' : 'Opened · 1.00 PUSD → you', sw.R.x + gap, sw.y, { size: lab, color: `rgba(${C.ink},${ra})` });
      }
    }
    let px = sw.L.x; const py = sw.y; const pa = staticEnd ? 1 : eo(pr(tt, T.b1, 0.5)) * (1 - pr(tt, ref ? R.end : T.end - 0.2, 0.7));
    const lost = ref && tt > R.b4 + 0.3;
    if (staticEnd) px = sw.R.x;
    else if (!ref) { const m = eio(pr(tt, T.b4, 1.0)); px = lerp(sw.L.x, sw.R.x, m); const near = Math.max(0, 1 - Math.abs(px - seamX(py)) / 26); crossF = Math.max(near, crossF * 0.93); }
    else crossF *= 0.9;
    if (pa > 0.01) {
      const dim = lost ? 1 - 0.7 * pr(tt, R.b4 + 0.3, 0.8) : 1;
      ctx.fillStyle = `rgba(${C.bone},${pa * dim})`; ctx.beginPath(); ctx.arc(px, py, 4, 0, 6.283); ctx.fill();
      ctx.strokeStyle = `rgba(${C.bone},${0.55 * pa * dim})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px, py, 9.5 + Math.sin(now * 2.3) * 1.1, 0, 6.283); ctx.stroke();
      const p = staticEnd ? 1 : pr(tt, T.b1 + 0.05, 0.6); let hx = short(cur.sx, mob ? 4 : 8, mob ? 3 : 4);
      if (p < 1) { let o = ''; for (let i = 0; i < hx.length; i++) o += i / hx.length < p || hx[i] === '…' ? hx[i] : '0123456789abcdef'[(Math.random() * 16) | 0]; hx = o; }
      label(lost ? 'secret never revealed' : (mob ? 'secret ' : 'secret · 32 bytes · ') + hx, px, py - RG - 22, { size: lab, align: 'center', color: lost ? `rgba(${C.ink},${pa * 0.7})` : `rgba(${C.bone},${pa})` });
    }
    if (!mob) { const ha = staticEnd ? 1 : pr(tt, 0.2, 0.6) * (1 - pr(tt, ref ? R.end : T.end, 0.8)); if (ha > 0.01) label('H = SHA-256(secret) · ' + short(cur.hx, 8, 6), sw.R.x + gap, sw.y + 19, { size: 10.5, color: `rgba(${C.ink},${0.8 * ha})` }); }
    if (staticEnd) { stepEls.forEach((el) => el.classList.add('done')); stepEls[4]?.classList.add('on'); return; }
    const marks = ref ? [0, N.b2, N.b3, R.b4, R.outB] : [N.b1, N.b2, N.b3, N.b4, N.b5]; let s = 0; for (let i = 0; i < 5; i++) if (tt >= marks[i]!) s = i; setSteps(s, ref);
  }

  function frame(ms: number) {
    if (!alive) return;
    const dt = Math.min(0.05, (ms - last) / 1000); last = ms; t += dt;
    if (t >= (isRefund() ? R.len : N.len)) {
      endSwap(); swapN++;
      if (swapN % 6 === 0) for (const u of units) u.hollow = 0;
      from = Float32Array.from(prof); cur = nxt; void freshSecret().then((v) => { nxt = v; }); t = 0; placeSwap(defaultY());
    }
    draw(false); requestAnimationFrame(frame);
  }

  const onClick = (e: MouseEvent) => { const r = cv.getBoundingClientRect(); const y = e.clientY - r.top; if (isRefund()) swapN++; void startSwap(clamp(y, 60, H - 60)).then(() => { if (reduce) draw(true); }); };
  const onResize = () => { sw = null; resize(); placeSwap(defaultY()); if (reduce) draw(true); };
  const replay = () => { if (isRefund()) swapN++; void startSwap(defaultY()).then(() => { if (reduce) draw(true); }); };
  const onWatch = (e: Event) => { e.preventDefault(); replay(); };
  cv.addEventListener('click', onClick);
  addEventListener('resize', onResize);
  watch?.addEventListener('click', onWatch);
  await (document.fonts ? document.fonts.ready : Promise.resolve());
  resize(); placeSwap(defaultY());
  if (reduce) draw(true); else { last = performance.now(); requestAnimationFrame(frame); }

  return {
    replay,
    destroy() { alive = false; cv.removeEventListener('click', onClick); removeEventListener('resize', onResize); watch?.removeEventListener('click', onWatch); },
  };
}
