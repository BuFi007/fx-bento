# FX Bento Room Lifecycle

Room status values are contract state, not UI hints.

| Status | Name | Meaning |
| --- | --- | --- |
| `0` | Lobby | Players may join or leave. |
| `1` | Locked | Minimum players reached and entry funds are locked. |
| `2` | Settling | Rounds are complete and results may be submitted. |
| `3` | Settled | Results root is final and claims may be pulled. |
| `4` | Cancelled | Room failed to start and active players may refund. |

Allowed transitions:

| From | To | Caller | Guard |
| --- | --- | --- | --- |
| Lobby | Locked | `FXBentoRoomEscrow` | Active players >= min players and `block.timestamp >= startTime`. |
| Lobby | Cancelled | `FXBentoRoomEscrow` | Active players < min players and `block.timestamp >= startTime`. |
| Locked | Settling | `FXBentoRoomEscrow` or authorized coordinator path | Room play has ended. |
| Locked/Settling | Settled | `FXBentoRoomEscrow`, called by `FXBentoSettlementManager` | Valid final results root and payout cap. |

The factory must not expose arbitrary status writes. A room cannot return to lobby after locking.
