// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Token 聚合平台 v2 — 盈利版
// 功能：多 DEX 比价 → 最优路由 → 拆分执行 → 自动抽成
// 盈利模式：
//   1. 协议费（feePercent）— 每笔交易抽固定比例，默认 0.3%
//   2. 正滑点留存（slippageProfitPercent）— 实际输出超出 minOut 的差额，平台保留一部分
//   例：用户设 minOut=100，实际换到 110，平台抽 20% = 2，用户得 108

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IDEXAdapter.sol";

interface IERC20 {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

contract TokenAggregator is Ownable, ReentrancyGuard {
    // ===== DEX 管理 =====
    IDEXAdapter[] public adapters;
    mapping(address => bool) public isAdapter;
    mapping(address => bool) public isActive;
    uint256 public constant MAX_DEX_COUNT = 10;

    // ===== 盈利参数 =====
    uint256 public feePercent = 30;               // 协议费 0.3%（30 / 10000）
    uint256 public slippageProfitPercent = 2000;  // 正滑点平台留存 20%（2000 / 10000）
    uint256 public constant FEE_DENOMINATOR = 10000;

    // ===== 利润追踪 =====
    uint256 public totalEthProfit;                // 累计 ETH 利润
    mapping(address => uint256) public totalTokenProfit; // 各代币累计利润
    bool public paused;

    // ===== 结构体 =====
    struct Quote {
        address adapter;
        uint256 amountOut;
        uint256 index;
    }

    // ===== 事件 =====
    event AdapterAdded(address indexed adapter, string name);
    event AdapterRemoved(address indexed adapter);
    event Swapped(address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 userGot, uint256 platformProfit);
    event SplitSwapped(address indexed user, address tokenIn, address tokenOut, uint256 totalIn, uint256 userGot, uint256 platformProfit);
    event ProfitWithdrawn(address indexed owner, uint256 ethAmount, address[] tokens, uint256[] tokenAmounts);
    event FeeUpdated(uint256 fee, uint256 slippage);

    modifier whenNotPaused() { require(!paused, "paused"); _; }

    constructor() Ownable(msg.sender) {}

    // ===== 适配器管理 =====
    function addAdapter(address _adapter) external onlyOwner {
        require(!isAdapter[_adapter], "exists");
        require(adapters.length < MAX_DEX_COUNT, "max");
        adapters.push(IDEXAdapter(_adapter));
        isAdapter[_adapter] = true;
        isActive[_adapter] = true;
        emit AdapterAdded(_adapter, IDEXAdapter(_adapter).name());
    }

    function removeAdapter(uint256 idx) external onlyOwner {
        require(idx < adapters.length, "invalid");
        address ad = address(adapters[idx]);
        delete isAdapter[ad]; delete isActive[ad];
        adapters[idx] = adapters[adapters.length - 1];
        adapters.pop();
        emit AdapterRemoved(ad);
    }

    function toggleAdapter(address a) external onlyOwner {
        require(isAdapter[a], "not adapter");
        isActive[a] = !isActive[a];
    }

    function setFees(uint256 _fee, uint256 _slippage) external onlyOwner {
        require(_fee <= 100 && _slippage <= 10000, "max exceeded");
        feePercent = _fee;
        slippageProfitPercent = _slippage;
        emit FeeUpdated(_fee, _slippage);
    }

    function pause() external onlyOwner { paused = true; }
    function unpause() external onlyOwner { paused = false; }
    function adapterCount() external view returns (uint256) { return adapters.length; }

    // ===== 报价查询 =====
    function getAllQuotes(address tIn, address tOut, uint256 amountIn)
        public view returns (Quote[] memory)
    {
        uint256 n; for (uint256 i; i < adapters.length; i++) if (isActive[address(adapters[i])]) n++;
        Quote[] memory qs = new Quote[](n);
        uint256 j;
        for (uint256 i; i < adapters.length; i++) {
            if (!isActive[address(adapters[i])]) continue;
            try adapters[i].getAmountOut(amountIn, tIn, tOut) returns (uint256 o) {
                qs[j] = Quote(address(adapters[i]), o, i);
            } catch { qs[j] = Quote(address(adapters[i]), 0, i); }
            j++;
        }
        // 冒泡排序
        for (uint256 i; i < qs.length; i++)
            for (uint256 k = i + 1; k < qs.length; k++)
                if (qs[k].amountOut > qs[i].amountOut) {
                    Quote memory t = qs[i]; qs[i] = qs[k]; qs[k] = t;
                }
        return qs;
    }

    function getBestQuote(address tIn, address tOut, uint256 amt)
        external view returns (address best, uint256 out)
    {
        Quote[] memory qs = getAllQuotes(tIn, tOut, amt);
        if (qs.length > 0 && qs[0].amountOut > 0) return (qs[0].adapter, qs[0].amountOut);
    }

    // ===== 单 DEX 兑换（核心盈利逻辑） =====
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external payable whenNotPaused nonReentrant returns (uint256 userGot)
    {
        require(amountIn > 0 && tokenIn != tokenOut, "invalid");
        Quote[] memory qs = getAllQuotes(tokenIn, tokenOut, amountIn);
        require(qs.length > 0 && qs[0].amountOut > 0, "no route");

        // 收集输入资金
        if (tokenIn == address(0)) {
            require(msg.value >= amountIn, "insufficient ETH");
        } else {
            _pullToken(tokenIn, msg.sender, amountIn);
        }

        // 执行兑换 → 输出进入本合约
        uint256 actualOut = _executeSwap(
            qs[0].adapter, amountIn, tokenIn, tokenOut
        );

        // 计算利润分配
        uint256 platformProfit;
        uint256 fee;
        (userGot, platformProfit, fee) = _calcProfit(actualOut, minOut, tokenOut);

        // 分账
        _sendOut(tokenOut, msg.sender, userGot);

        // 退款
        if (tokenIn == address(0) && msg.value > amountIn)
            payable(msg.sender).transfer(msg.value - amountIn);

        emit Swapped(msg.sender, tokenIn, tokenOut, amountIn, userGot, platformProfit);
    }

    // ===== 拆分兑换 =====
    function splitSwap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 dexCount)
        external payable whenNotPaused nonReentrant returns (uint256 userGot)
    {
        require(dexCount >= 1 && amountIn > 0, "invalid");
        Quote[] memory qs = getAllQuotes(tokenIn, tokenOut, amountIn);
        require(qs.length > 0 && qs[0].amountOut > 0, "no route");
        uint256 n = dexCount < qs.length ? dexCount : qs.length;

        // 计算权重分配
        uint256 totalQ;
        for (uint256 i; i < n; i++) totalQ += qs[i].amountOut;
        require(totalQ > 0, "zero total");

        // 收集资金
        if (tokenIn == address(0)) {
            require(msg.value >= amountIn, "insufficient ETH");
        } else {
            _pullToken(tokenIn, msg.sender, amountIn);
        }

        // 拆分执行
        uint256 actualTotal;
        uint256 spent;
        for (uint256 i; i < n; i++) {
            uint256 splitAmt = (i == n - 1)
                ? amountIn - spent
                : (amountIn * qs[i].amountOut) / totalQ;
            if (splitAmt == 0) continue;
            spent += splitAmt;
            _approveToken(tokenIn, qs[i].adapter, splitAmt);
            actualTotal += _executeSwap(qs[i].adapter, splitAmt, tokenIn, tokenOut);
        }

        // 利润分配
        uint256 profit;
        uint256 fee;
        (userGot, profit, fee) = _calcProfit(actualTotal, minOut, tokenOut);
        _sendOut(tokenOut, msg.sender, userGot);

        if (tokenIn == address(0) && msg.value > amountIn)
            payable(msg.sender).transfer(msg.value - amountIn);

        emit SplitSwapped(msg.sender, tokenIn, tokenOut, amountIn, userGot, profit);
    }

