// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Token 聚合平台核心合约
// 功能：多 DEX 比价 → 最优路由 → 单笔或拆分执行
// 支持 ETH ↔ Token、Token ↔ Token（自动通过 ETH 中转）

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IDEXAdapter.sol";

interface IERC20 {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function decimals() external view returns (uint8);
}

contract TokenAggregator is Ownable, ReentrancyGuard {
    // ===== 状态变量 =====

    IDEXAdapter[] public adapters;               // 已注册的 DEX 适配器列表
    mapping(address => bool) public isAdapter;    // 地址是否已注册为适配器
    mapping(address => bool) public isActive;     // 适配器是否启用

    uint256 public feePercent = 0;                // 协议费（默认 0，例如 10 = 0.1%）
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public totalFeesEarned;               // 累计手续费（ETH）
    bool public paused;

    uint256 public constant MAX_DEX_COUNT = 10;   // 最多接入 10 个 DEX

    // ===== 结构体 =====

    struct Quote {
        address adapter;
        uint256 amountOut;
        uint256 index;
    }

    struct SplitResult {
        address adapter;
        uint256 amountIn;
        uint256 amountOut;
    }

    // ===== 事件 =====

    event AdapterAdded(address indexed adapter, string name);
    event AdapterRemoved(address indexed adapter);
    event AdapterToggled(address indexed adapter, bool active);
    event Swapped(
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address indexed adapter
    );
    event SplitSwapped(
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 totalAmountIn,
        uint256 totalAmountOut,
        uint256 dexCount
    );
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeWithdrawn(address indexed owner, uint256 amount);

    constructor() Ownable(msg.sender) {}

    // ===== 修饰器 =====

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    // ===== 适配器管理（Owner） =====

    function addAdapter(address _adapter) external onlyOwner {
        require(!isAdapter[_adapter], "already added");
        require(adapters.length < MAX_DEX_COUNT, "max adapters reached");
        require(_adapter != address(0), "zero address");
        adapters.push(IDEXAdapter(_adapter));
        isAdapter[_adapter] = true;
        isActive[_adapter] = true;
        emit AdapterAdded(_adapter, IDEXAdapter(_adapter).name());
    }

    function removeAdapter(uint256 index) external onlyOwner {
        require(index < adapters.length, "invalid index");
        address adapter = address(adapters[index]);
        isAdapter[adapter] = false;
        isActive[adapter] = false;
        // 把最后一个元素移到被删除位置
        adapters[index] = adapters[adapters.length - 1];
        adapters.pop();
        emit AdapterRemoved(adapter);
    }

    function toggleAdapter(address _adapter) external onlyOwner {
        require(isAdapter[_adapter], "not an adapter");
        isActive[_adapter] = !isActive[_adapter];
        emit AdapterToggled(_adapter, isActive[_adapter]);
    }

    function setFee(uint256 _feePercent) external onlyOwner {
        require(_feePercent <= 100, "max 1%");   // 最高收 1%
        emit FeeUpdated(feePercent, _feePercent);
        feePercent = _feePercent;
    }

    function pause() external onlyOwner { paused = true; }
    function unpause() external onlyOwner { paused = false; }

    function withdrawFees() external onlyOwner {
        uint256 amount = totalFeesEarned;
        totalFeesEarned = 0;
        payable(owner()).transfer(amount);
        emit FeeWithdrawn(owner(), amount);
    }

    function adapterCount() external view returns (uint256) {
        return adapters.length;
    }

    // ===== 报价查询 =====

    /// @notice 获取所有活跃适配器的报价（按输出降序排列）
    function getAllQuotes(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) public view returns (Quote[] memory) {
        // 先统计活跃适配器数量
        uint256 activeCount;
        for (uint256 i = 0; i < adapters.length; i++) {
            if (isActive[address(adapters[i])]) activeCount++;
        }

        Quote[] memory quotes = new Quote[](activeCount);
        uint256 idx;
        for (uint256 i = 0; i < adapters.length; i++) {
            if (!isActive[address(adapters[i])]) continue;
            uint256 out = adapters[i].getAmountOut(amountIn, tokenIn, tokenOut);
            quotes[idx] = Quote({
                adapter: address(adapters[i]),
                amountOut: out,
                index: i
            });
            idx++;
        }

        // 冒泡排序（按输出降序）。适配器数量 ≤10，gas 可接受
        for (uint256 i = 0; i < quotes.length; i++) {
            for (uint256 j = i + 1; j < quotes.length; j++) {
                if (quotes[j].amountOut > quotes[i].amountOut) {
                    Quote memory tmp = quotes[i];
                    quotes[i] = quotes[j];
                    quotes[j] = tmp;
                }
            }
        }
        return quotes;
    }

    /// @notice 获取最优报价
    function getBestQuote(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (address bestAdapter, uint256 bestAmountOut) {
        Quote[] memory quotes = getAllQuotes(tokenIn, tokenOut, amountIn);
        if (quotes.length > 0 && quotes[0].amountOut > 0) {
            return (quotes[0].adapter, quotes[0].amountOut);
        }
        return (address(0), 0);
    }

    // ===== 单 DEX 兑换（路由到最优） =====

    /// @notice 兑换入口（自动判断 ETH/Token 方向）
    /// @param tokenIn   输入代币地址（address(0) = ETH）
    /// @param tokenOut  输出代币地址（address(0) = ETH）
    /// @param amountIn  输入金额
    /// @param minOut    最小输出（滑点保护）
    /// @return amountOut 实际输出
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut
    ) external payable whenNotPaused nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "zero amount");
        require(tokenIn != tokenOut, "same token");
        require(tokenIn == address(0) || tokenOut == address(0) || tokenIn != tokenOut, "same token");

        // 找最优报价
        Quote[] memory quotes = getAllQuotes(tokenIn, tokenOut, amountIn);
        require(quotes.length > 0 && quotes[0].amountOut > 0, "no route");

        // 收手续费
        uint256 fee;
        if (feePercent > 0) {
            fee = (quotes[0].amountOut * feePercent) / FEE_DENOMINATOR;
            totalFeesEarned += fee;
        }
        uint256 expectedOut = quotes[0].amountOut - fee;
        require(expectedOut >= minOut, "slippage");

        IDEXAdapter bestAdapter = IDEXAdapter(quotes[0].adapter);

        // 处理输入资金
        if (tokenIn == address(0)) {
            // ETH → Token
            require(msg.value >= amountIn, "insufficient ETH");
            amountOut = bestAdapter.swap{value: amountIn}(
                amountIn, tokenIn, tokenOut, minOut, msg.sender
            );
            // 退多余的 ETH
            if (msg.value > amountIn) {
                payable(msg.sender).transfer(msg.value - amountIn);
            }
        } else {
            // Token → ETH 或 Token → Token
            _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
            _safeApprove(tokenIn, quotes[0].adapter, amountIn);
            amountOut = bestAdapter.swap(
                amountIn, tokenIn, tokenOut, minOut, msg.sender
            );
        }

        require(amountOut >= minOut, "output below min");
        emit Swapped(msg.sender, tokenIn, tokenOut, amountIn, amountOut, quotes[0].adapter);
    }

    // ===== 拆分兑换（路由到最优 N 个 DEX） =====

    /// @notice 拆分兑换 — 将一笔交易拆分到最优的 N 个 DEX 以降低滑点
    /// @param dexCount  拆到几个 DEX（1 = 等价 swap()）
    function splitSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        uint256 dexCount
    ) external payable whenNotPaused nonReentrant returns (uint256 totalOut) {
        require(dexCount >= 1 && dexCount <= MAX_DEX_COUNT, "invalid dexCount");
        require(amountIn > 0, "zero amount");

        Quote[] memory quotes = getAllQuotes(tokenIn, tokenOut, amountIn);
        require(quotes.length > 0 && quotes[0].amountOut > 0, "no route");

        // 实际使用的 DEX 数量
        uint256 n = dexCount;
        if (n > quotes.length) n = quotes.length;

        // 计算每个 DEX 的权重（基于报价比例）
        uint256 totalQuote;
        for (uint256 i = 0; i < n; i++) {
            totalQuote += quotes[i].amountOut;
        }

        // 按权重分配输入金额
        SplitResult[] memory splits = new SplitResult[](n);
        for (uint256 i = 0; i < n; i++) {
            // 最后一个 DEX 拿剩余所有（避免精度损失）
            uint256 splitAmount;
            if (i == n - 1) {
                splitAmount = amountIn - _sumSplitAmounts(splits, i);
            } else {
                splitAmount = (amountIn * quotes[i].amountOut) / totalQuote;
                if (splitAmount == 0) splitAmount = 1; // 防止 0 分配
            }
            splits[i] = SplitResult({
                adapter: quotes[i].adapter,
                amountIn: splitAmount,
                amountOut: 0
            });
        }

        // 处理输入资金
        if (tokenIn == address(0)) {
            require(msg.value >= amountIn, "insufficient ETH");
        } else {
            _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
        }

        // 逐个执行
        for (uint256 i = 0; i < n; i++) {
            if (splits[i].amountIn == 0) continue;
            IDEXAdapter adapter = IDEXAdapter(splits[i].adapter);

            if (tokenIn == address(0)) {
                // 给适配器授权 ETH
                _safeApprove(tokenIn, splits[i].adapter, splits[i].amountIn);
                // ETH → Token: adapter 需要接收 ETH
                uint256 out = adapter.swap{value: splits[i].amountIn}(
                    splits[i].amountIn, tokenIn, tokenOut, 0, msg.sender
                );
                splits[i].amountOut = out;
            } else {
                _safeApprove(tokenIn, splits[i].adapter, splits[i].amountIn);
                uint256 out = adapter.swap(
                    splits[i].amountIn, tokenIn, tokenOut, 0, msg.sender
                );
                splits[i].amountOut = out;
            }
            totalOut += splits[i].amountOut;
        }

        // 退多余 ETH
        if (tokenIn == address(0) && msg.value > amountIn) {
            payable(msg.sender).transfer(msg.value - amountIn);
        }

        // 收手续费
        uint256 fee;
        if (feePercent > 0) {
            fee = (totalOut * feePercent) / FEE_DENOMINATOR;
            totalFeesEarned += fee;
        }
        totalOut -= fee;
        require(totalOut >= minOut, "slippage");

        emit SplitSwapped(msg.sender, tokenIn, tokenOut, amountIn, totalOut, n);
    }

    // ===== 内部辅助 =====

    function _sumSplitAmounts(SplitResult[] memory splits, uint256 upTo)
        internal pure returns (uint256 sum)
    {
        for (uint256 i = 0; i < upTo; i++) {
            sum += splits[i].amountIn;
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(0x23b872dd, from, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "transferFrom failed");
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(0x095ea7b3, spender, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "approve failed");
    }

    /// @notice 允许接收 ETH
    receive() external payable {}
}
