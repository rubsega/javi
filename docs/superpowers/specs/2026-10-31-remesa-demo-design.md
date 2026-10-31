# Remesa — demo design (2026-10-31)

Source of truth for product intent: `CLAUDE.md`. This spec only lands it into a buildable demo.
Decisions below were delegated by the user ("toma tú las recomendaciones").

## 1. Blockers resolved

| Question | Decision | Evidence |
|---|---|---|
| School network | Products Devnet = Paseo Asset Hub (1000), chainId `420420417`, PAS | skill `polkadot-products-devnet/references/red-devnet.md`; `eth_chainId` returned `0x190f1b41` on 2026-10-31 |
| RPC | `https://eth-rpc-testnet.polkadot.io` (HTTP). `services.polkadothub-rpc.com/testnet` did not answer on 2026-10-31 | curl probe |
| Solidity accepted | Yes (REVM). `pragma solidity 0.8.28;`, optimizer off, runtime ≤ 24,576 B | `references/contratos.md` |
| Test tokens | Faucet `https://faucet.polkadot.io` → Paseo → **Asset Hub (1000)**, accepts `0x…` | ídem |
| Explorer | `https://blockscout-testnet.polkadot.io` | ídem |
| Remix | Remix + MetaMask (Injected Provider), network added by hand | ídem |
| Fees | ~0.008–0.08 PAS per tx; type-2 (EIP-1559) txs work; `eth_getLogs` works | Blockscout API + curl, 2026-10-31 |
| Polkadot App signing | Works only for an app published on a `.dot` name (no localhost). Team has no `.dot` → **not in the demo critical path** | `references/app-sdk.md` |

### Signing decision

Demo signs with **4 in-browser demo accounts** (abuelita, cajero US, cajero MX, nieta): private keys generated
by the app, stored in `localStorage`, testnet only. Reads and writes go through viem over ETH-RPC.

Why: one screen can drive all four actors (split-screen demo), every tx is real on-chain and visible in
Blockscout, and nothing depends on a Host that we cannot test without a `.dot`.
Polkadot App (Product SDK) is the next step: only `send()` in `app/src/chain.js` changes.

Package manager: npm (pnpm is only mandatory for the Product SDK, which is not used yet).

## 2. Scope

### In (demo of 60 s)

USD → MXN, one happy path end to end, plus the safety exits that make the rules credible:
expire reservation, reassign on timeout, dispute (freeze only), auto-release.

### Out (roadmap, mentioned in pitch only)

- `MXN_TO_USD` direction.
- Dispute resolution / slashing (dispute only freezes).
- Live Banxico in the contract (reporter sets the reference; UI shows Banxico live only if a token is configured).
- Polkadot App / Product SDK signing, `.dot` publishing.
- Proof of Personhood, OpenGov.
- Mint on Zelle tap: cashier collateral is minted once during setup instead (one fewer tx on stage).

## 3. Contracts

### Units

- `MockUSD`: 18 decimals. All USD amounts (`amountUSD`, collateral, `maxAmount`) use 18 decimals.
- Rates are scaled by `RATE_SCALE = 1e6`.
  - US cashier `rate` = digital USD released per Zelle USD (e.g. `995000` = 0.995). Reference is `1e6`.
  - MX cashier `rate` = MXN per digital USD (e.g. `16830000` = 16.83). Reference is `referenceRate`.
- `amountMXN` uses 18 decimals: `usdtAmount = amountUSD * rateUS / 1e6`, `amountMXN = usdtAmount * rateMX / 1e6`.
- A quote is valid only if `rate >= ref * (10000 - maxSpreadBps) / 10000`. Best = highest valid `rate`.

### `MockUSD.sol`

OpenZeppelin 5 ERC-20 "Mock USD" / "mUSD", `function mint(address to, uint256 amount) external` (open, demo only).

### `Remesa.sol`

