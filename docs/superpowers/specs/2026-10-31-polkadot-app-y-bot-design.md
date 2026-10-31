# Remesa — Polkadot App + bot de cajeros (diseño, 2026-10-31)

Extiende `2026-10-31-remesa-demo-design.md`. Lo que no se menciona aquí sigue igual que allí
(contratos, unidades, pantallas, modo offline). Fuente de verdad del producto: `CLAUDE.md`.
Datos de red, SDK y publicación: skill `polkadot-products-devnet/references/*` (citada en cada punto).

## 1. Qué cambia y por qué

El diseño anterior firmaba todo con 4 cuentas de demo en el navegador y dejaba la Polkadot App como
"siguiente paso". Ahora:

- **Abuelita y nieta firman desde la Polkadot App del teléfono**, con su cuenta del Product y gas PGAS.
  Nunca ven crypto ni necesitan PAS. Es lo que dice el pitch.
- **Los cajeros no firman desde una pantalla.** Se registran y depositan garantía una vez. Después, un
  **bot** (un script de Node que corre solo) escucha el contrato y responde: confirma el Zelle, hace el
  SPEI simulado y marca `Paid`. Nadie está pegado a la pantalla.
- **La pantalla Cajero pasa a ser un monitor** de solo lectura: muestra lo que el bot va haciendo.

Frase guía intacta: el intermediario que decide se reemplaza por reglas públicas; el bot solo obedece
al contrato, no decide nada.

## 2. Metas, no-metas, anti-metas

**Metas**
- Un envío completo (Reserved → Confirmed) donde las dos únicas firmas humanas son: abuelita en
  `reserve`, nieta en `confirm`. Ambas desde la Polkadot App.
- La app abre en la Polkadot App desde un nombre `.dot`.
- El bot corre en una laptop del equipo durante la demo y actúa en segundos.
- El monitor Cajero se ve en el proyector junto a los dos teléfonos.

**No-metas (hoy)**
- Dirección MXN → USD, resolución de disputas, Proof of Personhood, OpenGov.
- Detectar pagos bancarios reales (Zelle/SPEI). El bot los simula con un retardo.
- Figura de "operador delegado" en el contrato: el cajero *es* la llave del bot.
- Que el bot corra en un servidor; corre en una laptop.

**Anti-metas (si pasa, la demo falla aunque "funcione")**
- Que la abuelita vea una dirección `0x…`, un token o la palabra "gas".
- Que alguien del equipo tenga que apretar un botón de cajero en escena.
- Que una sola pieza nueva (SDK, pad, nombre `.dot`) deje sin demo si falla: siempre debe haber
  camino de respaldo (sección 8).

## 3. Restricciones (verificadas en la skill, salvo lo marcado)

| Restricción | Fuente |
|---|---|
| Red: Products Devnet, Asset Hub 1000, chainId `420420417`, ETH-RPC `https://eth-rpc-testnet.polkadot.io`, explorador Blockscout, faucet → Paseo → Asset Hub (1000) | `red-devnet.md` |
| Ningún Host abre `localhost`. Conectar, firmar y PGAS solo con la app publicada en su `.dot` | `app-sdk.md`, *Dónde probar* |
| SDK solo con **pnpm 12.6.0** y versiones exactas: `@parity/product-sdk` 0.39.0, `polkadot-api` 3.2.1, descriptores PCF `0.14.0-pcf.1`, `viem` 2.56.9, overrides acotados en `pnpm-workspace.yaml` | `versiones.md` |
| Conectar con `createChainClient({ chains: { assetHub: devnet_asset_hub } })`; contrato con `createContract(runtime, addr, abi, { defaultOrigin, defaultSigner })`; `.query()` antes de cada `.tx()`; una firma a la vez; `waitFor: 'finalized'` o `'best-block'` | `app-sdk.md`, *Flujo completo* |
| La cuenta del Product es distinta por dominio: `me.h160Address` es el `msg.sender` que ve el contrato. Cambiar de nombre `.dot` cambia las direcciones | `contratos.md`, *Cuentas*; `publicar.md` §5 |
| Lecturas por ETH-RPC con viem funcionan desde dentro del Host (CORS abierto) | `app-sdk.md`, *Lecturas rápidas* |
| Escribir por ETH-RPC con viem desde dentro del Host: **no verificado** | — |
| Vite: `base: './'` + plugin `soloDescriptorDevnet` (deja solo el descriptor del devnet en el build) | `app-sdk.md`, *Vite* |
| Publicar: `pad` 0.22.1 con `--env devnet --js-merkle --no-manifest`, sin sesión, a un nombre temporal; copiar `CID:` y pegarlo con *Resolve* en el nombre propio desde `dotns.dot` en el teléfono. ~4 min por publicación. Bulletin borra a los ~14 días | `publicar.md` §2–3 |
| Nombre `.dot`: 9 caracteres o más, 10 PAS reembolsables, se compra desde `dotns.dot` en la Polkadot App; es de la cuenta del teléfono | `publicar.md` §1 |
| Polkadot App Android `devnet/2026-10-22.1`: conectar, PGAS y firmar ✅. iOS: **por verificar** | `versiones.md` |
| Entrega: hoy 31 de octubre | `CLAUDE.md` |

