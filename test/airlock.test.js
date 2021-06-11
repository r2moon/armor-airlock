const Ganache = require('./helpers/ganache');
const deployUniswap = require('./helpers/deployUniswap');
const {
  expectRevert,
  constants,
  time,
  BN,
} = require('@openzeppelin/test-helpers');

const Airlock = artifacts.require('Airlock');
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair');
const MockERC20 = artifacts.require('MockERC20');
const MockRewardPool = artifacts.require('MockRewardPool');

contract('airlock', function (accounts) {
  const ganache = new Ganache(web3);
  afterEach('revert', ganache.revert);

  const OWNER = accounts[0];
  const NOT_OWNER = accounts[1];
  const beneficiary = accounts[2];
  const ethUnit = new BN('1000000000000000000');
  const btcUnit = new BN('100000000');
  const armorUnit = new BN('1000000000000000000');

  let uniswapFactory;
  let uniswapRouter;

  let armorToken;
  let airlock;
  let wethRewardPool;
  let wbtcRewardPool;

  let weth;
  let wbtc;
  let wethPair;
  let wbtcPair;

  const lockPeriod = new BN('77760000'); // 90 days
  const vestingPeriod = new BN('77760000'); // 90 days

  const initalWethLp = new BN('50').mul(ethUnit); // 50 ETH
  const initalArmorLpForWeth = new BN('10000').mul(armorUnit); // 10000 ARMOR
  const initalWbtcLp = new BN('10').mul(btcUnit); // 10 WBTC
  const initalArmorLpForWbtc = new BN('100000').mul(armorUnit); // 100000 ARMOR
  const armorInAirlock = new BN('10000000').mul(armorUnit); // 10000000 ARMOR

  beforeEach(async function () {
    const contracts = await deployUniswap(accounts);
    uniswapFactory = contracts.uniswapFactory;
    uniswapRouter = contracts.uniswapRouter;
    weth = contracts.weth;

    armorToken = await MockERC20.new(
      'ARMOR',
      'ARMOR',
      18,
      new BN('1000000000').mul(armorUnit),
    );
    wbtc = await MockERC20.new('WBTC', 'WBTC', 9, new BN('10000').mul(btcUnit));
    await weth.deposit({
      value: new BN('200').mul(ethUnit),
      from: accounts[5],
    });
    await weth.transfer(OWNER, new BN('200').mul(ethUnit), {
      from: accounts[5],
    });
    await armorToken.approve(uniswapRouter.address, initalArmorLpForWeth);
    await uniswapRouter.addLiquidityETH(
      armorToken.address,
      initalArmorLpForWeth,
      0,
      0,
      OWNER,
      7777777777,
      { value: initalWethLp },
    );

    await armorToken.approve(uniswapRouter.address, initalArmorLpForWbtc);
    await wbtc.approve(uniswapRouter.address, initalWbtcLp);
    await uniswapRouter.addLiquidity(
      wbtc.address,
      armorToken.address,
      initalWbtcLp,
      initalArmorLpForWbtc,
      0,
      0,
      OWNER,
      7777777777,
    );

    wethPair = await IUniswapV2Pair.at(
      await uniswapFactory.getPair(weth.address, armorToken.address),
    );

    wbtcPair = await IUniswapV2Pair.at(
      await uniswapFactory.getPair(wbtc.address, armorToken.address),
    );

    airlock = await Airlock.new(
      armorToken.address,
      uniswapRouter.address,
      lockPeriod,
      vestingPeriod,
    );

    wethRewardPool = await MockRewardPool.new(
      wethPair.address,
      armorToken.address,
    );
    wbtcRewardPool = await MockRewardPool.new(
      wbtcPair.address,
      armorToken.address,
    );
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
        airlock.addToken(weth.address, wethRewardPool.address, {
          from: NOT_OWNER,
        }),
        'Ownable: caller is not the owner',
      );
    });

    it('Revert if pair does not exist', async () => {
      const tempToken = await MockERC20.new('Temp', 'TEMP', 18, '100000');
      await expectRevert(
        airlock.addToken(tempToken.address, wethRewardPool.address),
        'Airlock: pair does not exist',
      );
    });

    it('Revert if reward pool is zero', async () => {
      await expectRevert(
        airlock.addToken(weth.address, constants.ZERO_ADDRESS),
        'Airlock: reward cannot be zero',
      );
    });

    it('Revert if reward pool is invalid', async () => {
      const tempToken = await MockERC20.new('Temp', 'TEMP', 18, '100000');
      const tempRewardPool = await MockRewardPool.new(
        tempToken.address,
        armorToken.address,
      );

      await expectRevert(
        airlock.addToken(weth.address, tempRewardPool.address),
        'Airlock: Invalid reward pool',
      );
    });

    it('should add token by owner', async () => {
      await airlock.addToken(weth.address, wethRewardPool.address);

      assert.equal(await airlock.pairs(weth.address), wethPair.address);
      const poolInfo = await airlock.rewardPools(wethPair.address);
      assert.equal(poolInfo.pool, wethRewardPool.address);
      assert.equal(poolInfo.lpStaked, '0');
      assert.equal(poolInfo.reward, '0');
      assert.equal(poolInfo.accArmorPerLp, '0');
    });
  });

  describe('deposit', async () => {
    beforeEach(async () => {
      await airlock.addToken(weth.address, wethRewardPool.address);
      await airlock.addToken(wbtc.address, wbtcRewardPool.address);
      await armorToken.transfer(airlock.address, armorInAirlock);
    });

    it('Revert if token is not added', async () => {
      const tempToken = await MockERC20.new('Temp', 'TEMP', 18, '100000');
      await expectRevert(
        airlock.deposit(beneficiary, tempToken.address, '10000'),
        'Airlock: Pair is not registered',
      );
    });

    it('Revert if token is not weth and have msg.value', async () => {
      await expectRevert(
        airlock.deposit(beneficiary, wbtc.address, '10000', { value: '10000' }),
        'Airlock: must be WETH',
      );
    });

    it('Revert if amount is different from msg.value', async () => {
      await expectRevert(
        airlock.deposit(beneficiary, weth.address, '100000', {
          value: '10000',
        }),
        'Airlock: invalid amount',
      );
    });

    it('Revert if amount is zero', async () => {
      await expectRevert(
        airlock.deposit(beneficiary, weth.address, '0'),
        'Airlock: amount must be greater than zero',
      );
      await expectRevert(
        airlock.deposit(beneficiary, wbtc.address, '0'),
        'Airlock: amount must be greater than zero',
      );
    });

    it('Revert if no enough ARMOR in airlock contract', async () => {
      await airlock.flushToTreasury(armorInAirlock, accounts[7]);
      await expectRevert(
        airlock.deposit(beneficiary, weth.address, '1000', {
          value: '1000',
        }),
        'Airlock: insufficient ARMOR in AirLock',
      );
    });

    it('deposit eth', async () => {
      const depositAmount = new BN('10').mul(ethUnit);
      const wethBalanceBefore = new BN(await weth.balanceOf(OWNER));
      await airlock.deposit(beneficiary, weth.address, depositAmount, {
        value: depositAmount,
      });
      const currentTime = new BN(await time.latest());

      assert.equal(wethBalanceBefore.toString(), await weth.balanceOf(OWNER));
      let requiredArmorAmount = depositAmount
        .mul(initalArmorLpForWeth)
        .div(initalWethLp);
      assert.equal(
        armorInAirlock.sub(requiredArmorAmount).toString(),
        await armorToken.balanceOf(airlock.address),
      );
      assert.equal(
        initalWethLp.add(depositAmount).toString(),
        (await weth.balanceOf(wethPair.address)).toString(),
      );
      assert.equal(
        initalArmorLpForWeth.add(requiredArmorAmount).toString(),
        (await armorToken.balanceOf(wethPair.address)).toString(),
      );
      let liquidityCreated = new BN(await wethPair.totalSupply())
        .mul(depositAmount)
        .div(initalWethLp.add(depositAmount));
      assert.equal(
        liquidityCreated.toString(),
        (await wethPair.balanceOf(wethRewardPool.address)).toString(),
      );
      assert.equal(await airlock.lockedLPLength(beneficiary), 1);
      let lpBatch = await airlock.lockedLP(beneficiary, 0);
      assert.equal(lpBatch.holder, beneficiary);
      assert.equal(lpBatch.pair, wethPair.address);
      assert.equal(lpBatch.amount.toString(), liquidityCreated.toString());
      assert.equal(lpBatch.claimedAmount, 0);
      assert.equal(lpBatch.rewardDebt, 0);
      assert.equal(
        lpBatch.maturity.toString(),
        currentTime.add(lockPeriod).toString(),
      );

      let poolInfo = await airlock.rewardPools(wethPair.address);
      assert.equal(poolInfo.pool, wethRewardPool.address);
      assert.equal(poolInfo.lpStaked.toString(), liquidityCreated.toString());
      assert.equal(poolInfo.reward, 0);
      assert.equal(poolInfo.accArmorPerLp, 0);
    });
  });
});
