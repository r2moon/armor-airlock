const Ganache = require('./helpers/ganache');
const deployUniswap = require('./helpers/deployUniswap');
const { expectRevert, constants } = require('@openzeppelin/test-helpers');

const Airlock = artifacts.require('Airlock');
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair');
const MockERC20 = artifacts.require('MockERC20');
const MockRewardPool = artifacts.require('MockRewardPool');

contract('airlock', function (accounts) {
  const ganache = new Ganache(web3);
  afterEach('revert', ganache.revert);

  const bn = (input) => web3.utils.toBN(input);
  const assertBNequal = (bnOne, bnTwo) =>
    assert.equal(bnOne.toString(), bnTwo.toString());

  const OWNER = accounts[0];
  const NOT_OWNER = accounts[1];
  const baseUnit = bn('1000000000000000000');

  let wethPair;
  let uniswapFactory;
  let uniswapRouter;

  let armorToken;
  let airlock;
  let rewardPool;

  const lockPeriod = 77760000; // 90 days
  const vestingPeriod = 77760000; // 90 days

  const initalWethLp = '50000000000000000000'; // 50 ETH
  const initalArmorLp = '10000000000000000000000'; // 10000 ARMOR

  beforeEach('setup contracts', async function () {
    const contracts = await deployUniswap(accounts);
    uniswapFactory = contracts.uniswapFactory;
    uniswapRouter = contracts.uniswapRouter;
    weth = contracts.weth;

    armorToken = await MockERC20.new(
      'ARMOR',
      'ARMOR',
      18,
      '1000000000000000000000000',
    );

    // await armorToken.createUniswapPair();

    await armorToken.approve(uniswapRouter.address, initalArmorLp);
    await uniswapRouter.addLiquidityETH(
      armorToken.address,
      initalArmorLp,
      0,
      0,
      OWNER,
      7777777777,
      { value: initalWethLp },
    );

    wethPair = await IUniswapV2Pair.at(
      await uniswapFactory.getPair(weth.address, armorToken.address),
    );

    airlock = await Airlock.new(
      armorToken.address,
      uniswapRouter.address,
      lockPeriod,
      vestingPeriod,
    );

    rewardPool = await MockRewardPool.new(wethPair.address, armorToken.address);
    await ganache.snapshot();
  });

  describe('Check init configuration', async () => {
    it('check ARMOR', async () => {
      assert.equal(await airlock.ARMOR(), armorToken.address);
    });

    it('check uniswap router', async () => {
      assert.equal(await airlock.uniswapRouter(), uniswapRouter.address);
    });

    it('check weth', async () => {
      assert.equal(await airlock.WETH(), weth.address);
    });

    it('check lockPeriod', async () => {
      assert.equal(await airlock.lockPeriod(), lockPeriod);
    });

    it('check vestingPeriod', async () => {
      assert.equal(await airlock.vestingPeriod(), vestingPeriod);
    });
  });

  describe('addToken', async () => {
    it('Revert if sender is not owner', async () => {
      await expectRevert(
        airlock.addToken(weth.address, rewardPool.address, { from: NOT_OWNER }),
        'Ownable: caller is not the owner',
      );
    });

    it('Revert if pair does not exist', async () => {
      const tempToken = await MockERC20.new('Temp', 'TEMP', 18, '100000');
      await expectRevert(
        airlock.addToken(tempToken.address, rewardPool.address),
        'Airlock: pair does not exist',
      );
    });

    it('Revert if reward pool is zero', async () => {
      await expectRevert(
        airlock.addToken(weth.address, constants.ZERO_ADDRESS),
        'Airlock: reward cannot be zero',
      );
    });

    it('should add token by owner', async () => {
      await airlock.addToken(weth.address, rewardPool.address);
    });
  });
});