## 4. Enfoques considerados

| | A. Product SDK (elegido) | B. Build actual publicado con llaves de demo embebidas |
|---|---|---|
| Qué firma la abuelita | Su cuenta del Product en la Polkadot App; gas PGAS | Una llave de prueba guardada en el navegador, con PAS del faucet |
| Código nuevo | Capa de conexión al Host en `chain.js`; migración a pnpm | Casi nada |
| Riesgo | SDK nunca usado en este repo; ciclo de prueba de ~4 min por publicación | Firma por HTTP desde el Host **no verificada**; al jurado hay que decir "la firma real es el siguiente paso" |
| Cumple el pitch ("nunca ven crypto") | Sí | A medias |

Descartado: **C, no tocar la Polkadot App hoy** (todo en navegador normal). No cumple lo pedido.

**Decisión del usuario: A, con B como paracaídas.** El camino de publicación se arma primero con el
build actual (eso ya es B); luego se cambia solo la conexión de Enviar y Recibido al SDK. Si a la hora
límite el SDK no firma en el teléfono, se entrega B con la publicación ya hecha.

## 5. Arquitectura

```
Teléfono abuelita ──Polkadot App──┐                      ┌── Laptop del equipo
  Enviar: reserve()  (firma 1)    │   Products Devnet    │   bot.mjs (viem, llaves cajeroUS y cajeroMX)
                                  ├── Remesa + MockUSD ──┤   createTransfer / markPaid / expire / reassign / autoRelease
Teléfono nieta ───Polkadot App────┤                      │
  Recibido: registerKey (1 vez),  │                      └── Navegador: #cajero (monitor, solo lectura)
            confirm() (firma 2)   │
                                  └── Lecturas: ETH-RPC con viem (todos)
```

Tres piezas, un contrato, ningún backend propio:

1. **Contrato** (`contracts/`): sin cambios. Desplegado en Products Devnet desde Remix (diseño anterior).
2. **Bot de cajeros** (`app/scripts/bot.mjs`): Node + viem, reutiliza `connect`, `send`, `getTransfer`,
   `makeFolio` y `setupDemo` de `app/src/chain.js`.
3. **App web** (`app/`): el mismo Vite + React. Dentro del Host, Enviar y Recibido firman con el SDK.
   Fuera del Host, siguen funcionando con las llaves de demo (es el modo actual y el respaldo B).

### 5.1 Bot de cajeros

- Arranca con las llaves de prueba de `cajeroUS` y `cajeroMX` (variables de entorno `BOT_KEY_US`,
  `BOT_KEY_MX`; **nunca** en el repo ni en el chat). Ambas con PAS del faucet.
- Al arrancar corre `setupDemo` (registra cajeros y deposita garantía si falta). `setupDemo` deja de
  fondear desde la abuelita y de registrar la clave de la nieta cuando esas llaves no existen: en
  este modo la nieta se registra sola desde el teléfono (5.3).
- Cada 2 s lee `nextId` y los envíos no finales (`transfers(id)` hacia atrás hasta encontrar `N`
  consecutivos en estado final; `N = 10`). Sin cursor de eventos: menos estado, se recupera solo tras
  un reinicio.
