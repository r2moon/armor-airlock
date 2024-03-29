const HDWalletProvider = require('@truffle/hdwallet-provider');
require('dotenv').config();

const { PRIVATE_KEY_DEV, PRIVATE_KEY_PROD, INFURA_TOKEN, ETHERSCAN_API_KEY } =
  process.env;

module.exports = {
  /**
   * Networks define how you connect to your ethereum client and let you set the
   * defaults web3 uses to send transactions. If you don't specify one truffle
   * will spin up a development blockchain for you on port 9545 when you
   * run `develop` or `test`. You can ask a truffle command to use a specific
   * network from the command line, e.g
   *
   * $ truffle test --network <network-name>
   */

  networks: {
    development: {
      host: '127.0.0.1', // Localhost (default: none)
      port: 8545, // Standard Ethereum port (default: none)
      network_id: '*', // Any network (default: none)
      disableConfirmationListener: true,
    },

    kovan: {
      provider: () =>
        new HDWalletProvider(
          PRIVATE_KEY_DEV,
          `https://kovan.infura.io/v3/${INFURA_TOKEN}`,
        ),
      network_id: 42, // Kovan's id
      gas: '12100000',
      networkCheckTimeout: 100000,
      // gasLimit:'0x9999969101',
      confirmations: 1, // # of confs to wait between deployments. (default: 0)
      timeoutBlocks: 1, // # of blocks before a deployment times out  (minimum/default: 50)
      skipDryRun: true, // Skip dry run before migrations? (default: false for public nets )
    },

    mainnet: {
      provider: () =>
        new HDWalletProvider(
          PRIVATE_KEY_PROD,
          `https://mainnet.infura.io/v3/${INFURA_TOKEN}`,
        ),
      network_id: 1,
      gas: '5000000',
      gasPrice: '101000000000',
      confirmations: 1,
      timeoutBlocks: 1,
      skipDryRun: true, // Skip dry run before migrations? (default: false for public nets )
    },
  },
  // Configure your compilers
  compilers: {
    solc: {
      version: '0.7.1',
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
      },
    },
  },
  mocha: {
    enableTimeouts: false,
    before_timeout: 120000, // Here is 2min but can be whatever timeout is suitable for you.
  },
  plugins: ['truffle-plugin-verify'],

  api_keys: {
    etherscan: ETHERSCAN_API_KEY,
  },
};