    // ===== 内部：盈利计算（核心） =====
    function _calcProfit(uint256 actualOut, uint256 minOut, address tokenOut)
        internal returns (uint256 userGot, uint256 platformProfit, uint256 fee)
    {
        // 1. 协议费（按比例抽）
        fee = (actualOut * feePercent) / FEE_DENOMINATOR;
        uint256 afterFee = actualOut - fee;

        // 2. 正滑点留存
        uint256 slippageProfit;
        if (afterFee > minOut) {
            uint256 excess = afterFee - minOut;
            slippageProfit = (excess * slippageProfitPercent) / FEE_DENOMINATOR;
        }

        platformProfit = fee + slippageProfit;
        userGot = actualOut - platformProfit;

        // 用户至少拿到 minOut
        if (userGot < minOut) userGot = minOut;
        // 平台利润不能超过实际输出 - minOut
        if (platformProfit > actualOut - minOut) platformProfit = actualOut - minOut;

        // 记账
        if (tokenOut == address(0)) {
            totalEthProfit += platformProfit;
        } else {
            totalTokenProfit[tokenOut] += platformProfit;
        }
    }

    // ===== 内部：执行单次兑换 → 输出到本合约 =====
    function _executeSwap(address adapter, uint256 amountIn, address tokenIn, address tokenOut)
        internal returns (uint256 out)
    {
        if (tokenIn == address(0)) {
            // ETH → : 记录前后余额差
            uint256 before = _balanceOf(tokenOut, address(this));
            IDEXAdapter(adapter).swap{value: amountIn}(amountIn, tokenIn, tokenOut, 0, address(this));
            out = _balanceOf(tokenOut, address(this)) - before;
        } else {
            _approveToken(tokenIn, adapter, amountIn);
            uint256 before = _balanceOf(tokenOut, address(this));
            IDEXAdapter(adapter).swap(amountIn, tokenIn, tokenOut, 0, address(this));
            out = _balanceOf(tokenOut, address(this)) - before;
        }
    }

