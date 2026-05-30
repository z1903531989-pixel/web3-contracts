// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// SimplePool 适配器 — 把你的自有 AMM 接入聚合器

import "../interfaces/IDEXAdapter.sol";

interface ISimplePool {
    function getEthToTokenAmount(uint256 ethAmount) external view returns (uint256);
    function getTokenToEthAmount(uint256 tokenAmount) external view returns (uint256);
    function ethToToken() external payable;
    function tokenToEth(uint256 tokenAmount) external;
    function getTokenAddress() external view returns (address);
    function getReserves() external view returns (uint256 ethReserve, uint256 tokenReserve);
}

contract SimplePoolAdapter is IDEXAdapter {
    ISimplePool public immutable pool;
    address public immutable poolToken;

    constructor(address _pool) {
        pool = ISimplePool(_pool);
        poolToken = pool.getTokenAddress();
    }

    function name() external pure override returns (string memory) {
        return "SimplePool";
    }

    /// @notice 报价查询
    /// SimplePool 只支持 ETH ↔ Token，不支持 Token ↔ Token
    function getAmountOut(
        uint256 amountIn,
        address tokenIn,
        address tokenOut
    ) external view override returns (uint256 amountOut) {
        if (tokenIn == address(0) && tokenOut == poolToken) {
            // ETH → Token
            amountOut = pool.getEthToTokenAmount(amountIn);
        } else if (tokenIn == poolToken && tokenOut == address(0)) {
            // Token → ETH
            amountOut = pool.getTokenToEthAmount(amountIn);
        } else {
            // 不支持的交易对，返回 0
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
        if (tokenIn == address(0) && tokenOut == poolToken) {
            // ETH → Token
            require(msg.value >= amountIn, "insufficient ETH");
            uint256 ethBefore = address(this).balance;
            pool.ethToToken{value: amountIn}();
            uint256 ethAfter = address(this).balance;
            // 多余的 ETH 退回给聚合器处理
            amountOut = ethBefore - ethAfter; // won't be used; get actual token balance instead
            // Transfer tokens from this adapter to recipient
            IERC20 token = IERC20(poolToken);
            amountOut = token.balanceOf(address(this));
            require(amountOut >= minOut, "slippage");
            token.transfer(recipient, amountOut);
        } else if (tokenIn == poolToken && tokenOut == address(0)) {
            // Token → ETH
            IERC20(poolToken).transferFrom(msg.sender, address(this), amountIn);
            IERC20(poolToken).approve(address(pool), amountIn);
            uint256 ethBefore = address(this).balance;
            pool.tokenToEth(amountIn);
            uint256 ethAfter = address(this).balance;
            amountOut = ethAfter - ethBefore;
            require(amountOut >= minOut, "slippage");
            payable(recipient).transfer(amountOut);
        } else {
            revert("SimplePool: unsupported pair");
        }
    }
}

interface IERC20 {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}
