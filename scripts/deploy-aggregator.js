const hre = require("hardhat");

// Sepolia Uniswap V2 Router02 (canonical — deterministic deployment)
// 如果 Sepolia 上没有，可以换成其他 DEX router 或跳过 UniswapAdapter
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

async function main() {
  const [signer] = await hre.ethers.getSigners();
  console.log("👛 部署钱包:", signer.address);
  console.log("");

  // ========== 1. 部署测试代币 ==========
  console.log("=== 1. 部署测试代币 ===");
  const MyToken = await hre.ethers.getContractFactory("MyToken");
  const testToken = await MyToken.deploy();
  await testToken.waitForDeployment();
  const testTokenAddr = await testToken.getAddress();
  console.log("TestToken:", testTokenAddr);

  // ========== 2. 部署 SimplePool（升级版） ==========
  console.log("\n=== 2. 部署 SimplePool（AMM 流动性池） ===");
  const SimplePool = await hre.ethers.getContractFactory("SimplePool");
  const pool = await SimplePool.deploy(testTokenAddr);
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log("SimplePool:", poolAddr);

  // 添加初始流动性
  console.log("添加初始流动性...");
  const liqToken = hre.ethers.parseEther("10000");  // 10,000 tokens
  const liqEth = hre.ethers.parseEther("0.1");       // 0.1 ETH
  await (await testToken.approve(poolAddr, liqToken)).wait();
  await (await pool.addLiquidity(liqToken, { value: liqEth })).wait();
  console.log("流动性已添加: 10,000 tokens + 0.1 ETH");
  console.log("  初始价格: 1 ETH =", 10000 / 0.1, "tokens");

  // ========== 3. 部署 SimplePoolAdapter ==========
  console.log("\n=== 3. 部署 SimplePoolAdapter ===");
  const SimplePoolAdapter = await hre.ethers.getContractFactory("SimplePoolAdapter");
  const simplePoolAdapter = await SimplePoolAdapter.deploy(poolAddr);
  await simplePoolAdapter.waitForDeployment();
  const simplePoolAdapterAddr = await simplePoolAdapter.getAddress();
  console.log("SimplePoolAdapter:", simplePoolAdapterAddr);

  // ========== 4. 部署 UniswapV2Adapter ==========
  console.log("\n=== 4. 部署 UniswapV2Adapter ===");
  let uniswapAdapterAddr = "N/A (router not available on Sepolia)";
  try {
    const UniAdapter = await hre.ethers.getContractFactory("UniswapV2Adapter");
    const uniAdapter = await UniAdapter.deploy(UNISWAP_V2_ROUTER);
    await uniAdapter.waitForDeployment();
    uniswapAdapterAddr = await uniAdapter.getAddress();
    console.log("UniswapV2Adapter:", uniswapAdapterAddr);
  } catch (e) {
    console.log("UniswapV2Adapter 部署失败 (Uniswap V2 可能在 Sepolia 不可用):", e.message);
  }

  // ========== 5. 部署 TokenAggregator（核心） ==========
  console.log("\n=== 5. 部署 TokenAggregator（聚合平台核心） ===");
  const TokenAggregator = await hre.ethers.getContractFactory("TokenAggregator");
  const aggregator = await TokenAggregator.deploy();
  await aggregator.waitForDeployment();
  const aggregatorAddr = await aggregator.getAddress();
  console.log("TokenAggregator:", aggregatorAddr);

  // ========== 6. 注册适配器 ==========
  console.log("\n=== 6. 注册适配器到聚合平台 ===");
  await (await aggregator.addAdapter(simplePoolAdapterAddr)).wait();
  console.log("✅ SimplePoolAdapter 已注册");

  if (uniswapAdapterAddr !== "N/A (router not available on Sepolia)") {
    try {
      await (await aggregator.addAdapter(uniswapAdapterAddr)).wait();
      console.log("✅ UniswapV2Adapter 已注册");
    } catch (e) {
      console.log("UniswapV2Adapter 注册失败:", e.message);
    }
  }

  // ========== 7. 测试报价 ==========
  console.log("\n=== 7. 测试聚合器报价 ===");
  const testAmount = hre.ethers.parseEther("0.01");  // 0.01 ETH
  const [bestAdapter, bestAmountOut] = await aggregator.getBestQuote(
    hre.ethers.ZeroAddress,  // ETH
    testTokenAddr,           // Token
    testAmount
  );
  console.log("查询: 0.01 ETH → Token");
  console.log("  最优适配器:", bestAdapter);
  console.log("  预期输出:", bestAmountOut > 0 ? hre.ethers.formatEther(bestAmountOut) : "0", "tokens");

  // ========== 汇总 ==========
  console.log("\n==========================================");
  console.log("   🎉 Token 聚合平台部署完成！");
  console.log("==========================================");
  console.log("");
  console.log("| 合约 | 地址 |");
  console.log("|------|------|");
  console.log("| TestToken |", testTokenAddr, "|");
  console.log("| SimplePool (AMM) |", poolAddr, "|");
  console.log("| SimplePoolAdapter |", simplePoolAdapterAddr, "|");
  console.log("| UniswapV2Adapter |", uniswapAdapterAddr, "|");
  console.log("| TokenAggregator ★ |", aggregatorAddr, "|");
  console.log("");
  console.log("Etherscan 验证链接:");
  console.log("  TokenAggregator: https://sepolia.etherscan.io/address/" + aggregatorAddr);
  console.log("  SimplePool: https://sepolia.etherscan.io/address/" + poolAddr);
  console.log("");
  console.log("下一步:");
  console.log("  1. 在 Etherscan 上验证合约");
  console.log("  2. 用 scripts/test-aggregator.js 测试兑换");
  console.log("  3. 添加更多 DEX 适配器扩大聚合范围");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
