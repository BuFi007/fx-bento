// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

abstract contract Ownable {
    error NotOwner();
    address public owner;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    constructor(address initialOwner) {
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZERO_OWNER");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}

abstract contract Pausable is Ownable {
    bool public paused;
    event Paused(bool paused);

    constructor(address initialOwner) Ownable(initialOwner) {}

    modifier whenNotPaused() {
        require(!paused, "PAUSED");
        _;
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit Paused(value);
    }
}

abstract contract ReentrancyGuard {
    uint256 private locked = 1;

    modifier nonReentrant() {
        require(locked == 1, "REENTRANT");
        locked = 2;
        _;
        locked = 1;
    }
}

abstract contract AccessManaged is Ownable {
    mapping(bytes32 => mapping(address => bool)) public hasRole;
    event RoleSet(bytes32 indexed role, address indexed account, bool allowed);

    constructor(address initialOwner) Ownable(initialOwner) {}

    modifier onlyRole(bytes32 role) {
        require(hasRole[role][msg.sender] || msg.sender == owner, "MISSING_ROLE");
        _;
    }

    function setRole(bytes32 role, address account, bool allowed) external onlyOwner {
        hasRole[role][account] = allowed;
        emit RoleSet(role, account, allowed);
    }
}
