# FX Bento Payout Root Schema

MVP prize claims currently use Merkle leaves:

```solidity
keccak256(abi.encode(roomId, player, amount))
```

Production settlement must bind more accounting before public paid rooms:

```text
RoomPayoutRoot:
  roomId
  rosterHash
  rankingHash
  scoreRoot
  settlementPriceRoot
  payoutTotal
  protocolFee
  metadataHash
  winnerLeafRoot
```

Required invariants:

- `payoutTotal + protocolFee <= escrowedRoomBalance`
- every winner was an active paid entrant
- every amount is derived from the immutable room payout split
- no duplicate winner leaves
- leftovers have an explicit policy

Until this schema is fully enforced on-chain or through an auditable attestation flow, settlement roots are MVP attestor outputs and should not be used for public paid rooms.
