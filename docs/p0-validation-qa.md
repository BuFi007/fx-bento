# P0 Room-First Validation QA

This pass validates the room lifecycle from the player's point of view and maps every visible failure state to a contract-backed escape path.

## Contract-Aligned Flow Matrix

| Flow | Contract source of truth | Clean failure path | Coverage |
| --- | --- | --- | --- |
| Create room | `FXBentoRoomFactory.createRoom` | Invalid pool, token, rake, player limits, payout split, start time, or timing config reverts before a room id exists. | Unit tests for valid and invalid configs. |
| Join lobby | `FXBentoRoomEscrow.joinRoom` | Full rooms, non-lobby rooms, and duplicate joins revert. The backend must treat join intent as advisory until entry transfer lands. | Unit and invariant tests. |
| Leave lobby | `FXBentoRoomEscrow.leaveRoom` | Leaving after start reverts; lobby leave returns entry fee and frees the active seat. | Unit and invariant tests. |
| Failed start | `FXBentoRoomEscrow.cancelRoom` | Before `startTime` cancellation reverts. After `startTime`, only below-min rooms can cancel. | Unit tests. |
| Refund | `FXBentoRoomEscrow.refund` | Refunds only work after `Cancelled`; each paid active player can refund once. Refund clears active membership and decrements room escrow accounting. | Unit and invariant tests. |
| Lock/start | `FXBentoRoomEscrow.lockRoom` | Below-min rooms and early starts revert; locked rooms cannot return to lobby. | Unit and invariant tests. |
| Commit/reveal | `FXBentoCommitmentManager` | Only paid active players can commit/reveal while room is locked or settling; late commit, early reveal, mismatch, duplicate reveal, and invalid patterns revert. | Unit tests. |
| Round settle | `FXBentoRoundManager` | Missing, stale, overwritten, or wrong-time snapshots revert; all players resolve against the same stored anchor and settlement snapshots. | Unit tests. |
| Submit results | `FXBentoSettlementManager.submitResults` | Unended rounds, duplicate submissions, bad payout totals, bad rake, missing roots, and metadata mismatch revert. Locked rooms move to settling through escrow. | Unit tests. |
| Challenge | `FXBentoSettlementManager.challengeResults` | Empty, late, duplicate, or finalized challenges revert. Accepted challenges replace the typed payout payload; rejected challenges finalize original results. | Unit tests. |
| Rescue | `FXBentoSettlementManager.rescueFailedSettlement` | Early rescue and finalized rooms revert. Expired locked/settling rooms cancel and unlock refunds. | Unit tests. |
| Claim prize | `FXBentoRoomEscrow.claimPrize` | Claims before settlement, non-player claims, bad Merkle proofs, double claims, and over-total claims revert without mutating claim state. | Unit tests and invariants. |
| Claim protocol fee | `FXBentoRoomEscrow.claimProtocolFee` | Fee claim before settlement, double claim, or payout overflow reverts; fee is pull-based into `ProtocolFeeVault`. | Unit and invariant tests. |

## SDK / Backend Assumptions

- Room status values are numeric contract state: `0 Lobby`, `1 Locked`, `2 Settling`, `3 Settled`, `4 Cancelled`.
- Liveblocks and backend state are UX mirrors only. They must not grant money movement or settlement authority.
- A backend join intent does not mean the player is in the room. The player is active only after `RoomJoined` and while `joined == true && refunded == false`.
- The SDK `roomFlowActions` helper intentionally mirrors contract state gates for user-visible CTAs.
- Commit/reveal endpoints should relay typed user intent and reject requests when `canCommitOrReveal` is false from indexed onchain state.
- Claim and refund buttons should be driven by `Cancelled` and `Settled` states, not by backend room labels.

## Remaining Product Validation Gates

- Room-fill comprehension: players understand when a lobby cancels and how refunds are claimed.
- Score comprehension: players can explain tile difficulty, coverage penalty, hit/miss, and final rank.
- Settlement comprehension: players understand pending results, challenge state, finalization, and rescue refunds.
- Paid-readiness review: compliance language, jurisdiction controls, and public paid-room risk must be reviewed before production rooms.
