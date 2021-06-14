pragma solidity ^0.7.1;

interface IRewardPool {
    function stakeToken() external view returns (address);

    function stake(uint256 amount) external;

    function withdraw(uint256 amount) external;

    function getReward() external;

    function earned(address account) external view returns (uint256);
}
