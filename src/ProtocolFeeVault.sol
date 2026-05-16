// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, ReentrancyGuard} from "./libraries/Guards.sol";
import {IERC20, SafeERC20} from "./libraries/MinimalTokens.sol";

contract ProtocolFeeVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public treasury;

    event TreasuryUpdated(address indexed treasury);
    event FeeReceived(address indexed token, uint256 indexed roomId, uint256 amount);
    event FeeSwept(address indexed token, address indexed treasury, uint256 amount);

    constructor(address owner_, address treasury_) Ownable(owner_) {
        require(treasury_ != address(0), "ZERO_TREASURY");
        treasury = treasury_;
    }

    function setTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "ZERO_TREASURY");
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function notifyFee(address token, uint256 roomId, uint256 amount) external {
        emit FeeReceived(token, roomId, amount);
    }

    function sweep(address token) external nonReentrant {
        uint256 amount = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(treasury, amount);
        emit FeeSwept(token, treasury, amount);
    }
}
