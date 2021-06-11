pragma solidity ^0.7.1;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

contract MockRewardPool {
    using SafeERC20 for IERC20;

    IERC20 public stakeToken;
    IERC20 public rewardToken;

    constructor(IERC20 _stakeToken, IERC20 _rewardToken) {
        stakeToken = _stakeToken;
        rewardToken = _rewardToken;
    }

    function stake(uint256 amount) external {
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256 amount) external {
        stakeToken.safeTransfer(msg.sender, amount);
    }

    function getReward() external {
        uint256 rewardBalance = rewardToken.balanceOf(address(this));
        rewardToken.safeTransfer(msg.sender, rewardBalance);
    }
}
