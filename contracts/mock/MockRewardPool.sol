pragma solidity ^0.7.1;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockRewardPool {
    address stakingToken;
    address rewardToken;

    constructor(address _stakingToken, address _rewardToken) {
        stakingToken = _stakingToken;
        rewardToken = _rewardToken;
    }
}
