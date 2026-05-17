import { beforeEach, describe, expect, test } from "bun:test";

import {
  commitFxBentoSelection,
  createFxBentoRoom,
  joinFxBentoRoom,
  resetFxBentoRoomsForTests,
  revealFxBentoSelection,
  settleFxBentoRoom,
} from ".";

const alice = "0x00000000000000000000000000000000000000a1";
const bob = "0x00000000000000000000000000000000000000b2";
const commitment = `0x${"ab".repeat(32)}`;
const root = `0x${"cd".repeat(32)}`;

describe("FX Bento room state", () => {
  beforeEach(() => resetFxBentoRoomsForTests());

  test("activates room after min players join and accepts one commit per round", () => {
    const room = createFxBentoRoom({ marketId: "USDC/EURC", minPlayers: 2, maxPlayers: 4 });
    joinFxBentoRoom(room.id, { player: alice });
    const joined = joinFxBentoRoom(room.id, { player: bob });
    expect(joined.roomId).toBe(room.id);

    expect(commitFxBentoSelection(room.id, { player: alice, roundIndex: 0, commitment })).toMatchObject({
      accepted: true,
    });
    expect(() => commitFxBentoSelection(room.id, { player: alice, roundIndex: 0, commitment })).toThrow(
      "commitment_already_exists"
    );
  });

  test("rejects reveals without a matching commitment", () => {
    const room = createFxBentoRoom({ marketId: "USDC/EURC", minPlayers: 2, maxPlayers: 4 });
    joinFxBentoRoom(room.id, { player: alice });
    joinFxBentoRoom(room.id, { player: bob });
    expect(() =>
      revealFxBentoSelection(room.id, {
        player: alice,
        roundIndex: 0,
        rows: [1],
        cols: [1],
        nonce: commitment,
      })
    ).toThrow("missing_commitment");
  });

  test("prepares settlement only after enough players joined", () => {
    const room = createFxBentoRoom({ marketId: "USDC/EURC", minPlayers: 2, maxPlayers: 4 });
    expect(() => settleFxBentoRoom(room.id, { resultsRoot: root })).toThrow("min_players_not_met");
    joinFxBentoRoom(room.id, { player: alice });
    joinFxBentoRoom(room.id, { player: bob });
    expect(settleFxBentoRoom(room.id, { resultsRoot: root })).toMatchObject({
      roomId: room.id,
      status: "settling",
    });
  });
});
