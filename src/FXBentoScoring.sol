// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TileSelection} from "./libraries/FXBentoTypes.sol";

library FXBentoScoring {
    uint256 internal constant WAD = 1e18;

    error InvalidTilePattern();

    function validateAntiWall(TileSelection memory selection, uint8 maxRows, uint8 maxCols)
        internal
        pure
        returns (bool)
    {
        uint256 n = selection.rows.length;
        if (n == 0 || n != selection.cols.length || n > 5 || selection.chipCount != n) return false;

        uint8[] memory rowCounts = new uint8[](maxRows);
        uint8[] memory colCounts = new uint8[](maxCols);
        bool[][] memory occupied = new bool[][](maxRows);
        for (uint256 r; r < maxRows; r++) {
            occupied[r] = new bool[](maxCols);
        }

        for (uint256 i; i < n; i++) {
            uint8 row = selection.rows[i];
            uint8 col = selection.cols[i];
            if (row >= maxRows || col >= maxCols || occupied[row][col]) return false;
            occupied[row][col] = true;
            rowCounts[row]++;
            colCounts[col]++;
            if (rowCounts[row] > 2) return false;
        }

        for (uint256 r; r < maxRows; r++) {
            if (rowCounts[r] == maxCols) return false;
            uint8 chain;
            for (uint256 c; c < maxCols; c++) {
                chain = occupied[r][c] ? chain + 1 : 0;
                if (chain > 2) return false;
            }
        }

        for (uint256 c; c < maxCols; c++) {
            if (colCounts[c] == maxRows) return false;
        }

        return true;
    }

    function scoreHit(uint256 tileDifficultyScore, uint8 selectedTileCount) internal pure returns (uint256) {
        if (selectedTileCount == 0 || selectedTileCount > 5) revert InvalidTilePattern();
        uint256 denominator = selectedTileCount == 1
            ? WAD
            : selectedTileCount == 2
                ? 1804000000000000000
                : selectedTileCount == 3
                    ? 2544000000000000000
                    : selectedTileCount == 4 ? 3249000000000000000 : 3929000000000000000;
        return tileDifficultyScore * WAD / denominator;
    }

    function scoreSelection(
        TileSelection memory selection,
        uint8 hitIndex,
        uint256 tileDifficultyScore,
        uint8 maxRows,
        uint8 maxCols
    ) internal pure returns (uint256) {
        if (!validateAntiWall(selection, maxRows, maxCols)) revert InvalidTilePattern();
        if (hitIndex >= selection.rows.length) return 0;
        return scoreHit(tileDifficultyScore, uint8(selection.rows.length));
    }
}
