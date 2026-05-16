// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockOracle {
    int256 public price;
    uint64 public updatedAt;

    event PriceUpdated(int256 price, uint64 updatedAt);

    function setPrice(int256 price_) external {
        price = price_;
        updatedAt = uint64(block.timestamp);
        emit PriceUpdated(price_, updatedAt);
    }

    function latestPrice() external view returns (int256, uint64) {
        return (price, updatedAt);
    }
}
