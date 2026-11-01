import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { getAddress } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import * as ch from './chain.js';

// ---------- config: local chain (npm run demo) or Polkadot testnet ----------

const LS = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

function testnetKeys() {
  // Testnet-only demo accounts generated in this browser. Never put real funds here.
  let keys = LS.get('remesa.keys');
  if (!keys) {
    keys = Object.fromEntries(ch.ROLES.map((r) => [r, generatePrivateKey()]));
    LS.set('remesa.keys', keys);
  }
  return keys;
}

// Vite serves index.html when a file is missing, so json() throws and we get null.
const fetchJson = (path) =>
  fetch(path, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

async function loadConfig() {
  // The local chain only exists on the dev machine; a published build is always testnet.
  if (import.meta.env.DEV && LS.get('remesa.mode') !== 'testnet') {
    const local = await fetchJson('./local.json');
    if (local) return local;
  }
  // Addresses ship in the build (public/testnet.json) because the phone has no Preparar tab; Preparar can override them.
  const t = LS.get('remesa.testnet') ?? (await fetchJson('./testnet.json')) ?? {};
  return { mode: 'testnet', ...ch.TESTNET, usd: t.usd ?? '', remesa: t.remesa ?? '', keys: testnetKeys() };
}

const ERROR_ES = {
  UnknownKey: 'Esa clave no está registrada.',
  NoCashierAvailable: 'No hay cajero disponible con garantía suficiente.',
  TooManyReservations: 'Tienes demasiadas reservas abiertas. Espera a que caduquen.',
  TooLate: 'Se acabó el tiempo para este paso.',
  TooEarly: 'Todavía no se puede: falta tiempo.',
  NotAllowed: 'Esta cuenta no puede hacer este paso.',
  BadStatus: 'El envío ya cambió de estado.',
  InsufficientFree: 'No hay garantía libre suficiente.',
  NotApproved: 'Esta cuenta no está aprobada como cajero.',
  NotReporter: 'Solo la cuenta que desplegó el contrato puede hacer esto.',
};

const ROLE_ES = { abuelita: 'Abuelita (EE. UU.)', cajeroUS: 'Chelsea · cajera US', cajeroMX: 'Rubén · cajero MX', nieta: 'Nieta (México)' };
const STATUS_ES = {
  Reserved: 'Reservado',
  Assigned: 'Asignado a cajero MX',
  Paid: 'SPEI enviado',
  Confirmed: 'Confirmado',
  Disputed: 'En disputa (congelado)',
  Expired: 'Caducado',
};

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
const mmss = (s) => (s <= 0 ? '00:00' : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parseAmount = (s) => {
  try {
    const v = ch.parseUnits(s || '0', 18);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
};

// ---------- app shell ----------

export default function App() {
  const [cfg, setCfg] = useState(null);
  const [route, setRoute] = useState(location.hash.slice(1) || 'demo');
  const [state, setState] = useState(null);
  const [readError, setReadError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [tick, setTick] = useState(0);
  const [clock, setClock] = useState(Date.now() / 1000);
  const offset = useRef(-Infinity);
  // undefined: checking; null: normal browser (demo keys); {}: inside the Polkadot App, no role yet; {role, h}: connected.
  const [host, setHost] = useState(undefined);

  useEffect(() => {
    loadConfig().then(setCfg);
    // Loaded on demand so a broken SDK never takes down the browser demo.
    import('./host.js')
      .then((m) => m.inHost())
      .then((inside) => setHost(inside ? {} : null))
      .catch(() => setHost(null));
    const onHash = () => setRoute(location.hash.slice(1) || 'demo');
    addEventListener('hashchange', onHash);
    const t = setInterval(() => setClock(Date.now() / 1000), 1000);
    return () => {
      removeEventListener('hashchange', onHash);
      clearInterval(t);
    };
  }, []);

  const ready = !!(cfg?.usd && cfg?.remesa);
  const c = useMemo(() => {
    if (!cfg) return null;
    const base = ch.connect(cfg);
    if (!host?.h) return base;
    // The connected role is the phone's Product account; the other roles keep their demo keys.
    const { role, h, hostSend } = host;
    // The SDK gives a lowercase h160; viem reads checksummed addresses, and the screens compare them with ===.
    return { ...base, addr: { ...base.addr, [role]: getAddress(h.me.h160Address) }, host: { [role]: (fn, args) => hostSend(h, fn, args) } };
  }, [cfg, host]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // The screens react to on-chain state changes; one poll feeds all of them.
  useEffect(() => {
    if (!c || !ready) return;
    let alive = true;
    let timer;
    const poll = async () => {
      try {
        const s = await ch.readState(c);
        if (!alive) return;
        offset.current = Math.max(offset.current, Number(s.now) - Date.now() / 1000);
        setState(s);
        setReadError(null);
      } catch (e) {
        if (alive) setReadError(ch.errorText(e));
      }
      if (alive) timer = setTimeout(poll, 2000);
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [c, ready, tick]);

  // One signature at a time: a second tx from the same account would clash on the nonce.
  const run = async (label, fn) => {
    if (busy) return;
    setBusy(label);
    setToast(null);
    try {
      return await fn();
    } catch (e) {
      const name = ch.errorText(e);
      setToast(ERROR_ES[name] ?? name);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  if (!cfg || host === undefined) return <div className="loading"><Loader big label="Cargando…" /></div>;

  const connectRole = (role) =>
    run('Conectando con la Polkadot App', async () => {
      const m = await import('./host.js');
      const h = await m.connectHost(cfg.remesa, role);
      setHost({ role, h, hostSend: m.hostSend });
    });

  if (host && !host.h)
    return (
      <div className="app">
        {toast && <div className="bar error">⚠ {toast}</div>}
        <HostHome busy={busy} ready={ready} onPick={connectRole} onDemo={() => setHost(null)} />
      </div>
    );

  const now = clock + (Number.isFinite(offset.current) ? offset.current : 0);
  const ctx = {
    c,
    cfg,
    state,
    busy,
    run,
    now,
    refresh,
    txUrl: (h) => (cfg.explorer ? `${cfg.explorer}/tx/${h}` : null),
  };
  const hostPage = host?.h && (host.role === 'abuelita' ? 'enviar' : 'recibido');
  if (hostPage && !state) return <div className="loading">{readError ? `Sin conexión con la red: ${readError}` : <Loader big label="Cargando…" />}</div>;
  const page = hostPage || (!ready || !state ? 'preparar' : route);

  const tabs = hostPage ? [] : [
    ['demo', 'Demo'],
    ['enviar', 'Remitente'],
    ['cajeroUS', 'Cajera US'],
    ['cajeroMX', 'Cajero MX'],
    ['recibido', 'Receptor'],
    ['preparar', 'Preparar'],
  ];

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          Remesa <span className="tag">comunitaria</span>
        </div>
        <nav>
          {tabs.map(([k, label]) => (
            <a key={k} href={`#${k}`} className={page === k ? 'on' : ''}>
              {label}
            </a>
          ))}
        </nav>
        <div className={`net ${cfg.mode}`}>{hostPage ? 'Polkadot App' : cfg.mode === 'local' ? 'Cadena local' : 'Polkadot Hub TestNet'}</div>
      </header>

      {busy && <BusyOverlay title={busy} hint="Firmando y esperando el bloque" />}
      {toast && (
        <div className="bar error" onClick={() => setToast(null)}>
          ⚠ {toast}
        </div>
      )}
      {readError && ready && <div className="bar error">Sin conexión con la red: {readError}</div>}

      {page === 'demo' && (
        <main className="split">
          <Phone title="Abuelita · EE. UU.">
            <Enviar ctx={ctx} />
          </Phone>
          <Phone title="Chelsea · cajera US">
            <CajeroUS ctx={ctx} />
          </Phone>
          <Phone title="Rubén · cajero MX">
            <CajeroMX ctx={ctx} />
          </Phone>
          <Phone title="Nieta · México">
            <Recibido ctx={ctx} />
          </Phone>
        </main>
      )}
      {page === 'enviar' && <main className="single"><Enviar ctx={ctx} /></main>}
      {page === 'cajeroUS' && <main className="single"><CajeroUS ctx={ctx} /></main>}
      {page === 'cajeroMX' && <main className="single"><CajeroMX ctx={ctx} /></main>}
      {page === 'recibido' && <main className="single"><Recibido ctx={ctx} /></main>}
      {page === 'preparar' && (
        <main className="single">
          <Preparar ctx={ctx} setCfg={setCfg} />
        </main>
      )}

      <footer>
        Reemplazamos al intermediario que decide por uno que solo obedece reglas públicas. <small className="muted">build {__BUILD__}</small>
      </footer>
    </div>
  );
}

// Inside the Polkadot App: the user only picks what they came to do. No addresses, tokens or gas on screen.
function HostHome({ busy, ready, onPick, onDemo }) {
  return (
    <main className="single">
      <div className="screen">
        <h2>Remesa comunitaria</h2>
        <p className="muted">Envía dólares desde EE. UU. y que lleguen pesos a México en segundos, sin comisión.</p>
        {!ready && <p className="bad">Falta la dirección del contrato en esta versión de la app.</p>}
        <button className="primary big-choice" disabled={!!busy || !ready} onClick={() => onPick('abuelita')}>
          Enviar dinero
        </button>
        <button className="primary big-choice" disabled={!!busy || !ready} onClick={() => onPick('nieta')}>
          Recibir dinero
        </button>
        {busy && <BusyOverlay title={busy} hint="Acepta los permisos que te pida la Polkadot App." />}
        <button className="link" onClick={onDemo}>
          Usar cuenta de demo
        </button>
        <small className="muted">build {__BUILD__}</small>
      </div>
    </main>
  );
}

function Loader({ label, big }) {
  return (
    <span className={`loader${big ? ' big' : ''}`} role="status">
      <span className="pac-wrap" aria-hidden="true">
        <span className="pac" />
        <span className="pac-dots" />
      </span>
      {label && <span>{label}</span>}
    </span>
  );
}

function BusyOverlay({ title, hint }) {
  return (
    <div className="overlay">
      <div className="overlay-card">
        <Loader big label={`${title}…`} />
        <p className="muted">{hint}</p>
      </div>
    </div>
  );
}

function Phone({ title, children }) {
  return (
    <section className="phone">
      <div className="phone-title">{title}</div>
      {children}
    </section>
  );
}

function Simulado() {
  return <span className="sim">SIMULADO</span>;
}

function TxLink({ ctx, hash, label = 'Ver en explorador' }) {
  if (!hash) return null;
  const url = ctx.txUrl(hash);
  return url ? (
    <a className="tx" href={url} target="_blank" rel="noreferrer">
      {label} ↗
    </a>
  ) : (
    <span className="tx">tx {short(hash)}</span>
  );
}

// ---------- Enviar (sender) ----------

function useBanxico() {
  const [rate, setRate] = useState(null);
  useEffect(() => {
    const token = import.meta.env.VITE_BANXICO_TOKEN;
    if (!token) return; // shortcut: Banxico SIE needs a token; without it we show only the on-chain reference
    fetch(`https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/oportuno?token=${token}`)
      .then((r) => r.json())
      .then((j) => setRate(j.bmx.series[0].datos[0]))
      .catch(() => {});
  }, []);
  return rate;
}

function Enviar({ ctx }) {
  const { c, state, busy, run, now } = ctx;
  const [key, setKey] = useState(ch.DEMO.nieta.nickname);
  const [amount, setAmount] = useState('100');
  const [q, setQ] = useState(null);
  const [dismissed, setDismissed] = useState(0n);
  const [scanning, setScanning] = useState(false);
  const banxico = useBanxico();
  const amountWei = parseAmount(amount);

  useEffect(() => {
    let alive = true;
    if (!amountWei || !key) return setQ(null);
    Promise.all([ch.quote(c, amountWei), ch.resolveKey(c, key)])
      .then(([q, owner]) => alive && setQ({ ...q, owner }))
      .catch(() => alive && setQ(null));
    return () => {
      alive = false;
    };
  }, [c, amount, key, state?.nextId, state?.mx.locked, state?.us.locked]);

  const current = state.transfers.find((t) => t.sender === c.addr.abuelita && t.id > dismissed);
  if (current) return <EnvioEnCurso ctx={ctx} t={current} onNew={() => setDismissed(current.id)} />;

  const keyOk = q && q.owner !== '0x0000000000000000000000000000000000000000';
  const effRate = q?.amountMXN && amountWei ? (q.amountMXN * ch.RATE_SCALE) / amountWei : 0n;

  return (
    <div className="screen">
      <h2>Enviar dinero a México</h2>
      <label>
        Clave del receptor (alias o CLABE)
        <input value={key} onChange={(e) => setKey(e.target.value.trim())} />
        {key && q && <small className={keyOk ? 'ok' : 'bad'}>{keyOk ? '✔ Clave registrada' : '✖ Clave no registrada'}</small>}
      </label>
      {scanning ? (
        <QrScanner
          onResult={(k) => {
            setKey(k);
            setScanning(false);
          }}
          onClose={() => setScanning(false)}
        />
      ) : (
        <button onClick={() => setScanning(true)}>📷 Escanear QR del receptor</button>
      )}
      <label>
        Monto (USD)
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>

      <div className="quote">
        <div className="big">
          Recibirá <strong>{q?.amountMXN ? ch.fmtMXN(q.amountMXN) : '—'}</strong>
        </div>
        <div className="row">
          <span>Tipo del cajero</span>
          <span>{effRate ? ch.fmtRate(effRate) : '—'}</span>
        </div>
        <div className="row">
          <span>Referencia Banxico</span>
          <span>{ch.fmtRate(state.referenceRate)}</span>
        </div>
        {banxico && (
          <div className="row muted">
            <span>Banxico FIX {banxico.fecha}</span>
            <span>{banxico.dato}</span>
          </div>
        )}
        <div className="row">
          <span>Comisión</span>
          <span className="ok">$0.00</span>
        </div>
        <small className="muted">Margen máximo permitido: {Number(state.maxSpreadBps) / 100}% bajo la referencia.</small>
      </div>

      <button
        className="primary pay"
        disabled={!!busy || !keyOk || !q?.mx || !amountWei}
        onClick={() => run('Pagando por Zelle', () => ch.send(c, 'abuelita', 'remesa', 'reserve', [key, amountWei]))}
      >
        Pagar {amountWei ? ch.fmtUSD(amountWei) : ''} por Zelle
      </button>
      <small className="muted">
        El pago por Zelle es <Simulado />: al tocarlo se aparta a la cajera y se congela su garantía.
      </small>
      {q && !q.mx && amountWei && <small className="bad">No hay cajeros disponibles para este monto.</small>}
    </div>
  );
}

// Reads the recipient's "remesa:<key>" QR from the camera. jsQR decodes frames, so it works where BarcodeDetector does not (Chrome on Windows).
function QrScanner({ onResult, onClose }) {
  const video = useRef(null);
  const [msg, setMsg] = useState('Abriendo cámara…');

  useEffect(() => {
    let stream;
    let frame;
    let done = false;
    const canvas = document.createElement('canvas');
    const ctx2d = canvas.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      if (done) return;
      const v = video.current;
      if (v && v.readyState >= 2 && v.videoWidth) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx2d.drawImage(v, 0, 0);
        const code = jsQR(ctx2d.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        if (code) {
          const key = ch.parseRemesaQr(code.data);
          if (key) {
            done = true;
            return onResult(key);
          }
          setMsg('Ese QR no es de Remesa.');
        }
      }
      frame = requestAnimationFrame(tick);
    };
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s;
        if (done) return;
        video.current.srcObject = s;
        video.current.play().catch(() => {});
        setMsg('Apunta al QR del receptor');
        tick();
      })
      .catch(() => setMsg('No se pudo abrir la cámara. Revisa el permiso del navegador.')) ??
      setMsg('Este navegador no permite usar la cámara (necesita https o localhost).');
    return () => {
      done = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="card scanner">
      <video ref={video} className="scanner-video" muted playsInline aria-label="Vista de la cámara para escanear el QR" />
      <small className="muted">{msg}</small>
      <button onClick={onClose}>Cancelar</button>
    </div>
  );
}

function EnvioEnCurso({ ctx, t, onNew }) {
  const { c, busy, run, now } = ctx;
  const left = Number(t.deadline) - now;
  const us = ctx.state.us;

  if (t.statusName === 'Reserved') {
    return (
      <div className="screen">
        <h2>Pagaste por Zelle</h2>
        <p className="muted">La garantía de la cajera ya está congelada en el contrato para tu envío.</p>
        <div className="bank zelle">
          <div className="bank-head">
            Zelle <Simulado />
          </div>
          <div className="row">
            <span>Para</span>
            <span>{us.bankInfo.replace('Zelle: ', '')}</span>
          </div>
          <div className="amount">{ch.fmtUSD(t.amountUSD)}</div>
          {left > 0 ? (
            <>
              <p className="ok">✔ Pagado. Esperando que la cajera confirme que recibió tu Zelle…</p>
              <small className="muted">Si no confirma, la reserva vence en {mmss(left)}</small>
            </>
          ) : (
            <>
              <p className="bad">La reserva caducó.</p>
              <button disabled={!!busy} onClick={() => run('Liberando reserva', () => ch.send(c, 'abuelita', 'remesa', 'expireReservation', [t.id]))}>
                Liberar y empezar de nuevo
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (t.statusName === 'Expired')
    return (
      <div className="screen">
        <h2>Reserva caducada</h2>
        <p className="muted">No se cobró nada. La garantía del cajero se liberó.</p>
        <button className="primary" onClick={onNew}>
          Nuevo envío
        </button>
      </div>
    );

  return (
    <div className="screen">
      <h2>Envío #{String(t.id)}</h2>
      <Tracker t={t} />
      <div className="quote">
        <div className="row">
          <span>Enviaste</span>
          <span>{ch.fmtUSD(t.amountUSD)}</span>
        </div>
        <div className="row">
          <span>Recibe</span>
          <strong>{ch.fmtMXN(t.amountMXN)}</strong>
        </div>
        <div className="row">
          <span>Comisión</span>
          <span className="ok">$0.00</span>
        </div>
      </div>
      {['Confirmed', 'Disputed'].includes(t.statusName) && (
        <button className="primary" onClick={onNew}>
          Nuevo envío
        </button>
      )}
    </div>
  );
}

function Tracker({ t }) {
  const steps = [
    ['Reserved', 'Cajero US apartado'],
    ['Assigned', 'Zelle recibido · cajero MX asignado'],
    ['Paid', 'SPEI enviado'],
    ['Confirmed', 'La nieta confirmó'],
  ];
  const at = t.status === 5 ? 3 : t.status; // Disputed stops after Paid
  return (
    <ol className="tracker">
      {steps.map(([s, label], i) => (
        <li key={s} className={at >= i + 1 ? 'done' : at === i ? 'now' : ''}>
          {label}
        </li>
      ))}
      {t.statusName === 'Disputed' && <li className="bad">En disputa: los fondos quedan congelados</li>}
    </ol>
  );
}

// ---------- Cajera US (receives Zelle, releases digital dollars) ----------

function CajeroUS({ ctx }) {
  const { c, state, busy, run, now } = ctx;
  const orders = state.transfers.filter((t) => t.cashierUS === c.addr.cajeroUS && t.statusName === 'Reserved' && Number(t.deadline) > now);
  return (
    <div className="screen">
      <h2>Zelle por confirmar</h2>
      {orders.length === 0 && <p className="muted">Esperando envíos…</p>}
      {orders.map((t) => {
        return (
          <div key={String(t.id)} className="bank zelle">
            <div className="bank-head">
              Zelle · envío #{String(t.id)} <Simulado />
            </div>
            <div className="amount">{ch.fmtUSD(t.amountUSD)}</div>
            <div className="row muted">
              <span>Sueltas al confirmar</span>
              <span>{ch.fmtUSD(t.usdtAmount)} digitales</span>
            </div>
            <p className="ok">✔ Te llegó el Zelle</p>
            <button
              className="primary"
              disabled={!!busy}
              onClick={() => run('Confirmando Zelle', () => ch.send(c, 'cajeroUS', 'remesa', 'createTransfer', [t.id]))}
            >
              Ya recibí el Zelle
            </button>
            <small className="muted">La reserva vence en {mmss(Number(t.deadline) - now)}</small>
          </div>
        );
      })}
      <h3>Mi garantía y reputación</h3>
      <CashierCard name="Chelsea" k={state.us} rateLabel="dólar digital por USD" />
      <History state={state} />
    </div>
  );
}

// ---------- Cajero MX (receives digital dollars, pays SPEI) ----------

function CajeroMX({ ctx }) {
  const { c, state } = ctx;
  const orders = state.transfers.filter((t) => t.cashierMX === c.addr.cajeroMX && t.statusName === 'Assigned');
  return (
    <div className="screen">
      <h2>Órdenes pendientes</h2>
      {orders.length === 0 && <p className="muted">Esperando órdenes…</p>}
      {orders.map((t) => (
        <SpeiCard key={String(t.id)} ctx={ctx} t={t} />
      ))}
      <h3>Mi garantía y reputación</h3>
      <CashierCard name="Rubén" k={state.mx} rateLabel="MXN por dólar" />
      <History state={state} />
    </div>
  );
}

function History({ state }) {
  return (
    <>
      <h3>Últimos envíos</h3>
      <ul className="history">
        {state.transfers.slice(0, 6).map((t) => (
          <li key={String(t.id)}>
            #{String(t.id)} · {ch.fmtUSD(t.amountUSD)} · <span className={`st ${t.statusName}`}>{STATUS_ES[t.statusName]}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function SpeiCard({ ctx, t }) {
  const { c, busy, run, now } = ctx;
  const [phase, setPhase] = useState(null);
  const [clabe, setClabe] = useState('');
  useEffect(() => {
    ch.clabeOf(c, t.recipient).then(setClabe).catch(() => {});
  }, [c, t.recipient]);
  const left = Number(t.deadline) - now;

  const pay = () =>
    run('Enviando SPEI', async () => {
      setPhase('Procesando…');
      await sleep(1500);
      const folio = ch.makeFolio();
      setPhase(`Folio ${folio}`);
      await ch.send(c, 'cajeroMX', 'remesa', 'markPaid', [t.id, folio]);
    }).finally(() => setPhase(null));

  return (
    <div className="bank spei">
      <div className="bank-head">
        SPEI · orden #{String(t.id)} <Simulado />
      </div>
      <div className="row">
        <span>CLABE</span>
        <span className="mono">{clabe}</span>
      </div>
      <div className="amount">{ch.fmtMXN(t.amountMXN)}</div>
      <div className="row muted">
        <span>Recibirás al confirmar</span>
        <span>{ch.fmtUSD(t.usdtAmount)} digitales</span>
      </div>
      {left > 0 ? (
        <>
          <button className="primary" disabled={!!busy} onClick={pay}>
            {phase ? <Loader label={phase} /> : 'Enviar SPEI'}
          </button>
          <small className={left < 120 ? 'bad' : 'muted'}>Plazo para pagar: {mmss(left)}</small>
        </>
      ) : (
        <>
          <p className="bad">Se venció el plazo.</p>
          <button disabled={!!busy} onClick={() => run('Reasignando', () => ch.send(c, 'abuelita', 'remesa', 'reassignOnTimeout', [t.id]))}>
            Reasignar a otro cajero
          </button>
        </>
      )}
    </div>
  );
}

function CashierCard({ name, k, rateLabel }) {
  return (
    <div className="card">
      <div className="card-head">
        <strong>{name}</strong>
        <span className={k.active ? 'ok' : 'bad'}>{k.active ? 'activo' : 'inactivo'}</span>
      </div>
      <div className="row">
        <span>Garantía</span>
        <span>{ch.fmtUSD(k.collateral)}</span>
      </div>
      <div className="row">
        <span>Congelada</span>
        <span>{ch.fmtUSD(k.locked)}</span>
      </div>
      <div className="row">
        <span>Tipo ({rateLabel})</span>
        <span>{ch.fmtRate(k.rate)}</span>
      </div>
      <div className="row">
        <span>Reputación</span>
        <span>
          ✔ {k.successCount} · ✖ {k.failCount}
        </span>
      </div>
    </div>
  );
}

// ---------- Recibido (recipient) ----------

// First visit of a new recipient (e.g. the phone's Product account): claim an alias and a CLABE once.
function RegistrarClave({ ctx }) {
  const { c, busy, run } = ctx;
  const [alias, setAlias] = useState('');
  const [clabe, setClabe] = useState('');
  const ok = alias.length > 0 && /^\d{18}$/.test(clabe);
  return (
    <div className="screen">
      <h2>Registra tu clave para recibir</h2>
      <p className="muted">Una sola vez. Quien te envíe dinero usará tu alias, tu CLABE o tu código QR.</p>
      <label>
        Alias
        <input value={alias} onChange={(e) => setAlias(e.target.value.trim().toLowerCase())} placeholder="ej. sofia" />
      </label>
      <label>
        CLABE (18 dígitos) <Simulado />
        <input inputMode="numeric" value={clabe} onChange={(e) => setClabe(e.target.value.replace(/\D/g, '').slice(0, 18))} />
      </label>
      <button className="primary" disabled={!!busy || !ok} onClick={() => run('Registrando tu clave', () => ch.send(c, 'nieta', 'remesa', 'registerKey', [alias, clabe]))}>
        Registrar
      </button>
    </div>
  );
}

function Recibido({ ctx }) {
  const { c, state, busy, run } = ctx;
  const latest = state.transfers.find((t) => t.recipient === c.addr.nieta && ['Paid', 'Confirmed', 'Disputed'].includes(t.statusName));
  const incoming = state.transfers.find((t) => t.recipient === c.addr.nieta && t.statusName === 'Assigned');
  const [paidTx, setPaidTx] = useState(null);
  const [qr, setQr] = useState(null);
  // QR the sender scans to fill in the recipient key. Prefix "remesa:" tells our scanner it is ours.
  const [myQr, setMyQr] = useState(null);

  // The CLABE always resolves to this recipient, so the QR works for whoever is signed in (demo nieta or the phone's account).
  useEffect(() => {
    if (!state.clabe) return setMyQr(null);
    QRCode.toDataURL(`${ch.QR_PREFIX}${state.clabe}`, { margin: 1, width: 160 }).then(setMyQr);
  }, [state.clabe]);

  useEffect(() => {
    setPaidTx(null);
    if (!latest) return;
    ch.findEventTx(c, 'Paid', latest.id).then(setPaidTx).catch(() => {});
  }, [c, latest?.id]);

  useEffect(() => {
    if (!paidTx) return setQr(null);
    QRCode.toDataURL(ctx.txUrl(paidTx) ?? paidTx, { margin: 1, width: 140 }).then(setQr);
  }, [paidTx]);

  // After all hooks: React needs the same hook count on every render, before and after registering.
  if (!state.clabe) return <RegistrarClave ctx={ctx} />;

  return (
    <div className="screen">
      <div className="bank mx">
        <div className="bank-head">
          Mi banco <Simulado />
        </div>
        <div className="muted">Saldo disponible</div>
        <div className="amount">{ch.fmtMXN(state.mxnBalance)}</div>
        <div className="mono muted">CLABE {state.clabe}</div>
      </div>

      <div className="card">
        <div className="card-head">
          <strong>Mi código para cobrar</strong>
        </div>
        {myQr && <img className="qr" src={myQr} alt="Código QR con tu clave para recibir dinero" />}
        <small className="muted">Muéstralo para que te envíen dinero. Lo escanean desde la pantalla "Enviar".</small>
      </div>

      {incoming && <div className="notice wait"><Loader /> Tu dinero viene en camino (envío #{String(incoming.id)})…</div>}

      {latest && (
        <>
          {latest.statusName === 'Paid' && <div className="notice">🔔 Recibiste {ch.fmtMXN(latest.amountMXN)}</div>}
          <div className="receipt">
            <h3>Recibo · envío #{String(latest.id)}</h3>
            <div className="row">
              <span>Monto</span>
              <strong>{ch.fmtMXN(latest.amountMXN)}</strong>
            </div>
            <div className="row">
              <span>Enviado</span>
              <span>{ch.fmtUSD(latest.amountUSD)}</span>
            </div>
            <div className="row">
              <span>Folio SPEI</span>
              <span className="mono">{latest.folio}</span>
            </div>
            <div className="row">
              <span>Fecha</span>
              <span>{new Date(Number(latest.paidAt) * 1000).toLocaleString('es-MX')}</span>
            </div>
            <div className="row">
              <span>Estado</span>
              <span className={`st ${latest.statusName}`}>{STATUS_ES[latest.statusName]}</span>
            </div>
            {qr && <img className="qr" src={qr} alt="Código QR del recibo en el explorador de bloques" />}
            <TxLink ctx={ctx} hash={paidTx} label="Comprobante en la blockchain" />
          </div>
          {latest.statusName === 'Paid' && (
            <div className="actions">
              <button className="primary pay" disabled={!!busy} onClick={() => run('Confirmando', () => ch.send(c, 'nieta', 'remesa', 'confirm', [latest.id]))}>
                Recibí
              </button>
              <button className="danger" disabled={!!busy} onClick={() => run('Abriendo disputa', () => ch.send(c, 'nieta', 'remesa', 'dispute', [latest.id]))}>
                No me llegó
              </button>
            </div>
          )}
        </>
      )}
      {!latest && !incoming && <p className="muted">Aún no hay envíos.</p>}
    </div>
  );
}

// ---------- Preparar (setup) ----------

function Preparar({ ctx, setCfg }) {
  const { c, cfg, state, busy, run, refresh } = ctx;
  const [rows, setRows] = useState(null);
  const [log, setLog] = useState([]);
  const [usd, setUsd] = useState(cfg.usd);
  const [remesa, setRemesa] = useState(cfg.remesa);
  const [showKeys, setShowKeys] = useState(false);
  const [keysText, setKeysText] = useState(() => JSON.stringify(cfg.keys, null, 2));
  const importKeys = () => {
    try {
      const keys = JSON.parse(keysText);
      if (!ch.ROLES.every((r) => /^0x[0-9a-fA-F]{64}$/.test(keys[r] ?? ''))) throw new Error();
      LS.set('remesa.keys', Object.fromEntries(ch.ROLES.map((r) => [r, keys[r]])));
      location.reload();
    } catch {
      alert('Texto inválido: debe ser el JSON exportado con las 4 cuentas.');
    }
  };
  const ready = !!(cfg.usd && cfg.remesa);

  useEffect(() => {
    if (!ready) return;
    ch.readBalances(c).then(setRows).catch(() => setRows(null));
  }, [c, ready, state?.nextId, busy]);

  const switchMode = (mode) => {
    LS.set('remesa.mode', mode);
    location.reload();
  };
  const save = (a = { usd: usd.trim(), remesa: remesa.trim() }) => {
    LS.set('remesa.testnet', a);
    loadConfig().then(setCfg);
  };
  const deploy = () =>
    run('Desplegando contratos', async () => {
      const a = await ch.deployDemo(c, (l) => setLog((x) => [...x, l]));
      setUsd(a.usd);
      setRemesa(a.remesa);
      save(a);
    });

  return (
    <div className="screen wide">
      <h2>Preparar la demo</h2>
      <div className="actions">
        <button className={cfg.mode === 'local' ? 'primary' : ''} onClick={() => switchMode('local')}>
          Cadena local
        </button>
        <button className={cfg.mode === 'testnet' ? 'primary' : ''} onClick={() => switchMode('testnet')}>
          Polkadot Hub TestNet
        </button>
      </div>

      {cfg.mode === 'local' && (
        <p className="muted">
          Cadena local de prueba (Ganache). Se arranca con <code>npm run demo</code>, que ya despliega los contratos y deja la demo lista.
        </p>
      )}

      {cfg.mode === 'testnet' && (
        <div className="card">
          <p>
            1. Pide PAS en el{' '}
            <a href="https://faucet.polkadot.io" target="_blank" rel="noreferrer">
              faucet
            </a>{' '}
            (Paseo → Asset Hub 1000) para la abuelita: <code className="mono">{c.addr.abuelita}</code>
          </p>
          <p>2. Despliega los contratos desde aquí (firma la abuelita y queda como reporter), o pega direcciones ya desplegadas:</p>
          <button className={ready ? '' : 'primary'} disabled={!!busy} onClick={deploy}>
            Desplegar contratos
          </button>
          {!ready && log.length > 0 && <pre className="log">{log.join('\n')}</pre>}
          <label>
            Dirección de MockUSD
            <input className="mono" value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="0x…" />
          </label>
          <label>
            Dirección de Remesa
            <input className="mono" value={remesa} onChange={(e) => setRemesa(e.target.value)} placeholder="0x…" />
          </label>
          <button onClick={() => save()}>Guardar direcciones</button>
          <p>3. Toca "Preparar demo". La abuelita reparte PAS, aprueba a Chelsea y a Rubén como cajeros y los registra.</p>
        </div>
      )}

      {ready && (
        <>
          <button className="primary" disabled={!!busy} onClick={() => run('Preparando demo', () => ch.setupDemo(c, (l) => setLog((x) => [...x, l])))}>
            Preparar demo
          </button>
          {log.length > 0 && <pre className="log">{log.join('\n')}</pre>}
          {cfg.mode === 'local' && (
            <button
              disabled={!!busy}
              onClick={async () => {
                await c.pub.request({ method: 'evm_increaseTime', params: [16 * 60] });
                await c.pub.request({ method: 'evm_mine', params: [] });
                refresh();
              }}
            >
              ⏩ Adelantar el reloj 16 min (probar caducidad y reasignación)
            </button>
          )}
          <table className="accounts">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Dirección</th>
                <th>PAS</th>
                <th>mUSD</th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.role}>
                  <td>{ROLE_ES[r.role]}</td>
                  <td className="mono">
                    <TxAddr cfg={cfg} a={r.address} />
                  </td>
                  <td className={r.pas < ch.parseUnits('0.2', 18) ? 'bad' : ''}>{Number(ch.formatUnits(r.pas, 18)).toFixed(3)}</td>
                  <td>{Number(ch.formatUnits(r.usd, 18)).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {state && (
            <p className="muted">
              Referencia en el contrato: {ch.fmtRate(state.referenceRate)} MXN/USD (la actualiza el reporter con <code>setReferenceRate</code> desde
              Remix).
            </p>
          )}
        </>
      )}

      {cfg.mode === 'testnet' && (
        <>
          <button onClick={() => setShowKeys((s) => !s)}>{showKeys ? 'Ocultar' : 'Exportar'} cuentas de demo</button>
          {showKeys && (
            <>
              <p className="bad">Solo red de pruebas. Guarda este texto si vas a borrar los datos del navegador.</p>
              <p className="muted">Para usar las mismas cuentas en otro dispositivo, pega aquí el texto exportado y toca "Importar".</p>
              <textarea className="mono" rows={6} value={keysText} onChange={(e) => setKeysText(e.target.value)} />
              <button onClick={importKeys}>Importar cuentas</button>
            </>
          )}
        </>
      )}
    </div>
  );
}

function TxAddr({ cfg, a }) {
  return cfg.explorer ? (
    <a href={`${cfg.explorer}/address/${a}`} target="_blank" rel="noreferrer">
      {short(a)}
    </a>
  ) : (
    short(a)
  );
}
