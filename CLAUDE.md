# CLAUDE.md — Remesa comunitaria US⇄MX sobre Polkadot

Proyecto para el Polkadot University Bootcamp + Hackathon (FACPYA UANL, 29–31 oct 2026).
Se entrega el 31 de octubre. Prioridad absoluta: una demo que funcione de punta a punta.

## Cómo trabajar conmigo

- Explícame en español, con lenguaje simple. Si usas un término técnico nuevo, explícalo en una línea.
- Código, nombres de variables, funciones, eventos y comentarios: en inglés.
- Cuando cambies un archivo, dame SIEMPRE el archivo completo, nunca fragmentos.
- Un solo paso por mensaje. Dime qué hacer, espera a que confirme que funcionó, y luego el siguiente.
- No cambies el alcance sin preguntarme. Si algo no cabe en el tiempo, dilo y propón qué recortar.
- Si no sabes un dato de la red o de la Polkadot App, no lo inventes: pregúntame o márcalo como pendiente.

## Qué estamos construyendo

"Bitso, pero comunitario y transparente". Una abuelita en EE. UU. paga 100 USD por Zelle y su nieta
en México recibe ~1,700 MXN por SPEI en segundos, sin comisión visible y sin una empresa dueña del dinero.

Frase guía: **reemplazamos al intermediario que decide por uno que solo obedece reglas públicas.**

### Actores

- **Usuarios** (remitente y receptor): solo ven clave, monto, botón y recibo. Nunca ven crypto.
- **Cajeros**: personas de la comunidad con cuenta de banco. Bloquean una garantía en dólar digital
  dentro del contrato, publican su tipo de cambio y compiten. Ganan por margen en el tipo de cambio.
  - Cajero US: recibe Zelle, suelta dólar digital.
  - Cajero MX: recibe dólar digital, hace SPEI.
- **Contrato `Remesa`**: la caja fuerte con reglas. Bloquea, asigna, libera y registra. Cobra 0%.
- **Dólar digital**: lo único que cruza la frontera. En producción USDT/USDC/dotUSD; en la demo `MockUSD`.

### Por qué crypto

Un contrato no puede tener cuenta de banco. El dólar digital es el único dinero que un contrato puede
guardar y mover solo, sin que nadie tenga la llave. Permite que dos cajeros desconocidos hagan negocio
(el dinero ya está bloqueado antes de que alguien pague) y que la garantía no la custodie nadie.

## Flujo de un envío (USD → MXN)

1. **Reserved**: el remitente pide enviar. El contrato elige al cajero US con mejor precio y le congela
   la garantía por el monto, con caducidad (15 min). Solo entonces se muestra a dónde pagar.
2. Remitente paga por Zelle (fuera de la cadena; en la demo, simulado).
3. **Created**: el cajero US confirma el pago. Los USDT quedan bloqueados al envío.
4. **Assigned**: en la misma transacción, el contrato elige al cajero MX activo con mejor precio,
   garantía libre y máximo suficiente; calcula `amountMXN`; verifica el tope contra la referencia;
   fija plazo de pago (15 min).
5. Cajero MX hace SPEI (fuera de la cadena; en la demo, simulado).
6. **Paid**: el cajero MX llama `markPaid(id, folio)`.
7. **Confirmed**: el receptor confirma, o pasan 24 h (`autoRelease`). Los USDT pasan a la garantía del cajero MX.

Otros estados: **Disputed** (receptor dice "no me llegó"; se congela) y **Expired** (la reserva caducó).
Si el cajero MX no paga a tiempo: `reassignOnTimeout` al siguiente cajero y baja reputación.

Opcional si sobra tiempo: dirección inversa `MXN_TO_USD` (SPEI de entrada, Zelle de salida). Mismo flujo,
cada cajero publica dos precios. Reequilibra el inventario de los cajeros sin exchange.

## Reglas económicas y de seguridad

- Usuario: 0 comisión. La app muestra "tipo del cajero" vs "referencia Banxico".
- Cajero: gana el margen. Tope `maxSpreadBps` (por ejemplo 150 = 1.5%) bajo la referencia.
- Garantía mínima ≥ monto máximo que atiende. La parte usada en envíos abiertos queda congelada.
- Retiro de garantía con espera (48 h; en la demo puede ser corto).
- Reputación: `successCount`, `failCount` por cuenta.
- Anti-congelamiento: reservas caducan; límite de reservas abiertas por cuenta.
- La referencia de tipo de cambio la escribe un `reporter` (nosotros). No fija precios, solo limita el margen.
- El contrato nunca le presta dinero ajeno a un cajero.

