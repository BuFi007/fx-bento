## Summary

## Safety Checklist

- [ ] Preserves: `FXBentoHook` anchors market, `FXBentoRoomEscrow` holds money, `FXBentoSettlementManager` decides winners, Liveblocks is UX only.
- [ ] No new arbitrary admin withdrawal path.
- [ ] Paid-room safety is not overclaimed if code is still scaffold/mock.
- [ ] Room lifecycle transitions remain explicit.
- [ ] Prize/refund/fee claims remain pull-based.
- [ ] Offchain app/backend assumptions are documented outside this Solidity repo when relevant.

## Verification

- [ ] `forge fmt --check`
- [ ] `forge build`
- [ ] `forge test`
