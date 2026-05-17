# FX Bento Payout Root Schema

Prize claims use Merkle leaves:

```solidity
keccak256(abi.encode(roomId, player, amount))
```

Settlement now submits a typed `PayoutRoot` payload:

```text
PayoutRoot:
  roomId
  winnerRoot
  rosterHash
  leaderboardHash
  scoreRoot
  settlementPriceRoot
  payoutTotal
  protocolFee
  metadataHash
```

Required invariants:

- `payoutTotal + protocolFee <= escrowedRoomBalance`
- `protocolFee == escrowedRoomBalance * room.rakeBps / 10_000`
- `metadataHash == keccak256(bytes(metadataURI))`
- `winnerRoot` is the Merkle root for `keccak256(abi.encode(roomId, player, amount))` leaves
- every winner was an active paid entrant
- every amount should be derived from the immutable room payout split
- no duplicate winner leaves
- leftovers have an explicit policy

The escrow stores the schema hash and aggregate totals, caps prize claims at `payoutTotal`, and also enforces `claimedPrizes + protocolFee <= escrowedRoomBalance`.
