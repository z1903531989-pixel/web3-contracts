const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  console.log("钱包:", signer.address);
  console.log("");

  // ========== 1. 部署 AdvancedToken ==========
  console.log("=== 1. 部署 AdvancedToken ===");
  const Token = await hre.ethers.getContractFactory("AdvancedToken");
  const token = await Token.deploy("Portfolio Token", "PTK");
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("AdvancedToken:", tokenAddr);

  // 铸造初始供应量
  const mintTx = await token.mint(signer.address, hre.ethers.parseEther("1000000"));
  await mintTx.wait();
  const tokBal = await token.balanceOf(signer.address);
  console.log("铸造后余额:", hre.ethers.formatEther(tokBal), "PTK");

  // ========== 2. 部署 Presale ==========
  console.log("\n=== 2. 部署 Presale ===");
  const Presale = await hre.ethers.getContractFactory("Presale");
  const rate = hre.ethers.parseEther("1000");   // 1 ETH = 1000 PTK
  const hardCap = hre.ethers.parseEther("10");   // 最多筹 10 ETH
  const duration = 7 * 24 * 3600;                 // 7 天
  const presale = await Presale.deploy(tokenAddr, rate, hardCap, duration);
  await presale.waitForDeployment();
  const presaleAddr = await presale.getAddress();
  console.log("Presale:", presaleAddr);

  // 往 Presale 转代币供用户购买
  await (await token.transfer(presaleAddr, hre.ethers.parseEther("500000"))).wait();
  console.log("已将 500,000 PTK 转入预售合约");

  // ========== 3. 部署 Staking ==========
  console.log("\n=== 3. 部署 Staking ===");
  const Staking = await hre.ethers.getContractFactory("Staking");
  const staking = await Staking.deploy(tokenAddr, tokenAddr);
  await staking.waitForDeployment();
  const stakingAddr = await staking.getAddress();
  console.log("Staking:", stakingAddr);

  // 往 Staking 转奖励代币
  await (await token.transfer(stakingAddr, hre.ethers.parseEther("100000"))).wait();
  console.log("已将 100,000 PTK 转入质押合约作为奖励池");

  // ========== 4. 部署 Airdrop ==========
  console.log("\n=== 4. 部署 Airdrop ===");
  const Airdrop = await hre.ethers.getContractFactory("Airdrop");
  const airdrop = await Airdrop.deploy(tokenAddr);
  await airdrop.waitForDeployment();
  const airdropAddr = await airdrop.getAddress();
  console.log("Airdrop:", airdropAddr);

  // 往 Airdrop 转代币
  await (await token.transfer(airdropAddr, hre.ethers.parseEther("50000"))).wait();
  console.log("已将 50,000 PTK 转入空投合约");

  // ========== 汇总 ==========
  console.log("\n==========================================");
  console.log("        所有合约部署完成！");
  console.log("==========================================");
  console.log("");
  console.log("| 合约 | 地址 | 用途 |");
  console.log("|------|------|------|");
  console.log("| AdvancedToken |", tokenAddr, "| ERC-20 代币 |");
  console.log("| Presale |", presaleAddr, "| 预售/ICO |");
  console.log("| Staking |", stakingAddr, "| 质押挖矿 |");
  console.log("| Airdrop |", airdropAddr, "| 空投 |");
  console.log("");
  console.log("钱包:", signer.address);
  console.log("余额:", hre.ethers.formatEther(tokBal), "PTK");
  console.log("");
  console.log("Etherscan:");
  console.log("  Token:", "https://sepolia.etherscan.io/address/" + tokenAddr);
  console.log("  Presale:", "https://sepolia.etherscan.io/address/" + presaleAddr);
  console.log("  Staking:", "https://sepolia.etherscan.io/address/" + stakingAddr);
  console.log("  Airdrop:", "https://sepolia.etherscan.io/address/" + airdropAddr);
}

main().catch(console.error);