    // ===== 内部工具 =====
    function _pullToken(address t, address from, uint256 amt) internal {
        _safeCall(t, abi.encodeWithSelector(0x23b872dd, from, address(this), amt));
    }

    function _sendOut(address t, address to, uint256 amt) internal {
        if (t == address(0)) {
            payable(to).transfer(amt);
        } else {
            _safeCall(t, abi.encodeWithSelector(0xa9059cbb, to, amt));
        }
    }

    function _approveToken(address t, address sp, uint256 amt) internal {
        if (t == address(0)) return;
        _safeCall(t, abi.encodeWithSelector(0x095ea7b3, sp, amt));
    }

    function _balanceOf(address t, address who) internal view returns (uint256) {
        if (t == address(0)) return who.balance;
        (bool ok, bytes memory d) = t.staticcall(abi.encodeWithSelector(0x70a08231, who));
        return ok ? abi.decode(d, (uint256)) : 0;
    }

    function _safeCall(address t, bytes memory data) internal {
        (bool ok,) = t.call(data);
        require(ok, "call failed");
    }

    // ===== 提现利润 =====
    function withdrawProfit(address[] calldata tokens) external onlyOwner nonReentrant {
        uint256 eth = totalEthProfit;
        totalEthProfit = 0;
        if (eth > 0) payable(owner()).transfer(eth);

        uint256[] memory amounts = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; i++) {
            amounts[i] = totalTokenProfit[tokens[i]];
            totalTokenProfit[tokens[i]] = 0;
            if (amounts[i] > 0) IERC20(tokens[i]).transfer(owner(), amounts[i]);
        }
        emit ProfitWithdrawn(owner(), eth, tokens, amounts);
    }

    receive() external payable {}
}
