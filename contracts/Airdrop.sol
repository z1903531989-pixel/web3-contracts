// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// 空投合约
// 批量给地址发代币，支持 Merkle Proof（白名单）或直接发送

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

contract Airdrop is Ownable {
    IERC20 public token;
    bytes32 public merkleRoot;
    mapping(address => bool) public claimed;
    uint256 public totalClaimed;

    event Claimed(address indexed user, uint256 amount);
    event DirectSend(address indexed to, uint256 amount);

    constructor(address _token) Ownable(msg.sender) {
        token = IERC20(_token);
    }

    // === Merkle 白名单空投（防女巫） ===
    function setMerkleRoot(bytes32 _root) external onlyOwner {
        merkleRoot = _root;
    }

    function claimMerkle(uint256 amount, bytes32[] calldata proof) external {
        require(!claimed[msg.sender], "Already claimed");
        require(merkleRoot != bytes32(0), "Root not set");

        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, amount));
        require(MerkleProof.verify(proof, merkleRoot, leaf), "Not in list");

        claimed[msg.sender] = true;
        totalClaimed++;
        token.transfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    // === 批量直发（Owner 专用，小地址量用这个简单） ===
    function batchSend(address[] calldata recipients, uint256[] calldata amounts) external onlyOwner {
        require(recipients.length == amounts.length, "Length mismatch");
        uint256 total;
        for (uint256 i = 0; i < recipients.length; i++) {
            token.transfer(recipients[i], amounts[i]);
            total += amounts[i];
            emit DirectSend(recipients[i], amounts[i]);
        }
    }

    // 提走剩余代币
    function withdraw() external onlyOwner {
        uint256 bal = token.balanceOf(address(this));
        token.transfer(owner(), bal);
    }
}
