// 测试聚合器完整流程：
// 1. 查询所有适配器报价
// 2. 执行单 DEX 兑换
// 3. 执行拆分兑换
// 使用方法: npx hardhat run scripts/test-aggregator.js --network sepolia

const hre = require("hardhat");

// 部署后的合约地址（运行 deploy-aggregator.js 后更新）
const CONTRACTS = {
  testToken: "",       // 填入 TestToken 地址
  simplePool: "",      // 填入 SimplePool 地址
  aggregator: "",      // 填入 TokenAggregator 地址
};

async function main() {
  const [signer] = await hre.ethers.getSigners();
  console.log("👛 测试钱包:", signer.address);
  console.log("ETH 余额:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(signer.address)));
  console.log("");

  // 可交互式传入地址，或直接填上面的 CONFIG
  const aggregatorAddr = CONTRACTS.aggregator || process.env.AGGREGATOR;
  const testTokenAddr = CONTRACTS.testToken || process.env.TEST_TOKEN;

  if (!aggregatorAddr || !testTokenAddr) {
    console.log("请先设置 CONTRACTS 对象中的地址，或设置环境变量 AGGREGATOR / TEST_TOKEN");
    console.log("运行方式:");
    console.log("  $env:AGGREGATOR='0x...'; $env:TEST_TOKEN='0x...'; npx hardhat run scripts/test-aggregator.js --network sepolia");
    return;
  }

  const aggregator = await hre.ethers.getContractAt("TokenAggregator", aggregatorAddr);

  // 直接使用 ERC20 ABI 避免多个 IERC20 接口的歧义
  const erc20Abi = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)",
    "function transfer(address, uint256) returns (bool)",
    "function decimals() view returns (uint8)",
  ];
  const testToken = new hre.ethers.Contract(testTokenAddr, erc20Abi, signer);

  // ===== 1. 查看所有报价 =====
  console.log("=== 1. 查询所有 DEX 报价 ===");
  const adapterCount = await aggregator.adapterCount();
  console.log("已注册适配器数量:", adapterCount.toString());

  const testAmount = hre.ethers.parseEther("0.01"); // 0.01 ETH
  const quotes = await aggregator.getAllQuotes(
    hre.ethers.ZeroAddress,
    testTokenAddr,
    testAmount
  );
  const adapterAbi = ["function name() view returns (string)"];
  console.log("报价排序结果 (ETH → Token, 0.01 ETH):");
  for (let i = 0; i < quotes.length; i++) {
    const adapter = new hre.ethers.Contract(quotes[i].adapter, adapterAbi, signer);
    const name = await adapter.name();
    console.log(`  ${i + 1}. ${name} (${quotes[i].adapter}): ${hre.ethers.formatEther(quotes[i].amountOut)} tokens`);
  }

  // ===== 2. 最优报价 =====
  console.log("\n=== 2. 获取最优报价 ===");
  const [bestAdapter, bestAmountOut] = await aggregator.getBestQuote(
    hre.ethers.ZeroAddress,
    testTokenAddr,
    testAmount
  );
  if (bestAdapter !== hre.ethers.ZeroAddress) {
    const adapter = new hre.ethers.Contract(bestAdapter, adapterAbi, signer);
    const adapterName = await adapter.name();
    console.log("最优:", adapterName, "→", hre.ethers.formatEther(bestAmountOut), "tokens");
  }

  // ===== 3. 执行单 DEX 兑换 =====
  console.log("\n=== 3. 执行单 DEX 兑换 (ETH → Token) ===");
  const swapAmount = hre.ethers.parseEther("0.005"); // 0.005 ETH
  const minOut = hre.ethers.parseEther("1"); // 最小 1 token（宽松滑点）

  const tokBefore = await testToken.balanceOf(signer.address);
  console.log("兑换前 Token 余额:", hre.ethers.formatEther(tokBefore));

  const tx = await aggregator.swap(
    hre.ethers.ZeroAddress,  // ETH
    testTokenAddr,            // Token
    swapAmount,
    minOut,
    { value: swapAmount }
  );
  const receipt = await tx.wait();
  console.log("Gas 消耗:", receipt.gasUsed.toString());

  const tokAfter = await testToken.balanceOf(signer.address);
  const diff = tokAfter - tokBefore;
  console.log("兑换后 Token 余额:", hre.ethers.formatEther(tokAfter));
  console.log("实际获得:", hre.ethers.formatEther(diff), "tokens");

  // ===== 4. 测试拆分兑换 =====
  console.log("\n=== 4. 测试拆分兑换 (ETH → Token, 拆分到 2 个 DEX) ===");
  if (Number(adapterCount) >= 2) {
    const splitAmount = hre.ethers.parseEther("0.01");
    const splitMinOut = hre.ethers.parseEther("1");

    const tokBefore2 = await testToken.balanceOf(signer.address);
    const tx2 = await aggregator.splitSwap(
      hre.ethers.ZeroAddress,
      testTokenAddr,
      splitAmount,
      splitMinOut,
      2,  // 拆分到最优 2 个 DEX
      { value: splitAmount }
    );
    const receipt2 = await tx2.wait();
    console.log("Gas 消耗:", receipt2.gasUsed.toString());

    const tokAfter2 = await testToken.balanceOf(signer.address);
    const diff2 = tokAfter2 - tokBefore2;
    console.log("拆分兑换获得:", hre.ethers.formatEther(diff2), "tokens");
  } else {
    console.log("跳过（只有 1 个适配器，需要 ≥2 个才能拆分）");
  }

  console.log("\n✅ 所有测试完成！");
}

main().catch(console.error);
