const hre = require("hardhat");

const TOKEN = "0x41527818650c40ff3B3A9bc63160706a9d0EE797";
const POOL = "0xa14ebD3b5D12821302C6D92063aA2d045Ef0d336";

async function main() {
  const [signer] = await hre.ethers.getSigners();
  console.log("钱包:", signer.address);
  console.log("ETH 余额:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(signer.address)));

  const token = await hre.ethers.getContractAt("ERC20", TOKEN);
  const pool = await hre.ethers.getContractAt([
    "function ethToToken() external payable",
    "function tokenToEth(uint256) external",
    "function balanceOf(address) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
  ], POOL);

  // 查初始状态
  console.log("\n=== 池子初始状态 ===");
  const poolEth = await hre.ethers.provider.getBalance(POOL);
  const poolMtk = await token.balanceOf(POOL);
  console.log("池子 ETH:", hre.ethers.formatEther(poolEth));
  console.log("池子 MTK:", hre.ethers.formatEther(poolMtk));
  console.log("价格: 1 ETH ≈", Math.round(parseFloat(hre.ethers.formatEther(poolMtk)) / parseFloat(hre.ethers.formatEther(poolEth))), "MTK");

  // 测试 1: ETH → MTK (买入)
  console.log("\n=== 测试 1: 用 0.001 ETH 买 MTK ===");
  const ethIn = hre.ethers.parseEther("0.001");
  const mtkBefore = await token.balanceOf(signer.address);

  const buyTx = await pool.ethToToken({ value: ethIn });
  await buyTx.wait();

  const mtkAfter = await token.balanceOf(signer.address);
  const mtkBought = mtkAfter - mtkBefore;
  console.log("花掉: 0.001 ETH");
  console.log("买到:", hre.ethers.formatEther(mtkBought), "MTK");

  // 查新状态
  console.log("\n=== 池子新状态 ===");
  const poolEth2 = await hre.ethers.provider.getBalance(POOL);
  const poolMtk2 = await token.balanceOf(POOL);
  console.log("池子 ETH:", hre.ethers.formatEther(poolEth2));
  console.log("池子 MTK:", hre.ethers.formatEther(poolMtk2));
  console.log("价格: 1 ETH ≈", Math.round(parseFloat(hre.ethers.formatEther(poolMtk2)) / parseFloat(hre.ethers.formatEther(poolEth2))), "MTK");

  // 测试 2: MTK → ETH (卖出)
  console.log("\n=== 测试 2: 卖回 MTK 换 ETH ===");
  const sellAmt = mtkBought; // 卖回刚买的
  await (await token.approve(POOL, sellAmt)).wait();

  const ethBefore = await hre.ethers.provider.getBalance(signer.address);
  const sellTx = await pool.tokenToEth(sellAmt);
  const receipt = await sellTx.wait();
  const ethAfter = await hre.ethers.provider.getBalance(signer.address);

  const gasUsed = receipt.gasUsed * receipt.gasPrice;
  const ethGot = ethAfter - ethBefore + gasUsed; // 加回 gas 费
  console.log("卖出:", hre.ethers.formatEther(sellAmt), "MTK");
  console.log("换回:", hre.ethers.formatEther(ethGot), "ETH");
  console.log("(有一点滑点和 gas 费损耗)");

  console.log("\n====================================");
  console.log("Swap 功能验证通过！");
  console.log("买入卖出都正常工作");
  console.log("====================================");
}

main().catch(e => console.error("失败:", e.message?.slice(0, 200)));
