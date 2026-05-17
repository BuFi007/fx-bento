import { describe, expect, test } from "bun:test";
import { decodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import {
  ROOM_STATUS,
  commitmentHash,
  prepareApproveErc20Tx,
  prepareClaimPrizeTx,
  prepareCommitSelectionTx,
  prepareJoinRoomTx,
  prepareRefundTx,
  prepareRevealSelectionTx,
  roomFlowActions,
  selectedTilesHash,
  validateAntiWall,
  type FxBentoContracts,
  type TileSelection
} from "./index";

const contracts: FxBentoContracts = {
  roomFactory: "0x1000000000000000000000000000000000000001",
  roomEscrow: "0x1000000000000000000000000000000000000002",
  commitmentManager: "0x1000000000000000000000000000000000000003",
  settlementManager: "0x1000000000000000000000000000000000000004"
};

const erc20Abi = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]);
const roomEscrowAbi = parseAbi([
  "function joinRoom(uint256 roomId)",
  "function refund(uint256 roomId)",
  "function claimPrize(uint256 roomId,uint256 amount,bytes32[] proof)"
]);
const commitmentAbi = parseAbi([
  "function commitSelection(uint256 roomId,uint16 roundIndex,bytes32 commitment)",
  "function revealSelection(uint256 roomId,uint16 roundIndex,(uint8[] rows,uint8[] cols,uint8 chipCount,bytes32 clientStateHash) selection,bytes32 nonce)"
]);

describe("SDK transaction builders", () => {
  test("builds ERC20 approval calldata for the room escrow", () => {
    const token: Address = "0x2000000000000000000000000000000000000001";
    const tx = prepareApproveErc20Tx(token, { spender: contracts.roomEscrow, amount: 5_000_000n });
    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });

    expect(tx.to).toBe(token);
    expect(tx.value).toBeUndefined();
    expect(decoded.functionName).toBe("approve");
    expect(decoded.args).toEqual([contracts.roomEscrow, 5_000_000n]);
  });

  test("builds escrow join, refund, and claim calldata", () => {
    const proof: Hex[] = ["0x1111111111111111111111111111111111111111111111111111111111111111"];

    expect(decodeFunctionData({ abi: roomEscrowAbi, data: prepareJoinRoomTx(contracts, 7n).data })).toEqual({
      functionName: "joinRoom",
      args: [7n]
    });
    expect(decodeFunctionData({ abi: roomEscrowAbi, data: prepareRefundTx(contracts, 7n).data })).toEqual({
      functionName: "refund",
      args: [7n]
    });
    expect(decodeFunctionData({ abi: roomEscrowAbi, data: prepareClaimPrizeTx(contracts, { roomId: 7n, amount: 9_000_000n, proof }).data })).toEqual({
      functionName: "claimPrize",
      args: [7n, 9_000_000n, proof]
    });
  });

  test("builds commitment and reveal calldata from matching tile data", () => {
    const selection: TileSelection = {
      rows: [1, 2],
      cols: [4, 6],
      chipCount: 2,
      clientStateHash: "0x2222222222222222222222222222222222222222222222222222222222222222"
    };
    const nonce: Hex = "0x3333333333333333333333333333333333333333333333333333333333333333";
    const commitment = commitmentHash({
      chainId: 31337n,
      roomId: 7n,
      roundIndex: 0,
      player: "0x3000000000000000000000000000000000000001",
      selectedTilesHash: selectedTilesHash(selection),
      nonce
    });

    expect(decodeFunctionData({ abi: commitmentAbi, data: prepareCommitSelectionTx(contracts, { roomId: 7n, roundIndex: 0, commitment }).data })).toEqual({
      functionName: "commitSelection",
      args: [7n, 0, commitment]
    });
    expect(decodeFunctionData({ abi: commitmentAbi, data: prepareRevealSelectionTx(contracts, { roomId: 7n, roundIndex: 0, selection, nonce }).data })).toEqual({
      functionName: "revealSelection",
      args: [7n, 0, selection, nonce]
    });
  });
});

describe("SDK state helpers", () => {
  test("gates room actions by lifecycle state", () => {
    expect(roomFlowActions({ status: ROOM_STATUS.Lobby, startTime: 10n, minPlayers: 2, activePlayers: 1, rounds: 10, roundDuration: 60 }, 11n).canCancelFailedStart).toBe(true);
    expect(roomFlowActions({ status: ROOM_STATUS.Lobby, startTime: 10n, minPlayers: 2, activePlayers: 2, rounds: 10, roundDuration: 60 }, 11n).canLock).toBe(true);
    expect(roomFlowActions({ status: ROOM_STATUS.Settled, startTime: 10n, minPlayers: 2, activePlayers: 2, rounds: 10, roundDuration: 60 }, 11n).canClaimPrize).toBe(true);
  });

  test("rejects wall and spam tile patterns", () => {
    expect(validateAntiWall({ rows: [1, 1, 1], cols: [0, 2, 4], chipCount: 3, clientStateHash: "0x0000000000000000000000000000000000000000000000000000000000000000" })).toBe("No more than two tiles per row.");
    expect(validateAntiWall({ rows: [1, 1, 1], cols: [0, 1, 2], chipCount: 3, clientStateHash: "0x0000000000000000000000000000000000000000000000000000000000000000" })).toBe("No more than two tiles per row.");
    expect(validateAntiWall({ rows: [1, 2], cols: [4, 6], chipCount: 2, clientStateHash: "0x0000000000000000000000000000000000000000000000000000000000000000" })).toBeNull();
  });
});