- Reglas, en orden, **una transacción a la vez** (nonce) y una por envío por vuelta:

  | Ve | Hace | Simula |
  |---|---|---|
  | `Reserved`, `cashierUS == yo` | espera `ZELLE_DELAY_MS` (3 000) desde que lo vio y llama `createTransfer(id)` | "llegó el Zelle" |
  | `Assigned`, `cashierMX == yo` | espera `SPEI_DELAY_MS` (2 000) y llama `markPaid(id, makeFolio())` | "hice el SPEI" |
  | `Reserved` vencido | `expireReservation(id)` | limpieza |
  | `Assigned` vencido | `reassignOnTimeout(id)` | castigo al cajero lento |
  | `Paid` con `paidAt + AUTO_RELEASE` cumplido | `autoRelease(id)` | las 24 h |

- Si una llamada revierte (otro ya lo hizo, cambió el estado) se registra y se sigue; no se reintenta
  en bucle. Si el RPC falla, espera y reintenta la vuelta.
- Imprime una línea por acción con `id`, estado y hash. Esa salida es la que se muestra en el monitor
  (5.4) a través de la cadena, no de un canal propio.
- Misma lógica en Ganache y en la red: `pnpm demo` arranca cadena local + bot + app, así todo el flujo
  automático se prueba offline antes de tocar la red.

### 5.2 App web dentro del Host (Enviar y Recibido)

- Al cargar: `isInsideContainer()`. Si es `true`, **modo Host**; si no, modo actual (llaves de demo).
- Modo Host, al entrar a Enviar o Recibido: `createChainClient`, `SignerManager.connect()`,
  `getProductAccount(productId, 0)`, `requestResourceAllocation([SmartContractAllowance])`. El Host
  muestra hasta tres permisos; el usuario acepta los tres (`app-sdk.md`, *Permisos al conectar*).
  `productId` sale del hostname (`mi-app.dot`, `mi-app.dev-dot.li` → `mi-app.dot`); si no se puede
  deducir, constante `PRODUCT_ID` en `chain.js`.
- `send(c, role, contract, fn, args)` gana un camino: si `c.host` existe, ignora `role`, hace
  `contract[fn].query(...args, { origin: me.address })` y, si `success`, `contract[fn].tx(...args,
  { waitFor: 'best-block', timeoutMs: 300_000 })`. Devuelve el hash si el SDK lo expone; si no,
  el recibo se busca por evento como hoy (`findEventTx`). Los errores del SDK se mapean a `ERROR_ES`
  por la tabla de `app-sdk.md`, *Errores de firma frecuentes*.
- **Lecturas** siguen por viem/ETH-RPC (`readState`), igual que hoy. Para vistas que dependen de
  `msg.sender` se pasa `me.h160Address`.
- La "cuenta del usuario" en modo Host es `me.h160Address`. Enviar filtra "mi último envío" por
  `sender == me.h160Address`; Recibido por `recipient == me.h160Address`.
- Las pestañas Demo, Cajero y Preparar **no** se muestran en modo Host. Pantalla de inicio en el
  teléfono: dos botones grandes, "Enviar" y "Recibir".
- Si la conexión al Host falla, se muestra "No se pudo conectar con la Polkadot App" y un botón
  discreto "Usar cuenta de demo" que cae al modo actual (respaldo B dentro de la misma build).
- Sello de versión (fecha/hora del build) en el pie: para saber qué CID cargó el Host
  (`publicar.md` §5).

### 5.3 Flujo en escena (una abuelita, una nieta, dos teléfonos)

Teléfonos del equipo: 1 Android y 3 iPhone. La Polkadot App está verificada en Android, no en iOS
(`versiones.md`). Por eso:

- **Abuelita = el Android** (su firma, `reserve`, es la que abre la demo).
- **Nieta = un iPhone** con la Polkadot App de devnet (TestFlight). Se prueba primero; si iOS no
  conecta, la nieta también va en el Android.
- Para que un solo aparato pueda hacer los dos papeles, cada rol usa su propia cuenta del Product:
  **Enviar → `getProductAccount(productId, 0)`, Recibir → `getProductAccount(productId, 1)`**, cada
  una con su `SmartContractAllowance` (`Index` 0 y 1). Así abuelita y nieta nunca son la misma
  dirección aunque compartan teléfono. *(Decisión propia, ver §7.)*

