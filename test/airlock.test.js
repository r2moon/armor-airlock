const {
  expectEvent,
  expectRevert,
  constants,
  time,
  BN,
} = require('@openzeppelin/test-helpers');

const Airlock = artifacts.require('Airlock');
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair');
const MockERC20 = artifacts.require('MockERC20');
const MockRewardPool = artifacts.require('MockRewardPool');
const UniswapFactory = artifacts.require('UniswapFactory');
const UniswapWETH = artifacts.require('UniswapWETH');
const UniswapRouter = artifacts.require('UniswapRouter');

contract('airlock', function (accounts) {
  const OWNER = accounts[0];
  const NOT_OWNER = accounts[1];
  const beneficiary = accounts[2];
  const ethUnit = new BN('1000000000000000000');
  const btcUnit = new BN('100000000');
  const armorUnit = new BN('1000000000000000000');
  const rewardMultiplier = new BN('1000000000000');

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

  const sendArmorReward = async (rewardPool, amount) => {
    await armorToken.transfer(rewardPool.address, amount);
  };

  beforeEach(async function () {
    uniswapFactory = await UniswapFactory.new(OWNER);
    weth = await UniswapWETH.new();
    uniswapRouter = await UniswapRouter.new(
      uniswapFactory.address,
      weth.address,
    );

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
      assert.equal(
        (await airlock.lockPeriod()).toString(),
        lockPeriod.toString(),
      );
    });

    it('check vestingPeriod', async () => {
      assert.equal(
        (await airlock.vestingPeriod()).toString(),
        vestingPeriod.toString(),
      );
    });

    it('check totalAllocation', async () => {
      assert.equal((await airlock.totalAllocation()).toString(), '0');
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
      const tx = await airlock.addToken(weth.address, wethRewardPool.address);

      assert.equal(await airlock.pairs(weth.address), wethPair.address);
      const poolInfo = await airlock.rewardPools(wethPair.address);
      assert.equal(poolInfo.pool, wethRewardPool.address);
      assert.equal(poolInfo.lpStaked, '0');
      assert.equal(poolInfo.reward, '0');
      assert.equal(poolInfo.accArmorPerLp, '0');

      expectEvent(tx, 'TokenAdded', {
        token: weth.address,
        pair: wethPair.address,
        rewardPool: wethRewardPool.address,
      });
    });
  });

  describe('increaseAllocation', async () => {
    it('Revert if sender is not owner', async () => {
      await expectRevert(
        airlock.increaseAllocation(accounts[1], '1000000000', {
          from: NOT_OWNER,
        }),
        'Ownable: caller is not the owner',
      );
    });

    it('Revert if user is zero', async () => {
      await expectRevert(
        airlock.increaseAllocation(constants.ZERO_ADDRESS, '1000000000'),
        'Airlock: User cannot be zero',
      );
    });

    it('should increase armor allocation', async () => {
      let amount1 = new BN('1000').mul(armorUnit);
      let amount2 = new BN('500').mul(armorUnit);
      let amount3 = new BN('800').mul(armorUnit);
      await armorToken.approve(
        airlock.address,
        amount1.add(amount2).add(amount3),
      );

      const armorBalanceBefore = new BN(await armorToken.balanceOf(OWNER));
      const tx = await airlock.increaseAllocation(accounts[1], amount1);

      assert.equal(
        (await armorToken.balanceOf(OWNER)).toString(),
        armorBalanceBefore.sub(amount1).toString(),
      );

      assert.equal(
        (await armorToken.balanceOf(airlock.address)).toString(),
        amount1.toString(),
      );
      assert.equal(
        (await airlock.allocation(accounts[1])).toString(),
        amount1.toString(),
      );
      assert.equal(
        (await airlock.totalAllocation()).toString(),
        amount1.toString(),
      );

      expectEvent(tx, 'ArmorAllocationIncreased', {
        user: accounts[1],
        amount: amount1.toString(),
      });

      await airlock.increaseAllocation(accounts[2], amount2);

      assert.equal(
        (await armorToken.balanceOf(airlock.address)).toString(),
        amount1.add(amount2).toString(),
      );
      assert.equal(
        (await airlock.allocation(accounts[2])).toString(),
        amount2.toString(),
      );
      assert.equal(
        (await airlock.totalAllocation()).toString(),
        amount1.add(amount2).toString(),
      );

      await airlock.increaseAllocation(accounts[1], amount3);

      assert.equal(
        (await armorToken.balanceOf(airlock.address)).toString(),
        amount1.add(amount2).add(amount3).toString(),
      );
      assert.equal(
        (await airlock.allocation(accounts[1])).toString(),
        amount1.add(amount3).toString(),
      );
      assert.equal(
        (await airlock.totalAllocation()).toString(),
        amount1.add(amount2).add(amount3).toString(),
      );
    });
  });

  describe('decreaseAllocation', async () => {
    it('Revert if sender is not owner', async () => {
      await expectRevert(
        airlock.decreaseAllocation(accounts[1], '1000000000', {
          from: NOT_OWNER,
        }),
        'Ownable: caller is not the owner',
      );
    });

    it('Revert if user is zero', async () => {
      await expectRevert(
        airlock.decreaseAllocation(constants.ZERO_ADDRESS, '1000000000'),
        'Airlock: User cannot be zero',
      );
    });

    it('should decrease armor allocation', async () => {
      let amount1 = new BN('1000').mul(armorUnit);
      let amount2 = new BN('500').mul(armorUnit);

      await armorToken.approve(airlock.address, amount1.add(amount2));
      await airlock.increaseAllocation(accounts[1], amount1);

      const armorBalanceBefore = new BN(await armorToken.balanceOf(OWNER));
      const tx = await airlock.decreaseAllocation(accounts[1], amount2);

      assert.equal(
        (await armorToken.balanceOf(OWNER)).toString(),
        armorBalanceBefore.add(amount2).toString(),
      );

      assert.equal(
        (await armorToken.balanceOf(airlock.address)).toString(),
        amount1.sub(amount2).toString(),
      );
      assert.equal(
        (await airlock.allocation(accounts[1])).toString(),
        amount1.sub(amount2).toString(),
      );
      assert.equal(
        (await airlock.totalAllocation()).toString(),
        amount1.sub(amount2).toString(),
      );

      expectEvent(tx, 'ArmorAllocationDecreased', {
        user: accounts[1],
        amount: amount2.toString(),
      });
    });
  });

  describe('deposit', async () => {
    let allocation = new BN('10000').mul(ethUnit);

    beforeEach(async () => {
      await airlock.addToken(weth.address, wethRewardPool.address);
      await airlock.addToken(wbtc.address, wbtcRewardPool.address);

      await wbtc.approve(airlock.address, constants.MAX_UINT256);
      await weth.approve(airlock.address, constants.MAX_UINT256);

      await armorToken.approve(airlock.address, allocation);
      await airlock.increaseAllocation(beneficiary, allocation);
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

    it('Revert if no enough allocation', async () => {
      await airlock.decreaseAllocation(beneficiary, allocation);
      await expectRevert(
        airlock.deposit(beneficiary, weth.address, '1000', {
          value: '1000',
        }),
        'Airlock: Not enough allocation',
      );
    });

    it('deposit eth through deposit function', async () => {
      const depositAmount = new BN('10').mul(ethUnit);
      const wethBalanceBefore = new BN(await weth.balanceOf(OWNER));
      const tx = await airlock.deposit(
        beneficiary,
        weth.address,
        depositAmount,
        {
          value: depositAmount,
        },
      );
      const currentTime = new BN(await time.latest());

      assert.equal(wethBalanceBefore.toString(), await weth.balanceOf(OWNER));
      let requiredArmorAmount = depositAmount
        .mul(initalArmorLpForWeth)
        .div(initalWethLp);
      assert.equal(
        allocation.sub(requiredArmorAmount).toString(),
        (await armorToken.balanceOf(airlock.address)).toString(),
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

      expectEvent(tx, 'LPQueued', {
        holder: beneficiary,
        pair: wethPair.address,
        lpAmount: liquidityCreated.toString(),
        tokenAmount: depositAmount.toString(),
        armorAmount: requiredArmorAmount.toString(),
        maturity: currentTime.add(lockPeriod).toString(),
      });
    });

    it('deposit weth', async () => {
      const depositAmount = new BN('10').mul(ethUnit);
      const wethBalanceBefore = new BN(await weth.balanceOf(OWNER));
      const tx = await airlock.deposit(
        beneficiary,
        weth.address,
        depositAmount,
      );
      const currentTime = new BN(await time.latest());

      assert.equal(
        wethBalanceBefore.sub(depositAmount).toString(),
        await weth.balanceOf(OWNER),
      );
      let requiredArmorAmount = depositAmount
        .mul(initalArmorLpForWeth)
        .div(initalWethLp);
      assert.equal(
        allocation.sub(requiredArmorAmount).toString(),
        (await armorToken.balanceOf(airlock.address)).toString(),
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

      expectEvent(tx, 'LPQueued', {
        holder: beneficiary,
        pair: wethPair.address,
        lpAmount: liquidityCreated.toString(),
        tokenAmount: depositAmount.toString(),
        armorAmount: requiredArmorAmount.toString(),
        maturity: currentTime.add(lockPeriod).toString(),
      });
    });

    it('deposit wbtc', async () => {
      const depositAmount = new BN('1').mul(btcUnit);
      const wbtcBalanceBefore = new BN(await wbtc.balanceOf(OWNER));
      const tx = await airlock.deposit(
        beneficiary,
        wbtc.address,
        depositAmount,
      );
      const currentTime = new BN(await time.latest());

      assert.equal(
        wbtcBalanceBefore.sub(depositAmount).toString(),
        await wbtc.balanceOf(OWNER),
      );
      let requiredArmorAmount = depositAmount
        .mul(initalArmorLpForWbtc)
        .div(initalWbtcLp);
      assert.equal(
        allocation.sub(requiredArmorAmount).toString(),
        (await armorToken.balanceOf(airlock.address)).toString(),
      );
      assert.equal(
        initalWbtcLp.add(depositAmount).toString(),
        (await wbtc.balanceOf(wbtcPair.address)).toString(),
      );
      assert.equal(
        initalArmorLpForWbtc.add(requiredArmorAmount).toString(),
        (await armorToken.balanceOf(wbtcPair.address)).toString(),
      );
      let liquidityCreated = new BN(await wbtcPair.totalSupply())
        .mul(depositAmount)
        .div(initalWbtcLp.add(depositAmount));
      assert.equal(
        liquidityCreated.toString(),
        (await wbtcPair.balanceOf(wbtcRewardPool.address)).toString(),
      );
      assert.equal(await airlock.lockedLPLength(beneficiary), 1);
      let lpBatch = await airlock.lockedLP(beneficiary, 0);
      assert.equal(lpBatch.holder, beneficiary);
      assert.equal(lpBatch.pair, wbtcPair.address);
      assert.equal(lpBatch.amount.toString(), liquidityCreated.toString());
      assert.equal(lpBatch.claimedAmount, 0);
      assert.equal(lpBatch.rewardDebt, 0);
      assert.equal(
        lpBatch.maturity.toString(),
        currentTime.add(lockPeriod).toString(),
      );

      let poolInfo = await airlock.rewardPools(wbtcPair.address);
      assert.equal(poolInfo.pool, wbtcRewardPool.address);
      assert.equal(poolInfo.lpStaked.toString(), liquidityCreated.toString());
      assert.equal(poolInfo.reward, 0);
      assert.equal(poolInfo.accArmorPerLp, 0);

      expectEvent(tx, 'LPQueued', {
        holder: beneficiary,
        pair: wbtcPair.address,
        lpAmount: liquidityCreated.toString(),
        tokenAmount: depositAmount.toString(),
        armorAmount: requiredArmorAmount.toString(),
        maturity: currentTime.add(lockPeriod).toString(),
      });
    });
  });

  describe('claimLP and armor reward', async () => {
    let allocation = new BN('10000').mul(ethUnit);

    beforeEach(async () => {
      await airlock.addToken(weth.address, wethRewardPool.address);

      await weth.approve(airlock.address, constants.MAX_UINT256);

      await armorToken.approve(airlock.address, allocation);
      await airlock.increaseAllocation(beneficiary, allocation);
    });

    it('Revert if id is greater than length', async () => {
      await expectRevert(
        airlock.claimArmorReward('1', { from: beneficiary }),
        'Airlock: nothing to claim.',
      );

      await expectRevert(
        airlock.claimLP('1', { from: beneficiary }),
        'Airlock: nothing to claim.',
      );
    });

    it('Revert to claimLP before maturity', async () => {
      const depositAmount = new BN('10').mul(ethUnit);
      await airlock.deposit(beneficiary, weth.address, depositAmount);

      await time.increase(lockPeriod.sub(new BN(5)).toString());
      await expectRevert(
        airlock.claimLP('0', { from: beneficiary }),
        'Airlock: LP still locked.',
      );
    });

    it('claimLP linerly', async () => {
      const depositAmount = new BN('10').mul(ethUnit);
      await airlock.deposit(beneficiary, weth.address, depositAmount);
      const currentTime = new BN(await time.latest());

      let liquidityCreated = new BN(await wethPair.totalSupply())
        .mul(depositAmount)
        .div(initalWethLp.add(depositAmount));

      let timeAfterLockPeriod = new BN('886400');
      await time.increase(lockPeriod.add(timeAfterLockPeriod).toString());
      let lpBalanceBefore = new BN(await wethPair.balanceOf(beneficiary));
      let claimableLP = liquidityCreated
        .mul(timeAfterLockPeriod)
        .div(vestingPeriod);

      let tx = await airlock.claimLP(0, { from: beneficiary });

      expectEvent(tx, 'LPClaimed', {
        holder: beneficiary,
        pair: wethPair.address,
        amount: claimableLP.toString(),
      });

      let lpBatch = await airlock.lockedLP(beneficiary, 0);
      assert.equal(lpBatch.holder, beneficiary);
      assert.equal(lpBatch.pair, wethPair.address);
      assert.equal(lpBatch.amount.toString(), liquidityCreated.toString());
      assert.equal(lpBatch.claimedAmount.toString(), claimableLP.toString());
      assert.equal(lpBatch.rewardDebt, 0);
      assert.equal(
        lpBatch.maturity.toString(),
        currentTime.add(lockPeriod).toString(),
      );

      let poolInfo = await airlock.rewardPools(wethPair.address);
      assert.equal(poolInfo.pool, wethRewardPool.address);
      assert.equal(
        poolInfo.lpStaked.toString(),
        liquidityCreated.sub(claimableLP).toString(),
      );
      assert.equal(poolInfo.reward, 0);
      assert.equal(poolInfo.accArmorPerLp, 0);

      let currentClaimedLP = claimableLP;

      let timeAlreadyPassed = timeAfterLockPeriod;
      timeAfterLockPeriod = new BN('1772800');
      await time.increase(timeAfterLockPeriod.toString());
      lpBalanceBefore = new BN(await wethPair.balanceOf(beneficiary));
      claimableLP = liquidityCreated
        .mul(timeAfterLockPeriod.add(timeAlreadyPassed))
        .div(vestingPeriod)
        .sub(currentClaimedLP);
      assert.equal(
        claimableLP.toString(),
        (await airlock.pendingLP(beneficiary, 0)).toString(),
      );
      tx = await airlock.claimLP(0, { from: beneficiary });

      assert.equal(
        lpBalanceBefore.add(claimableLP).toString(),
        (await wethPair.balanceOf(beneficiary)).toString(),
      );
      expectEvent(tx, 'LPClaimed', {
        holder: beneficiary,
        pair: wethPair.address,
        amount: claimableLP.toString(),
      });

      lpBatch = await airlock.lockedLP(beneficiary, 0);
      assert.equal(lpBatch.holder, beneficiary);
      assert.equal(lpBatch.pair, wethPair.address);
      assert.equal(lpBatch.amount.toString(), liquidityCreated.toString());
      assert.equal(
        lpBatch.claimedAmount.toString(),
        claimableLP.add(currentClaimedLP).toString(),
      );
      assert.equal(lpBatch.rewardDebt, 0);
      assert.equal(
        lpBatch.maturity.toString(),
        currentTime.add(lockPeriod).toString(),
      );

      poolInfo = await airlock.rewardPools(wethPair.address);
      assert.equal(poolInfo.pool, wethRewardPool.address);
      assert.equal(
        poolInfo.lpStaked.toString(),
        liquidityCreated.sub(claimableLP).sub(currentClaimedLP).toString(),
      );
      assert.equal(poolInfo.reward, 0);
      assert.equal(poolInfo.accArmorPerLp, 0);

      currentClaimedLP = currentClaimedLP.add(claimableLP);

      timeAlreadyPassed = timeAlreadyPassed.add(timeAfterLockPeriod);
      timeAfterLockPeriod = vestingPeriod.sub(timeAlreadyPassed);
      await time.increase(timeAfterLockPeriod.toString());
      lpBalanceBefore = new BN(await wethPair.balanceOf(beneficiary));
      claimableLP = liquidityCreated.sub(currentClaimedLP);
      assert.equal(
        claimableLP.toString(),
        (await airlock.pendingLP(beneficiary, 0)).toString(),
      );
      tx = await airlock.claimLP(0, { from: beneficiary });

      assert.equal(
        lpBalanceBefore.add(claimableLP).toString(),
        (await wethPair.balanceOf(beneficiary)).toString(),
      );
      expectEvent(tx, 'LPClaimed', {
        holder: beneficiary,
        pair: wethPair.address,
        amount: claimableLP.toString(),
      });

      lpBatch = await airlock.lockedLP(beneficiary, 0);
      assert.equal(lpBatch.holder, beneficiary);
      assert.equal(lpBatch.pair, wethPair.address);
      assert.equal(lpBatch.amount.toString(), liquidityCreated.toString());
      assert.equal(
        lpBatch.claimedAmount.toString(),
        liquidityCreated.toString(),
      );
      assert.equal(lpBatch.rewardDebt, 0);
      assert.equal(
        lpBatch.maturity.toString(),
        currentTime.add(lockPeriod).toString(),
      );

      poolInfo = await airlock.rewardPools(wethPair.address);
      assert.equal(poolInfo.pool, wethRewardPool.address);
      assert.equal(poolInfo.lpStaked.toString(), '0');
      assert.equal(poolInfo.reward, 0);
      assert.equal(poolInfo.accArmorPerLp, 0);
    });

    it('claim', async () => {
      const depositAmount = new BN('10').mul(ethUnit);
      await airlock.deposit(beneficiary, weth.address, depositAmount);
      await time.increase('10');

      // First reward claim
      let rewardAmount = new BN('100').mul(armorUnit);
      await sendArmorReward(wethRewardPool, rewardAmount);

      let armorBalanceBefore = new BN(await armorToken.balanceOf(beneficiary));
      let armorBalanceInAirLock = new BN(
        await armorToken.balanceOf(airlock.address),
      );

      let liquidityCreated = new BN(await wethPair.totalSupply())
        .mul(depositAmount)
        .div(initalWethLp.add(depositAmount));

      let accArmorPerLp = rewardAmount
        .mul(rewardMultiplier)
        .div(liquidityCreated);

      let rewardToClaim = accArmorPerLp
        .mul(liquidityCreated)
        .div(rewardMultiplier);

      assert.equal(
        rewardToClaim.toString(),
        (await airlock.pendingArmorReward(beneficiary, 0)).toString(),
      );

      let tx = await airlock.claimArmorReward(0, { from: beneficiary });

      expectEvent(tx, 'RewardClaimed', {
        holder: beneficiary,
        amount: rewardToClaim.toString(),
      });

      let remainingReward = rewardAmount.sub(rewardToClaim);
      let poolInfo = await airlock.rewardPools(wethPair.address);
      assert.equal(poolInfo.reward.toString(), remainingReward.toString());
      assert.equal(poolInfo.accArmorPerLp.toString(), accArmorPerLp.toString());

      assert.equal(
        armorBalanceInAirLock.add(rewardAmount).sub(rewardToClaim).toString(),
        (await armorToken.balanceOf(airlock.address)).toString(),
      );
      assert.equal(
        remainingReward.toString(),
        (await airlock.armorReward()).toString(),
      );
      assert.equal(
        armorBalanceBefore.add(rewardToClaim).toString(),
        (await armorToken.balanceOf(beneficiary)).toString(),
      );

      // Second reward claim
      await time.increase('10');

      rewardAmount = new BN('200').mul(armorUnit);
      await sendArmorReward(wethRewardPool, rewardAmount);

      armorBalanceBefore = new BN(await armorToken.balanceOf(beneficiary));
      armorBalanceInAirLock = new BN(
        await armorToken.balanceOf(airlock.address),
      );
      tx = await airlock.claimArmorReward(0, { from: beneficiary });

      accArmorPerLp = accArmorPerLp.add(
        rewardAmount.mul(rewardMultiplier).div(liquidityCreated),
      );

      rewardToClaim = accArmorPerLp
        .mul(liquidityCreated)
        .div(rewardMultiplier)
        .sub(rewardToClaim);

      expectEvent(tx, 'RewardClaimed', {
        holder: beneficiary,
        amount: rewardToClaim.toString(),
      });

      remainingReward = remainingReward.add(rewardAmount.sub(rewardToClaim));
      poolInfo = await airlock.rewardPools(wethPair.address);
      assert.equal(poolInfo.reward.toString(), remainingReward.toString());
      assert.equal(poolInfo.accArmorPerLp.toString(), accArmorPerLp.toString());

      assert.equal(
        armorBalanceInAirLock.add(rewardAmount).sub(rewardToClaim).toString(),
        (await armorToken.balanceOf(airlock.address)).toString(),
      );
      assert.equal(
        remainingReward.toString(),
        (await airlock.armorReward()).toString(),
      );
      assert.equal(
        armorBalanceBefore.add(rewardToClaim).toString(),
        (await armorToken.balanceOf(beneficiary)).toString(),
      );
    });
  });
});
