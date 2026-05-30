require("@nomicfoundation/hardhat-toolbox");

// 加载 .env 里的私钥
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    sepolia: {
      url: "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts: [PRIVATE_KEY],
    },
  },
  etherscan: {
    apiKey: {
      sepolia: ETHERSCAN_API_KEY,
    },
  },
};
