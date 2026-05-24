// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Presale / ICO 预售合约
// 用户可以打 ETH 进来，项目方设定代币价格
// 到截止时间或者卖完后自动结束

import "@openzeppelin/contracts/access/Ownable.sol";

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

contract Presale is Ownable {
    IERC20 public token;
    uint256 public rate;           // 1 ETH 能买多少个代币
    uint256 public totalRaised;    // 已筹 ETH
    uint256 public totalSold;      // 已卖代币
    uint256 public hardCap;        // 硬顶（ETH）
    uint256 public endTime;        // 结束时间
    bool public finalized;
    uint256 public minBuy = 0.01 ether;
    uint256 public maxBuy = 5 ether;

    mapping(address => uint256) public contribution;

    event Buy(address indexed buyer, uint256 ethAmount, uint256 tokenAmount);
    event Finalized(uint256 totalRaised, uint256 totalSold);

    constructor(address _token, uint256 _rate, uint256 _hardCap, uint256 _duration) Ownable(msg.sender) {
        token = IERC20(_token);
        rate = _rate;
        hardCap = _hardCap;
        endTime = block.timestamp + _duration;
    }

    modifier active() {
        require(block.timestamp < endTime, "Sale ended");
        require(!finalized, "Already finalized");
        require(totalRaised < hardCap, "Hard cap reached");
        _;
    }

    // 用户打 ETH 购买代币
    function buy() external payable active {
        require(msg.value >= minBuy, "Below min buy");
        require(contribution[msg.sender] + msg.value <= maxBuy, "Exceeds per user");

        uint256 tokenAmount = (msg.value * rate) / 1 ether;
        require(token.balanceOf(address(this)) >= tokenAmount + totalSold, "Insufficient tokens");

        contribution[msg.sender] += msg.value;
        totalRaised += msg.value;
        totalSold += tokenAmount;

        token.transfer(msg.sender, tokenAmount);
        emit Buy(msg.sender, msg.value, tokenAmount);
    }

    // 项目方结算提走 ETH
    function finalize() external onlyOwner {
        require(!finalized, "Already finalized");
        finalized = true;
        payable(owner()).transfer(address(this).balance);
        emit Finalized(totalRaised, totalSold);
    }

    // 紧急退款（如果预售没达标）
    function emergencyWithdraw() external {
        require(!finalized, "Already finalized");
        require(block.timestamp > endTime, "Still active");
        // below half = refundable
        require(totalRaised < hardCap / 2, "Cannot refund");
        uint256 amount = contribution[msg.sender];
        contribution[msg.sender] = 0;
        payable(msg.sender).transfer(amount);
    }

    // Owner 可以提取未卖完的代币
    function withdrawUnsoldTokens() external onlyOwner {
        require(finalized || block.timestamp > endTime, "Still active");
        uint256 remaining = token.balanceOf(address(this));
        token.transfer(owner(), remaining);
    }
}