```solidity
enum Kind { US, MX }
enum Status { None, Reserved, Assigned, Paid, Confirmed, Disputed, Expired }

constructor(IERC20 token, uint256 referenceRate)           // reporter = msg.sender, maxSpreadBps = 150

// cashiers
function registerCashier(Kind kind, uint256 rate, uint256 maxAmount, string bankInfo) external
function depositCollateral(uint256 amount) external         // needs token.approve first
function requestWithdraw(uint256 amount) external
function withdrawCollateral() external                      // after WITHDRAW_DELAY, from free collateral
function setQuote(uint256 rate, uint256 maxAmount) external
function setActive(bool active) external

// key registry (alias and CLABE -> address)
function registerKey(string nickname, string clabe) external
function resolveKey(string key) external view returns (address)

// transfers
function quote(uint256 amountUSD) external view returns (address us, address mx, uint256 usdtAmount, uint256 amountMXN)
function reserve(string key, uint256 amountUSD) external returns (uint256 id)    // sender
function createTransfer(uint256 id) external                // assigned US cashier; locks + assigns MX
function markPaid(uint256 id, string folio) external        // assigned MX cashier
function confirm(uint256 id) external                       // recipient
function dispute(uint256 id) external                       // recipient, while Paid
function autoRelease(uint256 id) external                   // anyone, paidAt + AUTO_RELEASE
function reassignOnTimeout(uint256 id) external             // anyone, Assigned past deadline
function expireReservation(uint256 id) external             // anyone, Reserved past deadline

// parameters (reporter only)
function setReferenceRate(uint256 rate) external
function setMaxSpreadBps(uint256 bps) external

// views
function cashierList() external view returns (address[] memory)
mapping(address => Cashier) public cashiers;
mapping(uint256 => Transfer) public transfers;  uint256 public nextId;
mapping(address => uint256) public mxnBalance;  mapping(address => string) public clabeOf;
mapping(address => uint256) public openReservations;
```

Constants: `RESERVE_TTL = 15 min`, `PAY_TTL = 15 min`, `AUTO_RELEASE = 24 h`,
`WITHDRAW_DELAY = 2 min` (demo; production 48 h), `MAX_OPEN_RESERVATIONS = 3`.

### Collateral accounting

`free = collateral - locked`. Eligible cashier: registered, active, right kind, valid rate,
`maxAmount >= amountUSD`, `collateral >= maxAmount`, `free >= usdtAmount`.

| Step | US cashier | MX cashier |
|---|---|---|
| `reserve` | `locked += usdt` | — |
| `createTransfer` | `locked -= usdt`, `collateral -= usdt` (now escrowed in the transfer) | `locked += usdt` |
| `confirm` / `autoRelease` | `successCount++` | `locked -= usdt`, `collateral += usdt`, `successCount++` |
| `reassignOnTimeout` | — | old: `locked -= usdt`, `failCount++`; new: `locked += usdt` |
| `expireReservation` | `locked -= usdt` | — |
| `dispute` | — | stays locked (frozen) |

The contract never lends: every lock is checked against the cashier's own free collateral.
`createTransfer` reverts if no MX cashier is eligible (US cashier retries later or the reservation expires).

### States and events

```
None → Reserved → Assigned → Paid → Confirmed
          │           │  ↺ reassign  └→ Disputed
          └→ Expired
```

`Created` is emitted inside `createTransfer` right before `Assigned` (same tx), so there is no stored `Created` state.

```solidity
event CashierRegistered(address indexed cashier, Kind kind, uint256 rate, uint256 maxAmount);
event CollateralDeposited(address indexed cashier, uint256 amount);
event WithdrawRequested(address indexed cashier, uint256 amount, uint256 availableAt);
event CollateralWithdrawn(address indexed cashier, uint256 amount);
event QuoteUpdated(address indexed cashier, uint256 rate, uint256 maxAmount);
event ActiveChanged(address indexed cashier, bool active);
event KeyRegistered(address indexed owner, string nickname, string clabe);
event Reserved(uint256 indexed id, address indexed sender, address indexed cashierUS, uint256 amountUSD, uint256 usdtAmount, uint256 expiresAt);
event Created(uint256 indexed id, address indexed cashierUS, uint256 usdtAmount);
event Assigned(uint256 indexed id, address indexed cashierMX, uint256 amountMXN, uint256 deadline);
event Paid(uint256 indexed id, address indexed cashierMX, string folio);
event Confirmed(uint256 indexed id, bool auto_);
event Disputed(uint256 indexed id);
event Expired(uint256 indexed id);
event Reassigned(uint256 indexed id, address indexed oldCashier, address indexed newCashier);
event ReferenceRateUpdated(uint256 rate);
event MaxSpreadUpdated(uint256 bps);
```