## Stack (decidido, no proponer otro)

- **Red**: la red de pruebas de Polkadot que nos da la escuela. Respaldo: Polkadot Hub TestNet (Paseo),
  chain ID `420420417`, token PAS, RPC `https://services.polkadothub-rpc.com/testnet`,
  explorador `https://blockscout-testnet.polkadot.io`, faucet `https://faucet.polkadot.io`.
- **Wallet / firma**: Polkadot App en PC y teléfono. Cuentas de la demo: abuelita, cajero US, cajero MX, nieta.
- **Contratos**: Solidity ^0.8.28, escritos, compilados y desplegados en **Remix**. Sin Hardhat ni Foundry.
- **Frontend**: Vite + React. Conexión según cómo firme la Polkadot App (Product SDK `@parity/product-sdk`,
  viem/wagmi o Polkadot API). Confirmar antes de escribir el frontend.
- **No usar**: ink!, PVM/resolc, JAM, pools/AMM, matching P2P de montos exactos, oráculo descentralizado,
  Proof of Personhood (solo roadmap).
- Gas: nunca fijarlo a mano. Probar cada función en la red real, no solo en la VM de Remix.

### Pendientes por confirmar con los organizadores

- [ ] RPC (HTTP y WebSocket), chain ID y token de la red de la escuela.
- [ ] ¿Acepta contratos Solidity (REVM)?
- [ ] ¿Cómo se consiguen tokens de prueba?
- [ ] ¿Hay explorador de bloques?
- [ ] ¿Cómo conecta Remix a esa red?
- [ ] ¿Cómo conecta la Polkadot App a una app web propia y si firma llamadas a contratos Solidity?

## Contratos

### `MockUSD.sol`
ERC-20 de 18 decimales con `mint` abierto (solo demo). Es el dólar digital de juguete.

### `Remesa.sol`
- Cajeros: `registerCashier`, `depositCollateral`, `requestWithdraw` / `withdrawCollateral`, `setQuote`, `setActive`.
- Envíos: `reserve`, `createTransfer` (confirmación del cajero US; bloquea y asigna), `markPaid(id, folio)`,
  `confirm`, `autoRelease`, `dispute`, `reassignOnTimeout`, `expireReservation`.
- Parámetros: `setReferenceRate` (solo `reporter`), `maxSpreadBps`.
- Reputación por cuenta.
- Registro de claves: alias o CLABE → `address`.
- Banco simulado: `mxnBalance[address]` sube al marcar `Paid`.
- Eventos para cada cambio de estado (el frontend los escucha).
- `Remesa` mueve fichas de `MockUSD`; en producción solo cambia la dirección del token.

## Simulación de bancos (demo)

- **Zelle**: recuadro estilo app de banco "Pagar $100.00". Al tocarlo se acuña MockUSD y se confirma el envío.
- **SPEI**: tarjeta estilo banco con CLABE (18 dígitos) y monto. "Enviar SPEI" → "Procesando…" 1–2 s → folio
  con formato real → `markPaid`.
- **Receptor**: notificación "Recibiste $1,700.00 MXN" + recibo real con QR al explorador.
- Etiqueta discreta "SIMULADO" en todo lo bancario. La referencia de Banxico se lee de su API pública.

## Pantallas

1. **Enviar** (remitente): clave, monto, "recibirá X", tipo del cajero vs referencia, botón de pago.
2. **Cajero**: órdenes pendientes con temporizador, tarjeta SPEI, "ya pagué", garantía y reputación.
3. **Recibido** (receptor): saldo, notificación, recibo con folio y QR, "recibí" / "no me llegó".

## Pitch (todo lo que construyamos debe soportarlo)

Problema → demo en pantalla dividida → tres piezas (cajeros, contrato, dólar digital) →
por qué Polkadot (2 s y centavos; dólares nativos y dotUSD; Proof of Personhood; OpenGov) →
qué es real y qué sigue → "reemplazamos al intermediario que decide por uno que solo obedece".
