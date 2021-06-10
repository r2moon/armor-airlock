pragma solidity ^0.7.1;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IWETH.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";

contract Airlock is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address public treasury;
    mapping(address => LPbatch[]) public lockedLP;
    uint256 public lockPeriod;
    uint256 public vestingPeriod;
    address public immutable uniswapRouter;
    address public immutable WETH;
    address public immutable ARMOR;
    mapping(address => address) public pairs;
    mapping(address => address) public rewardPools;

    bool private locked;

    struct LPbatch {
        address holder;
        address pair;
        uint256 amount;
        uint256 claimedAmount;
        uint256 maturity;
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

    constructor(
        address armor,
        address _uniswapRouter,
        uint256 _lockPeriod,
        uint256 _vestingPeriod,
        address _treasury
    ) {
        ARMOR = armor;
        uniswapRouter = _uniswapRouter;
        WETH = IUniswapV2Router02(_uniswapRouter).WETH();
        lockPeriod = _lockPeriod;
        vestingPeriod = _vestingPeriod;
        treasury = _treasury;
    }

    modifier lock {
        require(!locked, "ARMOR: reentrancy violation");
        locked = true;
        _;
        locked = false;
    }

    function addToken(address token, address rewardPool) external onlyOwner {
        address pair = IUniswapV2Factory(
            IUniswapV2Router02(uniswapRouter).factory()
        ).getPair(token, ARMOR);
        pairs[token] = pair;
        rewardPools[pair] = rewardPool;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function flushToTreasury(uint256 amount) external onlyOwner {
        require(treasury != address(0), "ARMOR: treasury not set");
        require(
            IERC20(ARMOR).transfer(treasury, amount),
            "Treasury transfer failed"
        );
    }

    // splits the amount of ETH according to a buy pressure formula, swaps the splitted fee,
    // and pools the remaining ETH with ARMOR to create LP tokens
    function deposit(
        address beneficiary,
        address token,
        uint256 amount
    ) public payable lock {
        require(pairs[token] != address(0), "ARMOR: Pair is not registered");
        require(msg.value == 0 || token == WETH, "ARMOR: must be WETH");
        require(msg.value == 0 || msg.value == amount, "ARMOR: invalid amount");
        require(amount > 0, "ARMOR: amount must be greater than zero");

        address pair = pairs[token];
        if (msg.value > 0) {
            IWETH(WETH).deposit{value: msg.value}();
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        (uint256 reserve1, uint256 reserve2, ) = IUniswapV2Pair(pair)
        .getReserves();

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
            balance >= armorRequired,
            "ARMOR: insufficient ARMOR in AirLock"
        );

        IERC20(token).safeTransfer(pair, amount);
        IERC20(ARMOR).safeTransfer(pair, armorRequired);

        uint256 liquidityCreated = IUniswapV2Pair(pair).mint(address(this));

        uint256 maturity = block.timestamp.add(lockPeriod);

        lockedLP[beneficiary].push(
            LPbatch({
                holder: beneficiary,
                pair: pair,
                amount: liquidityCreated,
                claimedAmount: 0,
                maturity: maturity
            })
        );

        emit LPQueued(
            beneficiary,
            pair,
            liquidityCreated,
            amount,
            armorRequired,
            maturity
        );
    }

    function receive() public payable {
        deposit(msg.sender, WETH, msg.value);
    }

    // claimps the oldest LP batch according to the lock period formula
    function claimLP(uint256 id) public returns (bool) {
        require(id < lockedLP[msg.sender].length, "ARMOR: nothing to claim.");
        LPbatch storage batch = lockedLP[msg.sender][id];
        require(batch.maturity < block.timestamp, "ARMOR: LP still locked.");

        uint256 amountToClaim = batch
        .amount
        .mul(block.timestamp.sub(batch.maturity))
        .div(vestingPeriod);
        require(
            batch.claimedAmount < amountToClaim,
            "ARMOR: nothing to claim."
        );
        uint256 availableLp = amountToClaim.sub(batch.claimedAmount);
        IERC20(batch.pair).safeTransfer(msg.sender, availableLp);
        batch.claimedAmount = amountToClaim;

        emit LPClaimed(msg.sender, batch.pair, availableLp);
    }

    function lockedLPLength(address holder) public view returns (uint256) {
        return lockedLP[holder].length;
    }
}
