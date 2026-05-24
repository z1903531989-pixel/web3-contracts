# Web3 Smart Contract Portfolio

A complete set of production-ready smart contracts for token launch, presale, staking, airdrop, and liquidity pool — built with Hardhat + OpenZeppelin, deployed and verified on Sepolia testnet.

## Deployed Contracts (Sepolia)

| Contract | Address | Description |
|----------|---------|-------------|
| [AdvancedToken](contracts/AdvancedToken.sol) | `0x3E0d029C20fa23eE9cb31905C08dD56885B41205` | ERC-20 with max supply, tax, burn, pausable |
| [Presale](contracts/Presale.sol) | `0x7eC57c09379C06d58f883780B7BfDABe6C86063E` | ICO presale with hard cap, refund, time limit |
| [Staking](contracts/Staking.sol) | `0x4c182009e50B607345b42D318BD3af09C87EA939` | Token staking with daily rewards |
| [Airdrop](contracts/Airdrop.sol) | `0xcf74b95c02900e946ef74FF7351653348DD38912` | Merkle-based + batch airdrop |
| [SimplePool](contracts/SimplePool.sol) | `0xa14ebD3b5D12821302C6D92063aA2d045Ef0d336` | AMM liquidity pool (ETH/Token) |

## Features

### AdvancedToken
- Capped total supply (10M)
- 1% transfer tax (configurable)
- Mintable (owner only)
- Burnable
- Pausable (emergency stop)
- Ownable (admin control)

### Presale / ICO
- ETH → Token swap at fixed rate
- Hard cap with auto-close
- Time-limited sale window
- Per-user min/max contribution
- Owner withdrawal on completion
- Emergency refund if below 50% hard cap

### Staking
- Lock tokens, earn daily rewards
- 1% daily reward rate (configurable)
- Auto-compound on re-stake
- Claim-only mode (no unstake)
- ReentrancyGuard protected

### Airdrop
- Merkle proof whitelist (anti-sybil)
- Batch direct send (owner-only, for small lists)
- Withdrawable remaining tokens

### SimplePool
- Constant product AMM (x * y = k)
- ETH ↔ Token bidirectional swap
- Liquidity provider shares
- Minimal gas, no external dependencies

## Quick Start

```bash
# Install dependencies
npm install

# Compile
npx hardhat compile

# Deploy all contracts
npx hardhat run scripts/deploy-all.js --network sepolia

# Run verification tests
npx hardhat run scripts/verify-all.js --network sepolia
```

## Environment

Copy `.env.example` to `.env` and add your private key:

```
PRIVATE_KEY=0x_your_private_key_here
```

## Tech Stack

- **Solidity** 0.8.20
- **Hardhat** 2.x
- **OpenZeppelin** 5.x (ERC20, Ownable, ReentrancyGuard, MerkleProof)
- **ethers.js** 6.x
- **Network**: Sepolia testnet

## License

MIT
