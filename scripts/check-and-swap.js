const hre = require("hardhat");

const PM = "0x1238536071E1c677A632429e3655c799b22cDA52";
const TOKEN = "0x41527818650c40ff3B3A9bc63160706a9d0EE797";
const WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const POOL = "0x900eB2b8E49475e16aa66447AA53017FcE3aBCD2";

async function main() {
  const [s] = await hre.ethers.getSigners();
  console.log("钱包:", s.address);

  // 查 allowances
  const token = await hre.ethers.getContractAt([
    "function allowance(address,address) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)"
  ], TOKEN);
  const weth = await hre.ethers.getContractAt([
    "function allowance(address,address) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)"
  ], WETH);

  console.log("MTK allowance for PM:", (await token.allowance(s.address, PM)).toString());
  console.log("WETH allowance for PM:", (await weth.allowance(s.address, PM)).toString());
  console.log("WETH balance:", hre.ethers.formatEther(await weth.balanceOf(s.address)));

  // 如果 allowance 不足，一次性设 MAX
  const MAX = hre.ethers.MaxUint256;
  if ((await token.allowance(s.address, PM)) < hre.ethers.parseEther("10000")) {
    console.log("设置 MTK allowance...");
    await (await token.approve(PM, MAX)).wait();
  }
  if ((await weth.allowance(s.address, PM)) < hre.ethers.parseEther("100")) {
    console.log("设置 WETH allowance...");
    await (await weth.approve(PM, MAX)).wait();
  }
  console.log("Allowance 已设置完毕");

  // 直接调 pool.mint
  const pool = await hre.ethers.getContractAt([
    "function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data) external returns (uint256 amount0, uint256 amount1)",
    "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)"
  ], POOL);

  const s0 = await pool.slot0();
  console.log("当前 tick:", s0[1]);

  // tick -115136 → price = 1.0001^(-115136) ≈ 0.00001
  // token0=MTK, token1=WETH, price=0.00001 WETH per MTK
  // 加流动性: tickLower=-120000, tickUpper=-110000 (围绕当前价格)

  const liqTx = await pool.mint(s.address, -120000, -110000, hre.ethers.parseEther("1000"), "0x");
  await liqTx.wait();
  console.log("流动性添加成功！");
}

main().catch(e => console.error("失败:", e.message?.slice(0,200)));