Preparación (una vez, antes de la demo):
1. Nieta abre la app en su Polkadot App → Recibir → "Registrar mi clave": escribe alias y CLABE →
   firma `registerKey`. Esto fija su cuenta del Product como `recipient`. **Debe hacerse desde el
   nombre `.dot` definitivo**, porque la cuenta cambia con el dominio.
2. El bot está corriendo en la laptop; el monitor Cajero abierto en el proyector.

Demo (60 s):
1. Abuelita → Enviar: alias de la nieta, 100 → ve "recibirá ~1,683 MXN", tipo del cajero vs
   referencia, "Comisión $0.00". Toca **"Pagar $100.00"** (recuadro Zelle, SIMULADO) → firma
   `reserve`. Es su única firma: la reserva y el "pago" se unen en un gesto. *(Decisión propia, ver §7.)*
2. Bot: ~3 s → `createTransfer` (asigna cajero MX) → ~2 s → `markPaid` con folio.
   El monitor va mostrando cada paso con temporizadores.
3. Nieta: notificación "Recibiste $1,683.00 MXN", recibo con folio y QR a Blockscout. Toca **"Recibí"**
   → firma `confirm`. Garantía liberada al cajero MX, reputación +1.

### 5.4 Monitor Cajero

- El componente `Cajero` actual sin los botones de firma (`markPaid`, `reassignOnTimeout`) y sin la
  tarjeta SPEI interactiva; en su lugar, la lista de envíos con estado, cuenta regresiva, folio y
  "hecho por el bot" con enlace al explorador. Garantía/bloqueado/reputación de los dos cajeros se
  quedan.
- Se abre en cualquier navegador (`#cajero`); solo lee.

### 5.5 Repositorio y herramientas

- `app/` migra a **pnpm**: se borra `package-lock.json`, se agrega `pnpm-workspace.yaml` con los
  overrides acotados y `minimumReleaseAgeExclude` de `versiones.md`, `devEngines` en `package.json`,
  dependencias nuevas con versión exacta (`@parity/product-sdk`, descriptores PCF, `polkadot-api`).
  `viem` ya está en 2.56.9. Scripts `test`, `demo`, `compile` se quedan; se agrega `bot`.
- `vite.config.js`: se agrega el plugin `soloDescriptorDevnet` de `app-sdk.md`.
- `polkadot-app-deploy.config.mjs` (icono, nombre, descripción) **solo si sobra tiempo**; hoy se
  publica con `--no-manifest`.
- El icono, si se hace: PNG 512×512 en `app/assets/`.

### 5.6 Publicación

1. Una persona del equipo compra el nombre `.dot` (9+ letras, sin dígitos al final salvo exactamente
   dos) desde `dotns.dot` en su Polkadot App. Necesita 10 PAS en la cuenta del teléfono. **Por
   verificar:** que el faucet acepte la dirección SS58 del teléfono (acepta `0x…`).
2. `pnpm build` → `pad .\dist <tmp>.dot --env devnet --js-merkle --no-manifest` (función de
   `publicar.md` §2, nombre temporal con fecha en letras) → copiar `CID:` → `dotns.dot` → *My Domains*
   → *Resolve* → pegar → firmar en el teléfono.
3. Abrir el nombre en la Polkadot App de los dos teléfonos.
4. Cada cambio de código repite 2–3 (~4 min). Comprobación sin Host: `https://<tmp>.dev-dot.li`.

## 6. Orden de construcción (cada paso deja algo demostrable)

1. **Bot + monitor en Ganache** (`pnpm demo` levanta cadena, bot y app). Prueba automática: un test
   que hace `reserve` y espera a que el bot lleve el envío a `Paid` sin tocar cajeros. Sin red, sin
   Host. Si solo esto sale, la demo ya es "cajeros automáticos" en navegador.
2. **Contratos en la red** (Remix, diseño anterior) + bot apuntando a la red con llaves del faucet.
3. **Publicación** del build actual en el `.dot` (paracaídas B listo).
4. **Modo Host** en `chain.js` + Enviar/Recibido + pantalla de inicio del teléfono. Publicar y probar
   en Android.
5. Si sobra: manifest con icono; iOS.

## 7. Decisiones tomadas por mí (corregibles)

- El toque "Pagar $100.00" firma `reserve`; el bot simula la llegada del Zelle 3 s después. Antes
  eran dos botones (reservar y luego "cajero confirma"). Motivo: una sola firma para la abuelita y
  ningún botón de cajero en escena.
