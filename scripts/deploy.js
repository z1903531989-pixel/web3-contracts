const hre = require("hardhat");

async function main() {
  console.log("正在部署 MyToken...");

  const MyToken = await hre.ethers.getContractFactory("MyToken");
  const token = await MyToken.deploy();
  await token.waitForDeployment();

  const address = await token.getAddress();
  console.log(`MyToken 已部署到: ${address}`);
  console.log("请在 Sepolia Etherscan 上查看: https://sepolia.etherscan.io/address/" + address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
