// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// 功能：铸造上限、销毁、交易手续费、暂停、所有权转移
// 接外包最常见需求全包含

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract AdvancedToken is ERC20, Ownable {
    // === 配置项 ===
    uint256 public constant MAX_SUPPLY = 10_000_000 * 10 ** 18; // 总量 1 千万
    uint256 public constant TAX_PERCENT = 100;                   // 交易税 1% (100 = 1.00%)
    uint256 public constant TAX_DENOMINATOR = 10000;
    bool public paused;

    // === 事件（给前端/浏览器看） ===
    event TaxCollected(address from, uint256 amount);
    event Burned(address burner, uint256 amount);

    constructor(string memory name, string memory symbol)
        ERC20(name, symbol)
        Ownable(msg.sender)
    {}

    // === 铸造（只有 Owner 能调用，受总量上限约束） ===
    function mint(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply");
        _mint(to, amount);
    }

    // === 销毁 ===
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
        emit Burned(msg.sender, amount);
    }

    // === 暂停 / 恢复 ===
    function pause() external onlyOwner { paused = true; }
    function unpause() external onlyOwner { paused = false; }
    modifier whenNotPaused() {
        require(!paused, "Contract paused");
        _;
    }

    // === 带手续费的转账（覆盖 ERC20 内部方法） ===
    function _update(address from, address to, uint256 value)
        internal
        override
        whenNotPaused
    {
        // 只对普通转账收税，mint/burn 不收
        if (from != address(0) && to != address(0) && TAX_PERCENT > 0) {
            uint256 tax = (value * TAX_PERCENT) / TAX_DENOMINATOR;
            if (tax > 0) {
                super._update(from, address(this), tax);  // 税转给合约地址
                emit TaxCollected(from, tax);
                value -= tax;
            }
        }
        super._update(from, to, value);
    }
}
