// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// 简易 AMM 流动性池（ETH ↔ Token）
// 恒定乘积公式：x * y = k
// 可作为聚合器的自有流动性来源

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC20 {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function decimals() external view returns (uint8);
}

contract SimplePool is Ownable, ReentrancyGuard {
    IERC20 public token;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    // 交易手续费 0.3% (30 / 10000)
    uint256 public constant FEE = 30;
    uint256 public constant FEE_DENOMINATOR = 10000;

    event AddLiquidity(address indexed provider, uint256 tokenAmount, uint256 ethAmount, uint256 lpAmount);
    event RemoveLiquidity(address indexed provider, uint256 lpAmount, uint256 tokenAmount, uint256 ethAmount);
    event Swap(address indexed user, uint256 amountIn, uint256 amountOut, bool isTokenToEth);

    constructor(address _token) Ownable(msg.sender) {
        token = IERC20(_token);
    }

    // ===== 报价查询（给聚合器用） =====

    /// @notice 查询 ETH → Token 能换到多少代币（含手续费）
    function getEthToTokenAmount(uint256 ethAmount) public view returns (uint256) {
        uint256 ethReserve = address(this).balance;
        uint256 tokenReserve = token.balanceOf(address(this));
        if (ethReserve == 0 || tokenReserve == 0) return 0;
        uint256 ethWithFee = ethAmount * (FEE_DENOMINATOR - FEE);
        uint256 numerator = ethWithFee * tokenReserve;
        uint256 denominator = ethReserve * FEE_DENOMINATOR + ethWithFee;
        return numerator / denominator;
    }

    /// @notice 查询 Token → ETH 能换到多少 ETH（含手续费）
    function getTokenToEthAmount(uint256 tokenAmount) public view returns (uint256) {
        uint256 ethReserve = address(this).balance;
        uint256 tokenReserve = token.balanceOf(address(this));
        if (ethReserve == 0 || tokenReserve == 0) return 0;
        uint256 tokenWithFee = tokenAmount * (FEE_DENOMINATOR - FEE);
        uint256 numerator = tokenWithFee * ethReserve;
        uint256 denominator = tokenReserve * FEE_DENOMINATOR + tokenWithFee;
        return numerator / denominator;
    }

    /// @notice 返回池子的两种资产地址（ETH 用 address(0) 表示）
    function getTokenAddress() external view returns (address) {
        return address(token);
    }

    /// @notice 返回池子的储备量
    function getReserves() external view returns (uint256 ethReserve, uint256 tokenReserve) {
        return (address(this).balance, token.balanceOf(address(this)));
    }

    // ===== 流动性操作 =====

    function addLiquidity(uint256 tokenAmount) external payable nonReentrant {
        require(msg.value > 0 && tokenAmount > 0, "need both");
        token.transferFrom(msg.sender, address(this), tokenAmount);
        uint256 lp;
        if (totalSupply == 0) {
            lp = msg.value;
        } else {
            lp = (msg.value * totalSupply) / (address(this).balance - msg.value);
        }
        totalSupply += lp;
        balanceOf[msg.sender] += lp;
        emit AddLiquidity(msg.sender, tokenAmount, msg.value, lp);
    }

    function removeLiquidity(uint256 lpAmount) external nonReentrant {
        require(lpAmount > 0 && balanceOf[msg.sender] >= lpAmount, "insufficient LP");
        uint256 ethAmount = (lpAmount * address(this).balance) / totalSupply;
        uint256 tokenAmount = (lpAmount * token.balanceOf(address(this))) / totalSupply;
        totalSupply -= lpAmount;
        balanceOf[msg.sender] -= lpAmount;
        payable(msg.sender).transfer(ethAmount);
        token.transfer(msg.sender, tokenAmount);
        emit RemoveLiquidity(msg.sender, lpAmount, tokenAmount, ethAmount);
    }

    // ===== 兑换 =====

    /// @notice ETH → Token
    function ethToToken() external payable nonReentrant {
        uint256 out = getEthToTokenAmount(msg.value);
        require(out > 0 && out <= token.balanceOf(address(this)), "insufficient liquidity");
        token.transfer(msg.sender, out);
        emit Swap(msg.sender, msg.value, out, false);
    }

    /// @notice Token → ETH
    function tokenToEth(uint256 tokenAmount) external nonReentrant {
        uint256 out = getTokenToEthAmount(tokenAmount);
        require(out > 0 && out <= address(this).balance, "insufficient liquidity");
        token.transferFrom(msg.sender, address(this), tokenAmount);
        payable(msg.sender).transfer(out);
        emit Swap(msg.sender, tokenAmount, out, true);
    }

    /// @notice 允许直接接收 ETH（用于聚合器路由）
    receive() external payable {}
}
