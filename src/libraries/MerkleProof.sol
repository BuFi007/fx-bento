// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library MerkleProof {
    function verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i; i < proof.length; i++) {
            bytes32 p = proof[i];
            computed =
                computed <= p ? keccak256(abi.encodePacked(computed, p)) : keccak256(abi.encodePacked(p, computed));
        }
        return computed == root;
    }
}
