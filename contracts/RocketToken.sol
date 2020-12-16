// SPDX-License-Identifier: MIT

pragma solidity ^0.7.1;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract RocketToken is IERC20, Ownable {
    using SafeMath for uint;

    struct FeeConfig {
        uint16 fee; //percentage expressed as number between 0 and 1000
        address destination;
    }

    FeeConfig config;
    uint256 _totalSupply;
    mapping(address => uint256) balances;
    mapping(address => mapping(address => uint256)) allowances;

    string public name = "ROCK3T 3t.finance";
    string public symbol = "R3T";

    function decimals() external view returns (uint8) {
        return 18;
    }
    constructor(uint16 fee, address destination) {
        _totalSupply = 11e6;
        balances[msg.sender] = _totalSupply;
        config.fee = fee;
        config.destination = destination;
    }

    function configureFee(uint16 fee, address destination) public onlyOwner {
        config.fee = fee;
        config.destination = destination;
    }

    function totalSupply() external override view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account)
        external
        override
        view
        returns (uint256)
    {
        return balances[account];
    }

    function transfer(address recipient, uint256 amount)
        external
        override
        returns (bool)
    {
        _transfer(msg.sender, recipient, amount);
    }

    function allowance(address owner, address spender)
        external
        override
        view
        returns (uint256)
    {
        return allowances[owner][spender];
    }

    function approve(address spender, uint256 amount)
        external
        override
        returns (bool)
    {
        allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external override returns (bool) {
        require(
            allowances[sender][recipient] >= amount,
            "ERC20: not approved to send"
        );
        _transfer(sender, recipient, amount);
        return true;
    }

    function burn(uint256 amount) public {
        balances[msg.sender] = balances[msg.sender].sub(amount);
        _totalSupply = _totalSupply.sub(amount);
    }

    function _transfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal returns (bool) {
        uint fee = (config.fee * amount).div(1000);

        if(config.destination!=address(0))
            balances[config.destination] = balances[config.destination] +fee;
        else 
            fee = 0;

        balances[recipient] = balances[recipient].add(amount - fee);
        balances[sender] = balances[sender].sub(amount);
        emit Transfer(sender, recipient, amount);
    }
}