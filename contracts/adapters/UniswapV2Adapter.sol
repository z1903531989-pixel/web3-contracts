// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Uniswap V2 适配器 — 接入 Uniswap V2 路由器的所有交易对

import "../interfaces/IDEXAdapter.sol";

interface IUniswapV2Router {
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory amounts);
    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external payable returns (uint256[] memory amounts);
    function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external returns (uint256[] memory amounts);
    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external returns (uint256[] memory amounts);
    function WETH() external pure returns (address);
}

contract UniswapV2Adapter is IDEXAdapter {
    IUniswapV2Router public immutable router;
    address public immutable WETH;

    constructor(address _router) {
        router = IUniswapV2Router(_router);
        WETH = router.WETH();
    }

    function name() external pure override returns (string memory) {
        return "UniswapV2";
    }

    /// @notice 报价查询
    /// 自动处理 path：ETH↔Token 用两跳，Token↔Token（非 ETH）走三跳
    function getAmountOut(
        uint256 amountIn,
        address tokenIn,
        address tokenOut
    ) external view override returns (uint256 amountOut) {
        address[] memory path = _buildPath(tokenIn, tokenOut);
        if (path.length == 0) return 0;
        try router.getAmountsOut(amountIn, path) returns (uint256[] memory amounts) {
            amountOut = amounts[amounts.length - 1];
        } catch {
            amountOut = 0;
        }
    }

    /// @notice 执行兑换
    function swap(
        uint256 amountIn,
        address tokenIn,
        address tokenOut,
        uint256 minOut,
        address recipient
    ) external payable override returns (uint256 amountOut) {
        address[] memory path = _buildPath(tokenIn, tokenOut);
        require(path.length >= 2, "UniswapV2: invalid path");

        if (tokenIn == address(0)) {
            // ETH → Token
            require(msg.value >= amountIn, "insufficient ETH");
            uint256[] memory amounts = router.swapExactETHForTokens{value: amountIn}(
                minOut, path, recipient, block.timestamp + 300
            );
            amountOut = amounts[amounts.length - 1];
        } else if (tokenOut == address(0)) {
            // Token → ETH
            _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
            _safeApprove(tokenIn, address(router), amountIn);
            uint256[] memory amounts = router.swapExactTokensForETH(
                amountIn, minOut, path, recipient, block.timestamp + 300
            );
            amountOut = amounts[amounts.length - 1];
        } else {
            // Token → Token
            _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
            _safeApprove(tokenIn, address(router), amountIn);
            uint256[] memory amounts = router.swapExactTokensForTokens(
                amountIn, minOut, path, recipient, block.timestamp + 300
            );
            amountOut = amounts[amounts.length - 1];
        }
    }

    /// @notice 构建兑换路径
    function _buildPath(address tokenIn, address tokenOut)
        internal view returns (address[] memory path)
    {
        if (tokenIn == address(0)) {
            // ETH → Token: [WETH, tokenOut]
            path = new address[](2);
            path[0] = WETH;
            path[1] = tokenOut;
        } else if (tokenOut == address(0)) {
            // Token → ETH: [tokenIn, WETH]
            path = new address[](2);
            path[0] = tokenIn;
            path[1] = WETH;
        } else {
            // Token → Token: [tokenIn, WETH, tokenOut] (通过 ETH 中转)
            path = new address[](3);
            path[0] = tokenIn;
            path[1] = WETH;
            path[2] = tokenOut;
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
}
