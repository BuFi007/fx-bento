import { encodeAbiParameters, keccak256, parseAbiParameters, type Address, type Hex } from "viem";

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type RoomConfig = {
  poolKey: PoolKey;
  entryToken: Address;
  entryFee: bigint;
  minPlayers: number;
  maxPlayers: number;
  rounds: number;
  roundDuration: number;
  lockBuffer: number;
  startTime: bigint;
  rakeBps: number;
  payoutBps: number[];
  gridConfigHash: Hex;
  isPrivate: boolean;
  inviteCodeHash: Hex;
};

export type TileSelection = {
  rows: number[];
  cols: number[];
  chipCount: number;
  clientStateHash: Hex;
};

export const FX_BENTO_COPY = {
  protocol: "FX² Arcade Protocol",
  game: "FX Bento",
  frontendMode: "FX Bento Arcade",
  cta: "Play FX Bento",
  lobby: "Join kawaii FX prediction rooms. Same chips. Same market. Highest score wins."
} as const;

export function poolId(poolKey: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"), [
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks
    ])
  );
}

export function selectedTilesHash(selection: TileSelection): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint8[],uint8[],uint8,bytes32"), [
      selection.rows,
      selection.cols,
      selection.chipCount,
      selection.clientStateHash
    ])
  );
}

export function commitmentHash(args: {
  chainId: bigint;
  roomId: bigint;
  roundIndex: number;
  player: Address;
  selectedTilesHash: Hex;
  nonce: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256,uint256,uint16,address,bytes32,bytes32"), [
      args.chainId,
      args.roomId,
      args.roundIndex,
      args.player,
      args.selectedTilesHash,
      args.nonce
    ])
  );
}

export function validateAntiWall(selection: TileSelection, maxRows = 5, maxCols = 8): string | null {
  const n = selection.rows.length;
  if (n === 0 || n !== selection.cols.length || n > 5 || selection.chipCount !== n) return "Pick 1-5 tiles.";
  const seen = new Set<string>();
  const rowCounts = new Array(maxRows).fill(0);
  const colCounts = new Array(maxCols).fill(0);
  const occupied = Array.from({ length: maxRows }, () => new Array(maxCols).fill(false));

  for (let i = 0; i < n; i++) {
    const row = selection.rows[i] ?? -1;
    const col = selection.cols[i] ?? -1;
    const key = `${row}:${col}`;
    if (row < 0 || row >= maxRows || col < 0 || col >= maxCols || seen.has(key)) return "Tile is outside the board.";
    seen.add(key);
    occupied[row][col] = true;
    rowCounts[row] += 1;
    colCounts[col] += 1;
    if (rowCounts[row] > 2) return "No more than two tiles per row.";
  }

  for (let row = 0; row < maxRows; row++) {
    let chain = 0;
    for (let col = 0; col < maxCols; col++) {
      chain = occupied[row][col] ? chain + 1 : 0;
      if (chain > 2) return "No horizontal walls.";
    }
  }
  if (rowCounts.some((count) => count === maxCols) || colCounts.some((count) => count === maxRows)) return "No full row or column walls.";
  return null;
}
