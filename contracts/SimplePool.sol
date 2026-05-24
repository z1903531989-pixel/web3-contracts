// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

contract SimplePool {
    IERC20 public token;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    event AddLiquidity(address indexed provider, uint256 tokenAmount, uint256 ethAmount);
    event Swap(address indexed user, uint256 amountIn, uint256 amountOut, bool isTokenToEth);

    constructor(address _token) { token = IERC20(_token); }

    // 添加流动性：存入代币+ETH，获得LP份额
    function addLiquidity(uint256 tokenAmount) external payable {
        require(msg.value > 0 && tokenAmount > 0, "need both");
        token.transferFrom(msg.sender, address(this), tokenAmount);
        uint256 lp = totalSupply == 0 ? msg.value : (msg.value * totalSupply) / (address(this).balance - msg.value);
        totalSupply += lp;
        balanceOf[msg.sender] += lp;
        emit AddLiquidity(msg.sender, tokenAmount, msg.value);
    }

    // ETH → 代币
    function ethToToken() external payable {
        uint256 ethReserve = address(this).balance - msg.value;
        uint256 tokenReserve = token.balanceOf(address(this));
        uint256 out = (msg.value * tokenReserve) / ethReserve;
        require(out > 0 && out <= tokenReserve, "insufficient");
        token.transfer(msg.sender, out);
        emit Swap(msg.sender, msg.value, out, false);
    }

    // 代币 → ETH
    function tokenToEth(uint256 tokenAmount) external {
        uint256 ethReserve = address(this).balance;
        uint256 tokenReserve = token.balanceOf(address(this));
        uint256 out = (tokenAmount * ethReserve) / tokenReserve;
        require(out > 0 && out <= ethReserve, "insufficient");
        token.transferFrom(msg.sender, address(this), tokenAmount);
        payable(msg.sender).transfer(out);
        emit Swap(msg.sender, tokenAmount, out, true);
    }
}
