pragma solidity ^0.7.1;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IWETH.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "./interfaces/IRewardPool.sol";

contract Airlock is Ownable, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    mapping(address => LPbatch[]) public lockedLP;
    uint256 public lockPeriod;
    uint256 public vestingPeriod;
    address public immutable uniswapRouter;
    address public immutable WETH;
    address public immutable ARMOR;
    mapping(address => address) public pairs;
    mapping(address => LpPool) public rewardPools;
    mapping(address => uint256) public totalLpAmount;
    uint256 public armorReward;

    bool private locked;

    struct LPbatch {
        address holder;
        address pair;
        uint256 amount;
        uint256 claimedAmount;
        uint256 rewardDebt;
        uint256 maturity;
    }

    struct LpPool {
        address pool;
        uint256 lpStaked;
        uint256 reward;
        uint256 accArmorPerLp;
    }

    // a user can hold multiple locked LP batches
    event LPQueued(
        address indexed holder,
        address indexed pair,
        uint256 lpAmount,
        uint256 tokenAmount,
        uint256 armorAmount,
        uint256 maturity
    );

    event LPClaimed(
        address indexed holder,
        address indexed pair,
        uint256 amount
    );

    event RewardClaimed(address indexed holder, uint256 amount);

    constructor(
        address armor,
        address _uniswapRouter,
        uint256 _lockPeriod,
        uint256 _vestingPeriod
    ) {
        ARMOR = armor;
        uniswapRouter = _uniswapRouter;
        WETH = IUniswapV2Router02(_uniswapRouter).WETH();
        lockPeriod = _lockPeriod;
        vestingPeriod = _vestingPeriod;
    }

    function addToken(address token, address rewardPool) external onlyOwner {
        address pair =
            IUniswapV2Factory(IUniswapV2Router02(uniswapRouter).factory())
                .getPair(token, ARMOR);
        require(pair != address(0), "Airlock: pair does not exist");
        pairs[token] = pair;
        require(rewardPool != address(0), "Airlock: reward cannot be zero");
        require(
            IRewardPool(rewardPool).stakeToken() == pair,
            "Airlock: Invalid reward pool"
        );
        rewardPools[pair] = LpPool({
            pool: rewardPool,
            lpStaked: 0,
            reward: 0,
            accArmorPerLp: 0
        });
    }

    function flushToTreasury(uint256 amount, address treasury)
        external
        onlyOwner
    {
        require(treasury != address(0), "Airlock: treasury cannot be zero");
        uint256 balance = IERC20(ARMOR).balanceOf(address(this));
        require(
            balance.sub(armorReward) >= amount,
            "Airlock: insufficient ARMOR in AirLock"
        );
        IERC20(ARMOR).safeTransfer(treasury, amount);
    }

    function deposit(
        address beneficiary,
        address token,
        uint256 amount
    ) public payable nonReentrant {
        require(pairs[token] != address(0), "Airlock: Pair is not registered");
        require(msg.value == 0 || token == WETH, "Airlock: must be WETH");
        require(
            msg.value == 0 || msg.value == amount,
            "Airlock: invalid amount"
        );
        require(amount > 0, "Airlock: amount must be greater than zero");

        address pair = pairs[token];
        if (msg.value > 0) {
            IWETH(WETH).deposit{value: msg.value}();
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        (uint256 reserve1, uint256 reserve2, ) =
            IUniswapV2Pair(pair).getReserves();

        uint256 armorRequired;
        if (ARMOR < token) {
            armorRequired = IUniswapV2Router02(uniswapRouter).quote(
                amount,
                reserve2,
                reserve1
            );
        } else {
            armorRequired = IUniswapV2Router02(uniswapRouter).quote(
                amount,
                reserve1,
                reserve2
            );
        }

        uint256 balance = IERC20(ARMOR).balanceOf(address(this));
        require(
            balance.sub(armorReward) >= armorRequired,
            "Airlock: insufficient ARMOR in AirLock"
        );

        IERC20(token).safeTransfer(pair, amount);
        IERC20(ARMOR).safeTransfer(pair, armorRequired);

        uint256 liquidityCreated = IUniswapV2Pair(pair).mint(address(this));
        totalLpAmount[pair] = totalLpAmount[pair].add(liquidityCreated);
        uint256 maturity = block.timestamp.add(lockPeriod);

        uint256 id = lockedLP[beneficiary].length;
        lockedLP[beneficiary].push(
            LPbatch({
                holder: beneficiary,
                pair: pair,
                amount: liquidityCreated,
                claimedAmount: 0,
                rewardDebt: 0,
                maturity: maturity
            })
        );

        _stakeLp(pair, beneficiary, id);

        emit LPQueued(
            beneficiary,
            pair,
            liquidityCreated,
            amount,
            armorRequired,
            maturity
        );
    }

    receive() external payable {
        deposit(msg.sender, WETH, msg.value);
    }

    function claimLP(uint256 id) external {
        require(id < lockedLP[msg.sender].length, "Airlock: nothing to claim.");
        LPbatch storage batch = lockedLP[msg.sender][id];
        require(batch.maturity < block.timestamp, "Airlock: LP still locked.");

        uint256 amountToClaim =
            batch.amount.mul(block.timestamp.sub(batch.maturity)).div(
                vestingPeriod
            );
        require(
            batch.claimedAmount < amountToClaim,
            "Airlock: nothing to claim."
        );
        _updatePool(batch.pair);
        _claimArmorReward(msg.sender, id);
        uint256 availableLp = amountToClaim.sub(batch.claimedAmount);
        LpPool storage pool = rewardPools[batch.pair];
        IRewardPool(pool.pool).withdraw(availableLp);
        batch.claimedAmount = amountToClaim;
        pool.lpStaked = pool.lpStaked.sub(availableLp);
        batch.rewardDebt = pool
            .accArmorPerLp
            .mul(batch.amount.sub(batch.claimedAmount))
            .div(1e12);

        IERC20(batch.pair).safeTransfer(msg.sender, availableLp);
        emit LPClaimed(msg.sender, batch.pair, availableLp);
    }

    function claimArmorReward(uint256 id) external returns (bool) {
        require(id < lockedLP[msg.sender].length, "Airlock: nothing to claim.");
        _updatePool(lockedLP[msg.sender][id].pair);
        _claimArmorReward(msg.sender, id);
    }

    function lockedLPLength(address holder) external view returns (uint256) {
        return lockedLP[holder].length;
    }

    function _updatePool(address pair) internal {
        LpPool storage pool = rewardPools[pair];
        uint256 armorBalance = IERC20(ARMOR).balanceOf(address(this));
        IRewardPool(pool.pool).getReward();
        uint256 armorBalanceAfter = IERC20(ARMOR).balanceOf(address(this));
        uint256 reward = armorBalanceAfter.sub(armorBalance);
        if (pool.lpStaked > 0) {
            pool.accArmorPerLp = pool.accArmorPerLp.add(
                reward.mul(1e12).div(pool.lpStaked)
            );
        }
        pool.reward = pool.reward.add(reward);
        armorReward = armorReward.add(reward);
    }

    function _stakeLp(
        address pair,
        address holder,
        uint256 id
    ) internal {
        _updatePool(pair);
        LPbatch storage lpBatch = lockedLP[holder][id];
        LpPool storage pool = rewardPools[pair];
        IERC20(pair).safeApprove(pool.pool, 0);
        IERC20(pair).safeApprove(pool.pool, lpBatch.amount);
        IRewardPool(pool.pool).stake(lpBatch.amount);
        pool.lpStaked = pool.lpStaked.add(lpBatch.amount);
        lpBatch.rewardDebt = pool.accArmorPerLp.mul(lpBatch.amount).div(1e12);
    }

    function _claimArmorReward(address holder, uint256 id) internal {
        LPbatch storage lpBatch = lockedLP[holder][id];
        LpPool storage pool = rewardPools[lpBatch.pair];
        uint256 reward =
            lpBatch
                .amount
                .sub(lpBatch.claimedAmount)
                .mul(pool.accArmorPerLp)
                .div(1e12)
                .sub(lpBatch.rewardDebt);
        uint256 rewardToClaim = reward > pool.reward ? pool.reward : reward;
        if (rewardToClaim > 0) {
            IERC20(ARMOR).safeTransfer(holder, rewardToClaim);
            pool.reward = pool.reward.sub(rewardToClaim);
            lpBatch.rewardDebt = pool
                .accArmorPerLp
                .mul(lpBatch.amount.sub(lpBatch.claimedAmount))
                .div(1e12);
            armorReward = armorReward.sub(rewardToClaim);

            emit RewardClaimed(holder, rewardToClaim);
        }
    }
}
