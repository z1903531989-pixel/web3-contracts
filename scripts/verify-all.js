const hre = require("hardhat");

const TOKEN = "0x3E0d029C20fa23eE9cb31905C08dD56885B41205";
const PRESALE = "0x7eC57c09379C06d58f883780B7BfDABe6C86063E";
const STAKING = "0x4c182009e50B607345b42D318BD3af09C87EA939";
const AIRDROP = "0xcf74b95c02900e946ef74FF7351653348DD38912";

async function main() {
  const [signer] = await hre.ethers.getSigners();
  console.log("钱包:", signer.address);
  const token = await hre.ethers.getContractAt("ERC20", TOKEN);

  // 1. 代币
  console.log("=== 1. AdvancedToken ===");
  const adv = await hre.ethers.getContractAt([
    "function MAX_SUPPLY() view returns (uint256)",
    "function TAX_PERCENT() view returns (uint256)",
    "function paused() view returns (bool)",
    "function owner() view returns (address)",
  ], TOKEN);
  console.log("总量上限:", hre.ethers.formatEther(await adv.MAX_SUPPLY()));
  console.log("税率:", (await adv.TAX_PERCENT()).toString(), "/10000");
  console.log("暂停:", await adv.paused());
  console.log("Owner:", await adv.owner());
  console.log("余额:", hre.ethers.formatEther(await token.balanceOf(signer.address)));
  console.log("OK");

  // 2. 预售购买
  console.log("\n=== 2. Presale: 购买测试 ===");
  const presale = await hre.ethers.getContractAt([
    "function buy() external payable",
    "function rate() view returns (uint256)",
    "function totalRaised() view returns (uint256)",
  ], PRESALE);
  console.log("1 ETH =", hre.ethers.formatEther(await presale.rate()), "PTK");
  const balBefore = await token.balanceOf(signer.address);
  const tx1 = await presale.buy({ value: hre.ethers.parseEther("0.01") });
  await tx1.wait();
  const ptkGot = (await token.balanceOf(signer.address)) - balBefore;
  console.log("0.01 ETH →", hre.ethers.formatEther(ptkGot), "PTK");
  console.log("已筹 ETH:", hre.ethers.formatEther(await presale.totalRaised()));
  console.log("OK");

  // 3. 质押
  console.log("\n=== 3. Staking: 质押测试 ===");
  const staking = await hre.ethers.getContractAt([
    "function stake(uint256) external",
    "function stakes(address) view returns (uint256,uint256,uint256)",
  ], STAKING);
  const stakeAmt = hre.ethers.parseEther("100");
  await (await token.approve(STAKING, stakeAmt)).wait();
  await (await staking.stake(stakeAmt)).wait();
  const s = await staking.stakes(signer.address);
  console.log("质押:", hre.ethers.formatEther(s[0]), "PTK");
  console.log("OK");

  // 4. 空投
  console.log("\n=== 4. Airdrop: 批量发送测试 ===");
  const airdrop = await hre.ethers.getContractAt([
    "function batchSend(address[],uint256[]) external",
  ], AIRDROP);
  await (await airdrop.batchSend([signer.address], [hre.ethers.parseEther("50")])).wait();
  console.log("空投 50 PTK 成功");
  console.log("OK");

  console.log("\n==========================================");
  console.log("   4/4 合约功能全部验证通过！");
  console.log("==========================================");
}

main().catch(e => console.error("失败:", e.message?.slice(0, 200)));
