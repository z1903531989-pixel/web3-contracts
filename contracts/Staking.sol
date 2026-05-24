// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// 质押挖矿合约
// 用户锁定代币，按时间比例获得奖励
// 接外包标准需求

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

contract Staking is Ownable, ReentrancyGuard {
    IERC20 public stakingToken;
    IERC20 public rewardToken;

    struct Stake {
        uint256 amount;       // 质押数量
        uint256 startTime;    // 开始时间
        uint256 rewardPaid;   // 已领取奖励
    }

    // uint256 public constant REWARD_RATE = 10;  // 年化 10%（按秒）
    // 简化版：每天每 100 个质押代币 = 1 个奖励代币
    uint256 public rewardRatePerDay = 1; // 1%

    mapping(address => Stake) public stakes;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);

    constructor(address _stakingToken, address _rewardToken) Ownable(msg.sender) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
    }

    // 计算待领取奖励
    function pendingReward(address user) public view returns (uint256) {
        Stake storage s = stakes[user];
        if (s.amount == 0) return 0;
        uint256 daysStaked = (block.timestamp - s.startTime) / 1 days;
        return (s.amount * rewardRatePerDay * daysStaked) / 100 - s.rewardPaid;
    }

    // 质押
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount is zero");
        Stake storage s = stakes[msg.sender];
        // 先领取未领奖励
        uint256 reward = pendingReward(msg.sender);
        if (reward > 0) {
            s.rewardPaid += reward;
            rewardToken.transfer(msg.sender, reward);
            emit RewardClaimed(msg.sender, reward);
        }
        stakingToken.transferFrom(msg.sender, address(this), amount);
        s.amount += amount;
        s.startTime = block.timestamp;
        s.rewardPaid = 0;
        emit Staked(msg.sender, amount);
    }

    // 解质押
    function unstake(uint256 amount) external nonReentrant {
        Stake storage s = stakes[msg.sender];
        require(s.amount >= amount, "Insufficient");

        // 先领取奖励
        uint256 reward = pendingReward(msg.sender);
        if (reward > 0) {
            s.rewardPaid += reward;
            rewardToken.transfer(msg.sender, reward);
            emit RewardClaimed(msg.sender, reward);
        }

        s.amount -= amount;
        if (s.amount == 0) {
            s.startTime = 0;
            s.rewardPaid = 0;
        }
        stakingToken.transfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    // 只领奖励不解质押
    function claimReward() external nonReentrant {
        uint256 reward = pendingReward(msg.sender);
        require(reward > 0, "No reward");
        stakes[msg.sender].rewardPaid += reward;
        rewardToken.transfer(msg.sender, reward);
        emit RewardClaimed(msg.sender, reward);
    }

    // Owner 充值奖励代币
    function depositReward(uint256 amount) external onlyOwner {
        rewardToken.transferFrom(msg.sender, address(this), amount);
    }
}
