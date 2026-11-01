# Remesa: remesa comunitaria US ⇄ MX sobre Polkadot

La abuelita paga 100 USD por Zelle y la nieta recibe ~1,674 MXN por SPEI. No hay comisión y ninguna
empresa guarda el dinero: un contrato con reglas públicas bloquea, asigna y libera.

- Contratos: [contracts/](contracts/) (`MockUSD.sol`, `Remesa.sol`)
- App (Vite + React + viem): [app/](app/)
- Diseño y decisiones: [docs/superpowers/specs/2026-10-31-remesa-demo-design.md](docs/superpowers/specs/2026-10-31-remesa-demo-design.md)

## Equipo

- Rubén Sánchez Mireles
- Chelsea Sánchez Rincón
- Ruben Aguillon Segura
- Javier Isaac Mendoza Medellin

## 1. Demo sin red (en tu compu)

Necesitas Node 22 o más reciente.

```sh
cd app
npm install
npm run demo
```

Abre http://localhost:5173. Se levanta una blockchain local, se despliegan los contratos y los cajeros
quedan listos. Las tres pantallas aparecen lado a lado:

1. **Abuelita** → "Enviar $100.00" → "Pagar $100.00" (Zelle simulado; el cajero US confirma solo).
2. **Cajero MX** → "Enviar SPEI" (simulado, genera folio).
3. **Nieta** → ve "Recibiste…", el recibo con QR → "Recibí".

Para probar la caducidad y la reasignación: pestaña **Preparar** → "Adelantar el reloj 16 min".
Ctrl+C borra la cadena local. La próxima vez empieza de cero.

Pruebas del contrato (flujo completo, caducidad, reasignación, disputa, topes):

```sh
cd app
npm test
```

## 2. Demo en la red real (Polkadot Hub TestNet, chain ID 420420417)

1. En MetaMask, agrega la red a mano:
   - RPC: `https://eth-rpc-testnet.polkadot.io`
   - ID de cadena: `420420417`
   - Símbolo: `PAS`
   - Explorador: `https://blockscout-testnet.polkadot.io`
2. Pide PAS para tu cuenta de MetaMask en https://faucet.polkadot.io (elige **Paseo → Asset Hub (1000)**).
3. En https://remix.ethereum.org crea `MockUSD.sol` y `Remesa.sol` con el contenido de [contracts/](contracts/).
   Compila con la versión **0.8.28** y el optimizador apagado.
4. En "Deploy & run", elige el entorno **Injected Provider – MetaMask** y revisa que la red sea 420420417.
   - Despliega `MockUSD` y copia su dirección.
   - Despliega `Remesa` con `token_` = la dirección de MockUSD y `referenceRate_` = `17000000`
     (17.00 MXN por USD; usa la referencia de Banxico del día × 1,000,000).
5. Abre la app (`npm run dev` dentro de `app/`) → **Preparar** → "Polkadot Hub TestNet".
   Pega las dos direcciones y presiona "Guardar direcciones".
6. Pide PAS en el faucet para la dirección de la **abuelita** que muestra la pantalla.
7. Presiona "Preparar demo". La abuelita reparte PAS a los otros y los cajeros depositan su garantía.
8. Ve a **Demo** y haz el envío. Cada paso es una transacción real que puedes ver en Blockscout (el QR del recibo lleva ahí).

Las 4 cuentas de la demo viven en el navegador (solo red de pruebas). En "Exportar cuentas" las respaldas.

**Referencia Banxico en vivo (opcional):** consigue un token gratis del SIE de Banxico y crea
`app/.env.local` con la línea `VITE_BANXICO_TOKEN=tu_token`. Sin token, la app muestra la referencia que guarda el contrato.

## Qué es real y qué es simulado

| Real (en cadena) | Simulado |
|---|---|
| Reserva, garantías, asignación del cajero, tope de margen, caducidad, reasignación, reputación, recibo | Zelle, SPEI y el saldo bancario en MXN (con la etiqueta "SIMULADO") |
| Dólar digital (`MockUSD`; en producción USDT/USDC/dotUSD) | Firma con la Polkadot App: es el siguiente paso, requiere publicar la app en un nombre `.dot` |
