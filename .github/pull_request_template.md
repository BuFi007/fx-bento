## Summary

## Safety Checklist

- [ ] Preserves: `FXBentoHook` anchors market, `FXBentoRoomEscrow` holds money, `FXBentoSettlementManager` decides winners, Liveblocks is UX only.
- [ ] No new arbitrary admin withdrawal path.
- [ ] Paid-room safety is not overclaimed if code is still scaffold/mock.
- [ ] Room lifecycle transitions remain explicit.
- [ ] Prize/refund/fee claims remain pull-based.
- [ ] Backend or Liveblocks state is not treated as money source of truth.

## Verification

- [ ] `forge fmt --check`
- [ ] `forge build`
- [ ] `forge test`
- [ ] `bun run typecheck`
