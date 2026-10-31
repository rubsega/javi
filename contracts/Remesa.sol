// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Community remittance US -> MX. Cashiers lock digital-dollar collateral and compete on rate.
/// The contract only follows public rules: it locks, assigns, releases and records. Fee: 0%.
contract Remesa {
    enum Kind { US, MX }
    enum Status { None, Reserved, Assigned, Paid, Confirmed, Disputed, Expired }

    struct Cashier {
        Kind kind;
        bool registered;
        bool active;
        uint256 rate; // US: digital USD per Zelle USD; MX: MXN per digital USD. Scaled by RATE_SCALE.
        uint256 maxAmount; // max amountUSD served per transfer (18 decimals)
        uint256 collateral;
        uint256 locked;
        uint256 withdrawAmount;
        uint256 withdrawAt;
        uint32 successCount;
        uint32 failCount;
        string bankInfo; // where users pay this cashier (Zelle handle / bank name)
    }

    struct Transfer {
        address sender;
        address recipient;
        address cashierUS;
        address cashierMX;
        uint256 amountUSD;
        uint256 usdtAmount;
        uint256 amountMXN;
        uint64 deadline; // reservation expiry while Reserved, payment deadline while Assigned
        uint64 paidAt;
        Status status;
        string folio;
    }

    uint256 public constant RATE_SCALE = 1e6;
    uint256 public constant RESERVE_TTL = 15 minutes;
    uint256 public constant PAY_TTL = 15 minutes;
    uint256 public constant AUTO_RELEASE = 24 hours;
    uint256 public constant WITHDRAW_DELAY = 2 minutes; // demo value; production: 48 hours
    uint256 public constant MAX_OPEN_RESERVATIONS = 3;

    IERC20 public immutable token;
    address public immutable reporter;
    uint256 public referenceRate; // MXN per USD, scaled by RATE_SCALE
    uint256 public maxSpreadBps = 150;

    mapping(address => bool) public approved; // reporter-approved cashiers (today a KYC; roadmap: Proof of Personhood / OpenGov)
    mapping(address => Cashier) public cashiers;
    address[] private cashierAddrs;

    mapping(uint256 => Transfer) public transfers;
    uint256 public nextId; // id of the last transfer; ids start at 1

    mapping(bytes32 => address) public keyOwner;
    mapping(address => string) public clabeOf;
    mapping(address => uint256) public mxnBalance; // simulated bank: credited on Paid
    mapping(address => uint256) public openReservations;

    event CashierApproved(address indexed cashier, bool approved);
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

    error NotReporter();
    error NotRegistered();
    error NotApproved();
    error AlreadyRegistered();
    error InvalidAmount();
    error InvalidKey();
    error KeyTaken();
    error UnknownKey();
    error TooManyReservations();
    error NoCashierAvailable();
    error BadStatus();
    error NotAllowed();
    error TooLate();
    error TooEarly();
    error InsufficientFree();
    error TransferFailed();

    constructor(IERC20 token_, uint256 referenceRate_) {
        if (referenceRate_ == 0) revert InvalidAmount();
        token = token_;
        reporter = msg.sender;
        referenceRate = referenceRate_;
    }

    modifier onlyReporter() {
        if (msg.sender != reporter) revert NotReporter();
        _;
    }

    modifier onlyCashier() {
        if (!cashiers[msg.sender].registered) revert NotRegistered();
        _;
    }

    // ---------- cashiers ----------

    /// Only approved accounts can register, and revoking takes a cashier out of matching.
    function approveCashier(address cashier, bool ok) external onlyReporter {
        approved[cashier] = ok;
        emit CashierApproved(cashier, ok);
    }

    function registerCashier(Kind kind, uint256 rate, uint256 maxAmount, string calldata bankInfo) external {
        if (!approved[msg.sender]) revert NotApproved();
        Cashier storage c = cashiers[msg.sender];
        if (c.registered) revert AlreadyRegistered();
        if (rate == 0 || maxAmount == 0) revert InvalidAmount();
        c.kind = kind;
        c.registered = true;
        c.active = true;
        c.rate = rate;
        c.maxAmount = maxAmount;
        c.bankInfo = bankInfo;
        cashierAddrs.push(msg.sender);
        emit CashierRegistered(msg.sender, kind, rate, maxAmount);
    }

    function depositCollateral(uint256 amount) external onlyCashier {
        if (amount == 0) revert InvalidAmount();
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        cashiers[msg.sender].collateral += amount;
        emit CollateralDeposited(msg.sender, amount);
    }

    function requestWithdraw(uint256 amount) external onlyCashier {
        if (amount == 0) revert InvalidAmount();
        Cashier storage c = cashiers[msg.sender];
        c.withdrawAmount = amount;
        c.withdrawAt = block.timestamp + WITHDRAW_DELAY;
        emit WithdrawRequested(msg.sender, amount, c.withdrawAt);
    }

    function withdrawCollateral() external onlyCashier {
        Cashier storage c = cashiers[msg.sender];
        uint256 amount = c.withdrawAmount;
        if (amount == 0) revert InvalidAmount();
        if (block.timestamp < c.withdrawAt) revert TooEarly();
        if (c.collateral - c.locked < amount) revert InsufficientFree();
        c.withdrawAmount = 0;
        c.collateral -= amount;
        if (!token.transfer(msg.sender, amount)) revert TransferFailed();
        emit CollateralWithdrawn(msg.sender, amount);
    }

    function setQuote(uint256 rate, uint256 maxAmount) external onlyCashier {
        if (rate == 0 || maxAmount == 0) revert InvalidAmount();
        Cashier storage c = cashiers[msg.sender];
        c.rate = rate;
        c.maxAmount = maxAmount;
        emit QuoteUpdated(msg.sender, rate, maxAmount);
    }

    function setActive(bool active) external onlyCashier {
        cashiers[msg.sender].active = active;
        emit ActiveChanged(msg.sender, active);
    }

    function cashierList() external view returns (address[] memory) {
        return cashierAddrs;
    }

    // ---------- key registry ----------

    function registerKey(string calldata nickname, string calldata clabe) external {
        if (bytes(nickname).length == 0 || bytes(clabe).length != 18) revert InvalidKey();
        _claim(nickname);
        _claim(clabe);
        clabeOf[msg.sender] = clabe;
        emit KeyRegistered(msg.sender, nickname, clabe);
    }

    function resolveKey(string calldata key) public view returns (address) {
        return keyOwner[keccak256(bytes(key))];
    }

    function _claim(string calldata key) internal {
        bytes32 h = keccak256(bytes(key));
        address owner = keyOwner[h];
        if (owner != address(0) && owner != msg.sender) revert KeyTaken();
        keyOwner[h] = msg.sender;
    }

    // ---------- transfers ----------

    function quote(uint256 amountUSD) external view returns (address us, address mx, uint256 usdtAmount, uint256 amountMXN) {
        uint256 usRate;
        (us, usRate) = _best(Kind.US, amountUSD, 0, address(0));
        if (us == address(0)) return (us, mx, 0, 0);
        usdtAmount = amountUSD * usRate / RATE_SCALE;
        uint256 mxRate;
        (mx, mxRate) = _best(Kind.MX, amountUSD, usdtAmount, address(0));
        amountMXN = usdtAmount * mxRate / RATE_SCALE;
    }

    function reserve(string calldata key, uint256 amountUSD) external returns (uint256 id) {
        address recipient = resolveKey(key);
        if (recipient == address(0)) revert UnknownKey();
        if (amountUSD == 0) revert InvalidAmount();
        if (openReservations[msg.sender] >= MAX_OPEN_RESERVATIONS) revert TooManyReservations();

        (address us, uint256 usRate) = _best(Kind.US, amountUSD, 0, address(0));
        if (us == address(0)) revert NoCashierAvailable();
        uint256 usdt = amountUSD * usRate / RATE_SCALE;
        cashiers[us].locked += usdt;

        id = ++nextId;
        Transfer storage t = transfers[id];
        t.sender = msg.sender;
        t.recipient = recipient;
        t.cashierUS = us;
        t.amountUSD = amountUSD;
        t.usdtAmount = usdt;
        t.deadline = uint64(block.timestamp + RESERVE_TTL);
        t.status = Status.Reserved;
        openReservations[msg.sender]++;
        emit Reserved(id, msg.sender, us, amountUSD, usdt, t.deadline);
    }

    /// US cashier confirms the Zelle payment arrived: the reserved collateral moves into the transfer
    /// and, in the same tx, the best MX cashier is assigned.
    function createTransfer(uint256 id) external {
        Transfer storage t = transfers[id];
        if (t.status != Status.Reserved) revert BadStatus();
        if (msg.sender != t.cashierUS) revert NotAllowed();
        if (block.timestamp > t.deadline) revert TooLate();

        Cashier storage us = cashiers[t.cashierUS];
        us.locked -= t.usdtAmount;
        us.collateral -= t.usdtAmount;
        openReservations[t.sender]--;
        emit Created(id, t.cashierUS, t.usdtAmount);
        _assign(id, t, address(0));
    }

    function markPaid(uint256 id, string calldata folio) external {
        Transfer storage t = transfers[id];
        if (t.status != Status.Assigned) revert BadStatus();
        if (msg.sender != t.cashierMX) revert NotAllowed();
        if (block.timestamp > t.deadline) revert TooLate();
        t.status = Status.Paid;
        t.paidAt = uint64(block.timestamp);
        t.folio = folio;
        mxnBalance[t.recipient] += t.amountMXN;
        emit Paid(id, msg.sender, folio);
    }

    function confirm(uint256 id) external {
        Transfer storage t = transfers[id];
        if (t.status != Status.Paid) revert BadStatus();
        if (msg.sender != t.recipient) revert NotAllowed();
        _release(id, t, false);
    }

    function autoRelease(uint256 id) external {
        Transfer storage t = transfers[id];
        if (t.status != Status.Paid) revert BadStatus();
        if (block.timestamp < t.paidAt + AUTO_RELEASE) revert TooEarly();
        _release(id, t, true);
    }

    /// Recipient says the SPEI never arrived: everything stays frozen. Resolution is roadmap.
    function dispute(uint256 id) external {
        Transfer storage t = transfers[id];
        if (t.status != Status.Paid) revert BadStatus();
        if (msg.sender != t.recipient) revert NotAllowed();
        t.status = Status.Disputed;
        emit Disputed(id);
    }

    function reassignOnTimeout(uint256 id) external {
        Transfer storage t = transfers[id];
        if (t.status != Status.Assigned) revert BadStatus();
        if (block.timestamp <= t.deadline) revert TooEarly();
        address old = t.cashierMX;
        Cashier storage c = cashiers[old];
        c.locked -= t.usdtAmount;
        c.failCount++;
        _assign(id, t, old);
        emit Reassigned(id, old, t.cashierMX);
    }

    function expireReservation(uint256 id) external {
        Transfer storage t = transfers[id];
        if (t.status != Status.Reserved) revert BadStatus();
        if (block.timestamp <= t.deadline) revert TooEarly();
        cashiers[t.cashierUS].locked -= t.usdtAmount;
        openReservations[t.sender]--;
        t.status = Status.Expired;
        emit Expired(id);
    }

    // ---------- parameters ----------

    function setReferenceRate(uint256 rate) external onlyReporter {
        if (rate == 0) revert InvalidAmount();
        referenceRate = rate;
        emit ReferenceRateUpdated(rate);
    }

    function setMaxSpreadBps(uint256 bps) external onlyReporter {
        if (bps > 10_000) revert InvalidAmount();
        maxSpreadBps = bps;
        emit MaxSpreadUpdated(bps);
    }

    // ---------- internals ----------

    function _assign(uint256 id, Transfer storage t, address exclude) internal {
        (address mx, uint256 rate) = _best(Kind.MX, t.amountUSD, t.usdtAmount, exclude);
        if (mx == address(0)) revert NoCashierAvailable();
        cashiers[mx].locked += t.usdtAmount;
        t.cashierMX = mx;
        t.amountMXN = t.usdtAmount * rate / RATE_SCALE;
        t.deadline = uint64(block.timestamp + PAY_TTL);
        t.status = Status.Assigned;
        emit Assigned(id, mx, t.amountMXN, t.deadline);
    }

    function _release(uint256 id, Transfer storage t, bool auto_) internal {
        t.status = Status.Confirmed;
        Cashier storage mx = cashiers[t.cashierMX];
        mx.locked -= t.usdtAmount;
        mx.collateral += t.usdtAmount;
        mx.successCount++;
        cashiers[t.cashierUS].successCount++;
        emit Confirmed(id, auto_);
    }

    /// Highest valid rate among eligible cashiers. For US the lock depends on each cashier's own rate.
    function _best(Kind kind, uint256 amountUSD, uint256 usdtAmount, address exclude) internal view returns (address best, uint256 bestRate) {
        uint256 ref = kind == Kind.US ? RATE_SCALE : referenceRate;
        uint256 minRate = ref * (10_000 - maxSpreadBps) / 10_000;
        for (uint256 i = 0; i < cashierAddrs.length; i++) {
            address a = cashierAddrs[i];
            Cashier storage c = cashiers[a];
            if (a == exclude || !approved[a] || !c.active || c.kind != kind) continue;
            if (c.rate < minRate || c.rate <= bestRate) continue;
            if (c.maxAmount < amountUSD || c.collateral < c.maxAmount) continue;
            uint256 lock = kind == Kind.US ? amountUSD * c.rate / RATE_SCALE : usdtAmount;
            if (c.collateral - c.locked < lock) continue;
            best = a;
            bestRate = c.rate;
        }
    }
}