- El bot no usa cursor de eventos: relee los envíos abiertos. Motivo: menos estado, sobrevive reinicios.
- El cajero *es* la llave del bot; no hay operador delegado en el contrato. Motivo: cero cambios en
  Solidity hoy.
- Retardos del bot: 3 s (Zelle) y 2 s (SPEI). Suficiente para que el público vea el cambio de estado.
- Índices de derivación por rol (Enviar 0, Recibir 1). Motivo: un solo Android puede hacer de abuelita
  y de nieta si los iPhone fallan, sin que se mezclen las direcciones.
- `waitFor: 'best-block'` en el teléfono: la abuelita ve el resultado al entrar en bloque, no al
  finalizar. Igual que hoy con viem.
- Fuera del Host la app sigue en modo llaves de demo. Motivo: el equipo prueba la UI en el navegador y
  es el respaldo B sin otra build.
- Las direcciones de `MockUSD` y `Remesa` en la red van **dentro del build** (`app/public/testnet.json`,
  leído como hoy se lee `local.json`), no en `localStorage`: en modo Host no existe la pestaña
  Preparar. Cada redespliegue del contrato obliga a republicar y a que la nieta repita `registerKey`,
  así que los contratos se despliegan una vez, antes del paso 3.
- En la red, Preparar **ya no registra cajeros** desde el navegador: los cajeros son solo el bot. Si el
  navegador registrara otro cajero con la misma tarifa podría ganar la asignación y el bot no podría
  confirmarlo (el envío quedaría colgado 15 min). Preparar en testnet solo fondea y muestra saldos de
  las llaves de demo de abuelita y nieta (respaldo B). En Ganache (`pnpm demo`) el bot corre con las
  llaves deterministas de los cajeros, así que no hay duplicados.

## 8. Riesgos y plan B

| Riesgo | Efecto | Plan B |
|---|---|---|
| El SDK no conecta o no firma en el teléfono | Sin firma de la abuelita | "Usar cuenta de demo" en la misma app publicada (B). Decirlo en el pitch |
| Escribir por ETH-RPC desde el Host no funciona (B no verificado) | B tampoco firma dentro de la Polkadot App | Abrir la app en el navegador del teléfono (`https://<tmp>.dev-dot.li`) con llaves de demo |
| No se consigue el nombre `.dot` (PAS en el teléfono, commit-reveal) | Nada abre en la Polkadot App | `dev-dot.li` del nombre temporal en navegador; bot y monitor no dependen de esto |
| La cuenta del Product cambia al cambiar de dominio | `registerKey` de la nieta queda en otra cuenta | Registrar la clave solo desde el nombre definitivo; si cambia, repetir el paso (una firma) |
| Bulletin borra a los ~14 días | La app desaparece después del evento | Irrelevante hoy; republicar si se vuelve a mostrar |
| Bot y teléfono compiten por el nonce | No: son cuentas distintas | — |
| Dos bots a la vez (dos laptops) | "nonce too low" en el bot | Un solo bot encendido |
| RPC lento o caído | Bot no actúa | Bot reintenta; monitor muestra "sin conexión". Video de respaldo grabado al terminar el paso 1 |
| pnpm rompe algo que funcionaba con npm (`ganache`, `solc`) | `pnpm test`/`demo` fallan | Hacer la migración en el paso 1, con los tests actuales como red |

## 9. Verificación

- `pnpm test`: lo de antes + test del bot en Ganache (un `reserve` termina en `Paid` con folio sin
  llamadas manuales de cajero; un `Reserved` vencido termina `Expired`).
- `node .claude/skills/polkadot-products-devnet/scripts/verificar-entorno.mjs app` sin ✘ tras la
  migración a pnpm.
- Manual, en Android: conectar (tres permisos), `registerKey` de la nieta, `reserve` de la abuelita,
  ver al bot actuar en el monitor, `confirm` de la nieta, recibo abierto en Blockscout.

## 10. Lo que queda al constructor

- Forma exacta de la pantalla de inicio del teléfono y de los textos.
- Cómo mostrar en el monitor "lo hizo el bot" (basta el enlace al explorador).
- Formato de las líneas de log del bot.
- Detalles de `pnpm-workspace.yaml` y del plugin de Vite: copiar de la skill tal cual.
