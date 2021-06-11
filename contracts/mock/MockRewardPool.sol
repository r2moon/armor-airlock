pragma solidity ^0.7.1;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockRewardPool {
    address public stakeToken;
    address public rewardToken;

    constructor(address _stakeToken, address _rewardToken) {
        stakeToken = _stakeToken;
        rewardToken = _rewardToken;
    }
}
