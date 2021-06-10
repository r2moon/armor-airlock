pragma solidity ^0.7.1;

interface IRewardPool {
    function stake(uint256 amount) external;

    function withdraw(uint256 amount) external;

    function getReward() external;
}
