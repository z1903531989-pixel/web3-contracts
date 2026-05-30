// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// 统一 DEX 适配器接口
// 所有接入聚合器的 DEX 都必须实现此接口

interface IDEXAdapter {
    /// @notice 查询给定输入金额能换到多少输出
    /// @param amountIn 输入金额
    /// @param tokenIn  输入代币地址（address(0) = ETH）
    /// @param tokenOut 输出代币地址（address(0) = ETH）
    /// @return amountOut 预期输出金额
    function getAmountOut(
        uint256 amountIn,
        address tokenIn,
        address tokenOut
    ) external view returns (uint256 amountOut);

    /// @notice 执行实际兑换
    /// @param amountIn  输入金额
    /// @param tokenIn   输入代币地址
    /// @param tokenOut  输出代币地址
    /// @param minOut    最小输出（滑点保护）
    /// @param recipient 接收地址
    /// @return amountOut 实际输出金额
    function swap(
        uint256 amountIn,
        address tokenIn,
        address tokenOut,
        uint256 minOut,
        address recipient
    ) external payable returns (uint256 amountOut);

    /// @notice DEX 名称（方便前端展示）
    function name() external view returns (string memory);
}
