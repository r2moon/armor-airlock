pragma solidity ^0.7.1;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        uint256 totalSupply
    ) ERC20(name, symbol) {
        _setupDecimals(decimals);
        _mint(msg.sender, totalSupply);
    }
}
