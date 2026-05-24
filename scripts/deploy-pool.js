const hre = require("hardhat");

const TOKEN = "0x41527818650c40ff3B3A9bc63160706a9d0EE797";

async function main() {
  const [signer] = await hre.ethers.getSigners();
  console.log("钱包:", signer.address);

  // 部署 SimplePool
  console.log("部署 SimplePool...");
  const Pool = await hre.ethers.getContractFactory("SimplePool");
  const pool = await Pool.deploy(TOKEN);
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log("池子地址:", poolAddr);

  // 授权 SimplePool 使用 MTK
  const token = await hre.ethers.getContractAt("ERC20", TOKEN);
  const tokenAmt = hre.ethers.parseEther("1000");
  const ethAmt = hre.ethers.parseEther("0.01");
  const MAX = hre.ethers.MaxUint256;

  console.log("授权 MTK...");
  await (await token.approve(poolAddr, MAX)).wait();

  // 添加流动性
  console.log(`添加流动性: 1000 MTK + 0.01 ETH...`);
  const tx = await pool.addLiquidity(tokenAmt, { value: ethAmt });
  await tx.wait();

  console.log("\n====================================");
  console.log("池子创建成功！");
  console.log("池子地址:", poolAddr);
  console.log("交易对: MTK / ETH");
  console.log(`初始价格: 1 ETH = 100,000 MTK`);
  console.log(`存入: 1000 MTK + 0.01 ETH`);
  console.log(`Etherscan: https://sepolia.etherscan.io/address/${poolAddr}`);
  console.log("====================================");
}

main().catch(e => console.error("失败:", e.message?.slice(0, 300)));
