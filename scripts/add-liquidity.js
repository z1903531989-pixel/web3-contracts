const hre = require("hardhat");
// 使用 Uniswap 官方 ABI
const INonfungiblePositionManager = require("@uniswap/v3-periphery/artifacts/contracts/interfaces/INonfungiblePositionManager.sol/INonfungiblePositionManager.json");
const IUniswapV3Pool = require("@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json");

const PM_ADDR = "0x1238536071E1c677A632429e3655c799b22cDA52";
const FACTORY = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
const TOKEN = "0x41527818650c40ff3B3A9bc63160706a9d0EE797";
const WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";

async function main() {
  const [signer] = await hre.ethers.getSigners();
  console.log("钱包:", signer.address);

  // 1. 批准代币
  const token = await hre.ethers.getContractAt("ERC20", TOKEN);
  const weth = await hre.ethers.getContractAt("ERC20", WETH);
  const MAX = hre.ethers.MaxUint256;

  const mtkAllow = await token.allowance(signer.address, PM_ADDR);
  if (mtkAllow < hre.ethers.parseEther("10000")) {
    console.log("批准 MTK...");
    await (await token.approve(PM_ADDR, MAX)).wait();
  }
  const wethAllow = await weth.allowance(signer.address, PM_ADDR);
  if (wethAllow < hre.ethers.parseEther("10")) {
    console.log("批准 WETH...");
    await (await weth.approve(PM_ADDR, MAX)).wait();
  }
  console.log("批准完成");

  // 2. 检查 WETH 余额并包装
  const ethAmt = hre.ethers.parseEther("0.01");
  if ((await weth.balanceOf(signer.address)) < ethAmt) {
    const weth2 = await hre.ethers.getContractAt([
      "function deposit() payable"
    ], WETH);
    console.log("包装 ETH → WETH...");
    await (await weth2.deposit({ value: ethAmt })).wait();
  }
  console.log("WETH 余额:", hre.ethers.formatEther(await weth.balanceOf(signer.address)));

  // 3. 使用官方 ABI 连接 PositionManager
  const pm = await hre.ethers.getContractAt(
    INonfungiblePositionManager.abi,
    PM_ADDR
  );

  // 4. 创建并初始化池子
  const [t0, t1] = TOKEN.toLowerCase() < WETH.toLowerCase()
    ? [TOKEN, WETH] : [WETH, TOKEN];
  const mtkIsToken0 = t0 === TOKEN;

  let sqrtPriceX96;
  if (mtkIsToken0) {
    sqrtPriceX96 = BigInt(Math.floor(Math.sqrt(0.00001) * 2 ** 96));
  } else {
    sqrtPriceX96 = BigInt(Math.floor(Math.sqrt(100000) * 2 ** 96));
  }

  console.log("\n创建/检查池子...");
  try {
    const tx = await pm.createAndInitializePoolIfNecessary(t0, t1, 3000, sqrtPriceX96);
    await tx.wait();
    console.log("池子已创建");
  } catch (e) {
    console.log("池子已存在:", e.message?.slice(0, 60));
  }

  // 5. 查池子
  const factory = await hre.ethers.getContractAt([
    "function getPool(address,address,uint24) view returns (address)"
  ], FACTORY);
  const poolAddr = await factory.getPool(t0, t1, 3000);
  console.log("池子地址:", poolAddr);

  // 检查池子状态
  const pool = await hre.ethers.getContractAt(IUniswapV3Pool.abi, poolAddr);
  try {
    const s0 = await pool.slot0();
    console.log("池子 tick:", s0.tick);
    console.log("池子 liquidity:", (await pool.liquidity()).toString());
  } catch (e) {
    console.log("池子状态异常:", e.message?.slice(0, 80));
    return;
  }

  // 6. 添加流动性
  const tokenAmt = hre.ethers.parseEther("1000");
  const amount0Desired = mtkIsToken0 ? tokenAmt : ethAmt;
  const amount1Desired = mtkIsToken0 ? ethAmt : tokenAmt;
  const MIN_TICK = -887200;
  const MAX_TICK = 887200;
  const deadline = Math.floor(Date.now() / 1000) + 600;

  console.log(`\n添加流动性: ${hre.ethers.formatEther(tokenAmt)} MTK + ${hre.ethers.formatEther(ethAmt)} WETH`);
  console.log("amount0Desired:", amount0Desired.toString());
  console.log("amount1Desired:", amount1Desired.toString());

  const tx = await pm.mint({
    token0: t0,
    token1: t1,
    fee: 3000,
    tickLower: MIN_TICK,
    tickUpper: MAX_TICK,
    amount0Desired,
    amount1Desired,
    amount0Min: 0,
    amount1Min: 0,
    recipient: signer.address,
    deadline,
  });
  const receipt = await tx.wait();

  // 解析 tokenId
  const iface = new hre.ethers.Interface(INonfungiblePositionManager.abi);
  let tokenId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed && parsed.name === "IncreaseLiquidity") {
        tokenId = parsed.args.tokenId;
        console.log("tokenId:", tokenId.toString());
      }
    } catch {}
  }

  console.log("\n====================================");
  console.log("流动性添加成功！");
  console.log("交易对地址:", poolAddr);
  console.log(`价格: 1 ETH ≈ 100,000 MTK`);
  console.log(`Etherscan: https://sepolia.etherscan.io/address/${poolAddr}`);
  console.log("====================================");
}

main().catch(e => {
  console.error("失败:", e.message?.slice(0, 300));
});