Errors: custom errors (keep bytecode small).

## 4. Frontend (Vite + React + viem, `app/`)

Hash routes. Default `#demo` = the three screens side by side (split screen for the pitch).
Polls the chain every 2 s (state + `Paid`/`Confirmed` logs for tx hashes). Everything bank-like carries a "SIMULADO" tag.

| Screen | Reads | Writes (signer) | Events used |
|---|---|---|---|
| **Preparar** `#preparar` | PAS + mUSD balances of 4 accounts, cashier data, contract addresses | paste addresses (localStorage); "Preparar demo": send PAS to the others, mint + approve + `registerCashier` + `depositCollateral` (both cashiers), `registerKey` (nieta). Idempotent | — |
| **Enviar** `#enviar` | `quote(amount)`, `referenceRate`, `maxSpreadBps`, the sender's last transfer | `reserve` (abuelita); Zelle box "Pagar $100.00" → `createTransfer` (cajero US) | status tracker from `transfers(id)` |
| **Cajero** `#cajero` | transfers assigned to cajero MX, deadline countdown, `clabeOf(recipient)`, cashier collateral/locked/reputation (both cashiers) | SPEI card "Enviar SPEI" → 1.5 s "Procesando…" → folio → `markPaid` (cajero MX); "Reasignar" when past deadline | — |
| **Recibido** `#recibido` | `mxnBalance(nieta)`, nieta's last transfer, folio | "Recibí" → `confirm`; "No me llegó" → `dispute` (nieta) | `Paid` / `Confirmed` tx hash → receipt link + QR to Blockscout |

Display: "Tipo del cajero" = `usdt/amountUSD × rateMX` vs "Referencia Banxico" = `referenceRate`; "Comisión: $0.00".

## 5. Risks and plan B

| Risk | Effect on demo | Mitigation / plan B |
|---|---|---|
| Polkadot App cannot sign (no `.dot`) | No Polkadot App on stage | Demo accounts in browser (decided). Pitch shows Polkadot App as next step |
| Testnet RPC down | Nothing works | Check `eth_chainId` before going on stage. Record a backup video of a full run once it works. Backup RPC from CLAUDE.md is down today |
| Gas | Tx rejected | Never set gas by hand (viem estimates). Each account gets ≥ 1 PAS (~100 txs). Preparar screen shows balances in red below 0.2 PAS |
| Decimals | Wrong amounts (×10¹⁸) | One rule: 18 decimals for USD/MXN, 1e6 for rates; contract test asserts 100 USD → expected MXN |
| Native PAS transfer to fresh account fails (existential deposit) | Setup cannot fund accounts | Send 2 PAS (≫ ED). Plan B: faucet each address directly (Preparar shows all 4) |
| Nonce clash between two txs of the same account | "nonce too low" | One tx at a time in the UI (buttons disabled while pending) |
| Contract too large | Remix deploy fails | Custom errors, no long strings; size measured at compile |
| Banxico API needs a token / CORS | No live reference | Reference lives in the contract (`setReferenceRate` from Remix); live Banxico only if `VITE_BANXICO_TOKEN` is set |
| `localStorage` cleared | Demo accounts lost (funds stuck on testnet) | "Exportar cuentas" text in Preparar; keys are testnet-only |
| Slow blocks (≈6 s) | Demo feels slow | Wait for `best-block` receipt only; optimistic "Procesando…" UI |

## 6. Verification

- `npm test` in `app/`: compiles both contracts with solc 0.8.28 (optimizer off), checks runtime size,
  runs the full flow + expire + reassign + dispute against a local Ganache chain with asserts.
- Manual: deploy in Remix on 420420417, run Preparar, do one full transfer, open the receipt in Blockscout.

## 7. Addendum: offline mode (user has no network yet)

`npm run demo` in `app/` starts a local Ganache chain (chainId 1337), deploys both contracts with the
compiled bytecode, runs `setupDemo` and serves the app. The app reads `public/local.json` (deleted on Ctrl+C).
The Preparar screen switches between "Cadena local" and "Polkadot Hub TestNet"; same screens, same contract.
Local bytecode is compiled for `shanghai` (Ganache limit); Remix compiles its own for the testnet.
Verified 2026-10-31: `npm test` 4/4, and a headless Edge run clicked the full happy path to `Confirmed`.
