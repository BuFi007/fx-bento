<!-- /autoplan restore point: /Users/criptopoeta/.gstack/projects/BuFi007-fx-bento/main-autoplan-restore-20260516-204010.md -->

# FX² Arcade Protocol Architecture Reference

Existing repo:

- Local path: `/Users/criptopoeta/Documents/fx-bento-arcade`
- Remote: `git@github.com:BuFi007/fx-bento.git`
- Branch: `main`
- Initial pushed commit: `e6535d8 Initial FX Bento protocol scaffold`

## Guiding Boundary

> FXBentoHook anchors the market. FXBentoRoomEscrow holds the money. FXBentoSettlementManager decides winners. Liveblocks only makes it feel multiplayer.

This is the core architectural rule for the project.

## Product

**FX² Arcade Protocol** is a decentralized multiplayer arcade layer for FX/stablecoin markets.

The first game is **FX Bento**.

FX Bento is a kawaii, square-tile, multiplayer FX prediction game. Players join live rooms with a fixed USDC entry fee, receive the same chip budget, place chips on future price tiles, and compete for score. Winners are paid from the capped player-funded prize pool. The protocol earns transparent rake and never takes uncapped directional risk.

## Hook References

Use these Uniswap v4 hook patterns as references:

- Volatility Oracle / Dynamic Fee: price snapshots, volatility buckets, tile difficulty.
- UniMarket / prediction-market hook: prediction-game market anchoring.
- Unimon / game-in-hook: proof that game mechanics can exist around a v4 hook, while FX Bento keeps custody and scoring outside the hook.

Start from a Uniswap v4 `BaseHook` template with Foundry tests.

## Architecture Decision

The Uniswap v4 hook is the market integration layer, not the whole game.

`FXBentoHook.sol` should:

- Anchor FX Bento rooms to real Uniswap v4 pools.
- Record pool price snapshots.
- Expose market and volatility observations.
- Emit events for indexers and game settlement.
- Optionally collect arcade-related swap/rake fees later.
- Never custody player room escrow.
- Never decide final winners alone.
- Never distribute player prizes directly.

Room escrow, commit-reveal, scoring, settlement, refunds, and prize distribution live in dedicated contracts.

## Naming

- Protocol: FX² Arcade Protocol
- Game: FX Bento
- Hook: `FXBentoHook.sol`
- Room Factory: `FXBentoRoomFactory.sol`
- Room Escrow: `FXBentoRoomEscrow.sol`
- Round Manager: `FXBentoRoundManager.sol`
- Commitment Manager: `FXBentoCommitmentManager.sol`
- Scoring Library: `FXBentoScoring.sol`
- Settlement Manager: `FXBentoSettlementManager.sol`
- Fee Vault: `ProtocolFeeVault.sol`
- Frontend mode: FX Bento Arcade
- UI CTA: Play FX Bento

## Core Invariant

The protocol must never distribute more than the room escrow contains:

```text
totalPrizePayouts + protocolFee <= totalRoomEscrow
```

The protocol does not pay users from an uncapped vault. Players compete against each other. The protocol only earns transparent rake.

## Game Rules

- Rooms have a market pair such as USDC/EURC, USDC/MXNB, USDC/BRL, or USDC/ETH.
- Rooms have multiple rounds.
- Every player receives the same chip budget per round.
- The board is a square tiled bento grid.
- Vertical axis = price bands.
- Horizontal axis = future time windows.
- Players can only select future tiles.
- Tiles near the current-time cursor are locked.
- A tile hits if the oracle/pool reference price lands inside that tile's price band during that tile's time window.
- Harder/farther tiles score more points.
- Easier/closer tiles score fewer points.
- Selecting more tiles increases hit probability but reduces score per hit.
- Concentrated predictions have higher upside.
- Spread predictions are safer but weaker.
- Walls and spam patterns are invalid or decay to near-zero score.

## Anti-Abuse Rules

- Max selected tiles per round: 5.
- Max tiles per row: 2.
- Max adjacent horizontal tiles: 2.
- No full-row walls.
- No full-column walls.
- Only future columns are selectable.
- Tiles lock before their time window begins.
- No last-second sniping.
- Invalid patterns are rejected before commit or scored as zero based on room config.

## Scoring

Use fixed-point integer math:

```text
baseScore = tileDifficultyScore
coveragePenalty = 1 / selectedTileCount^0.85
finalHitScore = baseScore * coveragePenalty
```

Approximate examples:

- 1 selected tile = 1.00x score value
- 2 selected tiles = ~0.55x per hit
- 3 selected tiles = ~0.39x per hit
- 5 selected tiles = ~0.25x per hit

Difficulty uses:

- Distance from anchor price.
- Time window distance.
- Volatility bucket.
- Grid config.

## Contract Responsibilities

`FXBentoHook.sol`:

- Build as a custom Uniswap v4 hook using `BaseHook`.
- Permissions: `afterInitialize`, `afterSwap`, optional `beforeSwap`, optional donate callbacks only if implementing sponsored prize donations.
- Store latest pool snapshots.
- Maintain a lightweight ring buffer of observations per `PoolId`.
- Expose `latestSnapshot(poolId)` and `realizedVolatility(poolId, window)`.
- Never hold player escrow or distribute prizes.

`PoolRegistry.sol`:

- Track allowed FX/stablecoin pools.
- Include pool id, `PoolKey`, base/quote token, oracle source, allowed flag, max stale seconds, hook address, and metadata URI.

`FXBentoRoomFactory.sol`:

- Create immutable game room configs.
- Validate allowed pool, allowed entry token, rake cap, payout sum, player bounds, and future start time.

`FXBentoRoomEscrow.sol`:

- Hold entry fees per room.
- Handle joins, leaves before start, cancellation refunds, locks, settlement roots, prize claims, and protocol rake claims.
- No arbitrary admin withdrawal.
- Pull payments only.

`FXBentoRoundManager.sol`:

- Store round timing, lock time, anchor price, settlement price, market snapshot id, grid config hash, and status.

`FXBentoCommitmentManager.sol`:

- Commit-reveal tile selections.
- Commitment hash: `hash(chainId, roomId, roundIndex, player, selectedTilesHash, nonce)`.
- Support EIP-712 signed commitments for gasless/batched UX.

`FXBentoScoring.sol`:

- Pure deterministic scoring and anti-wall validation.

`FXBentoSettlementManager.sol`:

- Authorized attestor posts results roots for MVP.
- Results root commits to scores, rankings, round settlement prices, and selection proofs.
- Optional challenge window.
- Finalized results unlock Merkle prize claims.

`ProtocolFeeVault.sol`:

- Receives protocol rake.
- MVP sends rake to treasury with accounting events.

## Frontend And Realtime

Frontend mode: **FX Bento Arcade**.

Lobby copy:

- “FX² Arcade Protocol”
- “Play FX Bento”
- “Kawaii FX prediction rooms. Same chips. Same market. Highest score wins.”

Use Liveblocks for waiting room presence, player list, cursors, tile hover, selected tile preview, countdown sync, leaderboard updates, chat/reactions, and spectators.

Do not trust Liveblocks for money.

Contracts are the source of truth for entry payments, escrow, commitments, refunds, settlement, prize claims, and protocol fee claims.

## Backend

Use Hono + Bun for:

- Room coordinator.
- Liveblocks auth endpoint.
- Market data streamer.
- Oracle snapshot worker.
- Commitment batcher.
- Settlement attestor for MVP.
- Leaderboard calculator.
- Result publisher.

## Security Requirements

- OpenZeppelin `SafeERC20`.
- `ReentrancyGuard`.
- `Pausable`.
- `AccessControl` or `Ownable` with timelock for sensitive changes.
- Max rake cap.
- Immutable active room rules.
- No arbitrary admin withdrawal.
- Emergency pause must not block refunds or prize claims.
- Pull payments for prizes.
- Event emission for every state transition.
- External calls after state updates.
- Room accounting isolated by `roomId`.
- Settlement cannot exceed escrow.
- Prize claims cannot exceed Merkle allocation.

## Shared Skills

Both Claude and Codex point to the same shared skills in `/Users/criptopoeta/.agents/skills`:

- `v4-hook-generator`
- `v4-security-foundations`
- `adversarial-uniswap-hooks`
- `v4-sdk-integration`
- `swap-integration`
- `swap-planner`
- `liquidity-planner`
- `viem-integration`

Use this sequence for the hook path:

1. `v4-hook-generator`
2. `v4-security-foundations`
3. `adversarial-uniswap-hooks`
4. `v4-sdk-integration`
5. `viem-integration`

## Verification

Before finishing contract work:

```bash
forge fmt --check
forge build
forge test
```

Before finishing TypeScript work:

```bash
bun run typecheck
```

---

## /autoplan Phase 1 CEO Review

### Phase 1 Status

Plan summary: FX² Arcade Protocol proposes a modular onchain architecture for FX Bento, with a Uniswap v4 market-snapshot hook, room escrow, commit-reveal, scoring, settlement, Liveblocks realtime UX, and a Hono/Bun coordinator.

UI scope: yes. The plan includes an arcade lobby, game board, room cards, countdowns, leaderboard, result modal, and claim flow.

DX scope: yes. The plan includes Solidity contracts, Foundry tests, TypeScript SDK, Hono backend APIs, deployment scripts, and Uniswap v4 SDK/viem integration.

Base branch: `main`.

Restore point: `/Users/criptopoeta/.gstack/projects/BuFi007-fx-bento/main-autoplan-restore-20260516-204010.md`.

### 0A. Premise Challenge

| Premise | Evaluation | Risk | Decision |
| --- | --- | --- | --- |
| Users want short-duration FX/stablecoin prediction rooms enough to repeat-play. | Assumed, not proven. Current plan specifies mechanics and fairness, but not retention evidence. | Critical | Add a demand-validation milestone before protocol hardening. |
| Paid USDC entry plus prize pool plus rake can be launched safely as an arcade product. | Assumed, high-risk. The product may trigger gambling, contests, sweepstakes, derivatives, KYC, OFAC, and geo restrictions. | Critical | Add regulatory launch assumptions before mainnet paid rooms. |
| Uniswap v4 hook anchoring is necessary for MVP value. | Weakly defended. The hook is valuable for protocol-native credibility, but not necessary to test the fun loop. | High | Split into MVP and protocol-native phases. |
| FX/stablecoin pairs will be liquid, fresh, and volatile enough for fun scoring. | Unproven. The plan names pairs but lacks spread, liquidity, manipulation-cost, volatility, and v4 availability evidence. | High | Add market viability table before choosing MVP pair. |
| Room formation will work. | Underdesigned. Multiplayer fixed-entry rooms need fast fill rates, scheduled rounds, or pooling. | Critical | Add room-fill strategy and room-fill SLA. |
| Authorized attestor settlement is acceptable for MVP. | Plausible, but must be framed honestly. It is not fully decentralized. | Medium | Add explicit MVP trust model, challenge path, and backend disappearance behavior. |

CEO conclusion: the architecture is coherent, but the current plan optimizes for protocol correctness before proving a live game loop. Keep the technical boundary, but add a validation-first sequence.

### 0B. Existing Code Leverage

| Sub-problem | Existing code | Leverage |
| --- | --- | --- |
| Room creation and immutable config | `src/FXBentoRoomFactory.sol` | Solid scaffold for validation and status wiring. Needs future-start validation and stricter role boundaries. |
| Escrow, refunds, rake, prize claims | `src/FXBentoRoomEscrow.sol` | Core invariant enforced at claim time. Needs broader invariants, role hardening, and cancellation edge-case review. |
| Market snapshots | `src/FXBentoHook.sol` | Useful scaffold. Not canonical v4 `BaseHook` yet. |
| Round timing | `src/FXBentoRoundManager.sol` | Minimal metadata store. Needs stronger authorization and integration with oracle/hook snapshots. |
| Commit-reveal | `src/FXBentoCommitmentManager.sol` | Basic commit/reveal path exists. Needs full EIP-712 domain, future-column validation, replay tests, and signature batch tests. |
| Scoring | `src/FXBentoScoring.sol` | Anti-wall and coverage penalty scaffold exists. Needs grid config, difficulty scoring, volatility buckets, and explainable results. |
| Backend endpoints | `backend/src/server.ts` | Route skeleton exists. Needs onchain reads/writes, persistence, idempotency, auth, and worker separation. |
| Frontend components | `frontend/src/components/FXBentoArcade.tsx` | Product skeleton exists. Needs wallet flow, Liveblocks wiring, responsive behavior, states, and real game board logic. |
| SDK | `sdk/src/index.ts` | Hashing and validation helpers exist. Needs generated ABIs, viem clients, contract calls, room types, and v4 SDK integration. |

### 0C. Dream State Mapping

```text
CURRENT
  Passing scaffold:
  contracts + tests + backend/frontend/SDK skeletons

THIS PLAN
  Canonical v4 hook + escrowed paid rooms + settlement + realtime UX

12-MONTH IDEAL
  Evidence-backed arcade protocol:
  retained players, fast-filled rooms, audited escrow, credible settlement,
  market pairs selected from liquidity/volatility data, compliance posture,
  creator/tournament distribution, and v4-native composability where it matters
```

Dream state delta: the plan has the right contract boundaries, but it lacks product validation gates, market viability evidence, compliance assumptions, room liquidity design, and unit economics.

### 0C-bis. Implementation Alternatives

| Approach | Description | Effort | Risk | Pros | Cons | CEO recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| A. Protocol-first v4 MVP | Immediately refactor hook to canonical Uniswap v4 `BaseHook`, then build contracts/backend/frontend around it. | High | High | Strong protocol identity and aligned with v4 thesis. | Slowest path to learning whether the game is fun or legal to launch. | Not first. |
| B. Validation-first staged MVP | Keep contract boundary, but prioritize one pair, one room type, offchain replay/prototype, escrow + settlement, and market viability before v4 hook hardening. | Medium | Medium | Faster demand learning while preserving protocol path. | Less impressive as a pure v4 demo at first. | Recommended. |
| C. Realtime game-first beta | Build a free-to-play or testnet Liveblocks game using historical/streamed prices before paid escrow. | Low-Medium | Low | Fastest way to validate fun loop and UI comprehension. | Delays paid-room contract validation. | Good companion to B. |

Auto-decision under `/autoplan`: choose B, with C as a validation workstream. This is a taste decision because the user's stated direction emphasizes v4 hook work first.

### 0D. Mode-Specific Analysis

Mode: selective expansion.

Accepted expansions in blast radius:

- Add product validation gates before mainnet paid rooms.
- Add market viability table for candidate pairs.
- Add compliance/trust model section.
- Add room-fill strategy.
- Add unit economics/rake model.
- Keep canonical v4 hook refactor as a protocol-native milestone, not the only MVP blocker.

Deferred:

- Multi-attestor settlement network.
- Multi-pair marketplace.
- Sponsored prize donations through hook callbacks.
- Creator/referral economics beyond a basic model.

### 0E. Temporal Interrogation

Hour 1:

- Read plan, current scaffold, tests, README, and threat model.
- Confirmed repo is clean and base branch is `main`.
- Created restore point and added it to the plan.

Hour 6:

- Highest risk is not contract modularity. Highest risk is building a polished protocol before validating repeat-play demand, room liquidity, market viability, and compliance posture.

Week 1:

- The first valuable artifact should be a validated MVP plan: one market, one room format, explicit trust model, testnet/free-play UX, and canonical v4 hook milestone.

Six-month regret:

- A complete v4 hook and contract suite exists, but paid rooms do not fill, the scoring loop is confusing, stablecoin FX is too flat/manipulable, or the launch is blocked by regulatory constraints.

### 0F. Mode Confirmation

Recommended mode remains selective expansion: preserve the architecture, but add missing product, market, compliance, and adoption gates before treating the v4 hook as the critical path.

### CEO Dual Voices

#### CODEX SAYS (CEO — strategy challenge)

- Regulatory risk is the highest-risk premise: paid USDC entry, predictions, prize pools, and rake may be gambling/contest/derivatives activity.
- The v4 hook may be technology-first. The game can validate demand with centralized or indexed market feeds plus onchain escrow and transparent settlement proofs.
- The market premise is weak: stablecoin FX may be too flat, while USDC/ETH is not FX and changes the category.
- Uniswap v4 pool manipulation risk is not modeled. The plan lacks minimum liquidity, manipulation cost thresholds, TWAP windows, and cross-oracle checks.
- Protocol surface is over-scoped before the fun loop is proven.
- Liveblocks/realtime UX may be the actual adoption surface, but the plan weights contracts more heavily than matchmaking, social loops, tournaments, and mobile UX.
- Sharper reframing: real-money prediction party rooms for stablecoin communities.

#### CLAUDE SUBAGENT (CEO — strategic independence)

- The plan solves decentralized arcade architecture, not the sharper adoption problem.
- Liquidity and room formation are assumed, not designed.
- The Uniswap v4 hook is strategically over-weighted for the first version.
- Oracle/market pair viability is under-specified.
- Prediction-game demand and tile-game fun are not proven.
- Six-month regret is overbuilding protocol surface before finding the addictive loop.
- Settlement centralization is acknowledged but not productized.
- Competitive risk includes centralized/mobile/social games that can copy the visible mechanic faster.
- Regulatory/payment risk is missing.
- The architecture boundary is strong and worth preserving.

### CEO Dual Voices — Consensus Table

| Dimension | Claude | Codex | Consensus |
| --- | --- | --- | --- |
| Premises valid? | No, demand/liquidity assumed | No, compliance/market premise weak | DISAGREE WITH CURRENT PREMISES |
| Right problem to solve? | Reframe toward repeatable FX game loop | Reframe toward prediction party rooms | CONFIRMED REFRAME NEEDED |
| Scope calibration correct? | Too protocol-heavy too early | Too protocol-heavy too early | CONFIRMED |
| Alternatives sufficiently explored? | No | No | CONFIRMED |
| Competitive/market risks covered? | No | No | CONFIRMED |
| 6-month trajectory sound? | Risk of overbuilding | Risk of protocol before demand | CONFIRMED CONCERN |

Consensus: 5/6 confirmed concerns, 1 premise challenge requiring user judgment.

### Review Sections 1-10

#### Section 1: Architecture Review

Examined hook, escrow, settlement, room factory, commitment, scoring, backend, frontend, SDK, README, and threat model. The architecture boundary is strong, but the MVP sequence is inverted: canonical v4 hook work is valuable, yet the highest-risk uncertainties are product and market viability.

```text
              Market data / Uniswap v4 pool
                         |
                         v
                  FXBentoHook
             snapshots, volatility, events
                         |
                         v
FXBentoRoomFactory -> FXBentoRoomEscrow -> ProtocolFeeVault
        |                     |
        v                     v
FXBentoRoundManager     FXBentoSettlementManager
        |                     |
        v                     v
FXBentoCommitmentManager -> Merkle prize claims
        |
        v
Hono/Bun coordinator + Liveblocks UX
```

Issue: hook-first sequencing risks delaying the first learning loop. Auto-decision: add a staged MVP path.

#### Section 2: Error & Rescue Map

| Error path | Current plan coverage | Gap | Rescue |
| --- | --- | --- | --- |
| Room does not fill | Cancellation/refund exists | No room-fill SLA or scheduled format | Add scheduled rooms, limited room sizes, and cancellation UX. |
| Market pair is too flat | Not covered | Scoring may feel random or boring | Add volatility viability analysis and replay simulation. |
| Pool can be manipulated | Mentioned indirectly through security | No manipulation-cost threshold | Add liquidity/TWAP/cross-oracle requirements. |
| Settlement backend disappears | Not covered | Funds may be stuck until settlement path is restored | Add timeout/cancel or alternate attestor recovery path. |
| Attestor posts bad root | Challenge window optional | No challenger incentives or UX | Define challenge bond/window and evidence format. |
| Compliance blocks paid rooms | Not covered | Launch risk | Add geo/KYC/no-go market assumptions. |
| User does not understand score | Not covered | Retention loss | Add score explanation UX and replayable round result. |

#### Section 3: Security & Threat Model

The pinned invariant is correct and already documented. The missing security layer is market manipulation and MVP trust disclosure. The current threat model admits the hook is not canonical v4 and settlement is authorized, but the plan needs explicit criteria for when paid mainnet rooms are allowed.

High severity: no market manipulation model for thin pools.

#### Section 4: Data Flow & Interaction Edge Cases

Data flow is directionally sound: commitments before lock, reveal after lock, settlement root, Merkle claims. Missing edge cases: late reveal policy, no-reveal scoring policy, stale oracle behavior, tie handling, duplicate winners, pair pauses, room cancellation after partial rounds, and backend outage.

#### Section 5: Code Quality Review

The code is intentionally scaffold-level and readable. The plan should not add abstractions before canonical v4 imports are pinned. Prefer explicit contracts and targeted tests over a generalized protocol framework.

#### Section 6: Test Review

Existing tests cover room creation, joins, max players, min lock, refunds, commit/reveal, wall patterns, scoring, settlement, double claims, hook snapshots, and payout invariant.

Gaps to add:

- Invalid room config: bad payout sum, start time in past, disallowed token, disallowed pool.
- Escrow invariant handler across random joins/refunds/settlements/claims.
- Settlement manager challenge/finalize path.
- EIP-712 signature replay, wrong signer, wrong chain, wrong room.
- Oracle stale/manipulation rejection once implemented.
- Canonical v4 permission bit and hook callback tests after refactor.

#### Section 7: Performance Review

Contract hot paths are small. Risks are offchain: realtime room presence, market streaming, leaderboard recalculation, and commitment batching. The plan needs bounded room size and pagination/indexing rules before scaling beyond small rooms.

#### Section 8: Observability & Debuggability Review

Events exist for many state transitions, but plan needs a room timeline model for support/debugging: created, joined, locked, round started, committed, revealed, settled, challenged, finalized, claimed, refunded.

#### Section 9: Deployment & Rollout Review

The plan lists deployment needs but lacks rollout gates. Required gates: local Anvil, testnet free-play, testnet paid mock token, mainnet allowlisted beta, then public paid rooms.

#### Section 10: Long-Term Trajectory Review

Reversibility: 3/5. The modular architecture is reversible, but launching paid rooms and v4 hook dependencies too early creates product, legal, and audit commitments.

Long-term debt: generalized protocol naming before single-game validation may distract from FX Bento retention.

### Section 11: Design & UX Review Preview

UI scope exists and should proceed to Phase 2. The biggest design risk is explaining why a tile wins or loses in a way that feels fair, not arbitrary.

### NOT In Scope

- Multi-pair public marketplace before one pair is validated.
- Hook-level sponsored donations before escrow and settlement are hardened.
- Multi-attestor decentralized keeper network before MVP settlement trust is clear.
- Creator/referral economics beyond a first unit-economics model.

### What Already Exists

- Contract scaffold for hook, room factory, escrow, round manager, commitment manager, scoring, settlement manager, pool registry, fee vault.
- Foundry tests with 20 passing tests.
- README and threat model.
- Hono backend skeleton.
- React component skeleton.
- TypeScript SDK helpers for pool id, selection hash, commitment hash, and anti-wall validation.

### Error & Rescue Registry

| ID | Failure | User impact | Rescue |
| --- | --- | --- | --- |
| ER-1 | Room fails to fill | User waits, then churns | Scheduled rooms, visible countdown, automatic refund. |
| ER-2 | Bad settlement root | Wrong winner/prize | Challenge window, evidence bundle, alternate attestor. |
| ER-3 | Market stale/manipulated | Score feels unfair | TWAP, freshness gates, deviation checks, pair allowlist. |
| ER-4 | Commit/reveal confusion | Player loses despite selecting | Clear lock/reveal state and score explanation. |
| ER-5 | Paid launch blocked | Product cannot ship | Free-play/testnet beta and compliance gate. |

### Failure Modes Registry

| ID | Failure mode | Severity | Mitigation |
| --- | --- | --- | --- |
| FM-1 | Protocol overbuilt before fun loop is proven | Critical | Add validation-first milestone. |
| FM-2 | Regulatory classification blocks paid rooms | Critical | Add compliance assumptions and no-go launch rules. |
| FM-3 | Thin pools can be manipulated | High | Add liquidity/manipulation-cost gates and oracle fallback. |
| FM-4 | Room liquidity cold start | Critical | Limit room formats, schedule tournaments, define fill SLA. |
| FM-5 | Scoring feels arbitrary | High | Prototype with historical data and explain results. |
| FM-6 | Centralized attestor trust mismatch | Medium | Productize MVP trust model and challenge flow. |

### Scope Expansion Decisions

| # | Decision | Classification | Principle | Rationale | Rejected |
| --- | --- | --- | --- | --- | --- |
| CEO-1 | Add validation-first MVP gate before hook-hardening is treated as ship blocker. | Taste | Completeness + pragmatic | Covers the largest adoption risk while preserving v4 path. | Pure hook-first sequencing. |
| CEO-2 | Add market viability table before choosing MVP pair. | Mechanical | Completeness | Pair liquidity/volatility determines whether scoring works. | Picking USDC/EURC by brand fit alone. |
| CEO-3 | Add compliance/trust model before mainnet paid rooms. | Mechanical | Completeness | Paid rake rooms create non-technical launch risk. | Treating escrow as sufficient risk control. |
| CEO-4 | Add room-fill strategy and room-fill SLA. | Mechanical | Bias toward action | Multiplayer rooms fail if lobbies feel empty. | Assuming organic liquidity. |
| CEO-5 | Keep hook/escrow/settlement/Liveblocks boundary. | Mechanical | Explicit over clever | Both voices agree this is the strongest architectural choice. | Moving custody/scoring into the hook. |

### Implementation Tasks From CEO Review

| ID | Priority | Component | Task |
| --- | --- | --- | --- |
| T1 | P0 | Product plan | Add validation milestones: replay prototype, free-play/testnet, paid beta, v4-native phase. |
| T2 | P0 | Market plan | Create pair viability table with liquidity, spread, volatility, manipulation cost, data freshness. |
| T3 | P0 | Compliance | Add launch assumptions for geo, KYC/no-KYC, OFAC, no-go markets, paid-room readiness. |
| T4 | P1 | Game design | Add historical replay simulation and score explainability requirements. |
| T5 | P1 | Backend/product | Add room-fill strategy: one pair, one/two room sizes, scheduled tournaments, cancellation UX. |
| T6 | P1 | Settlement | Add MVP trust model, challenge UX, backend disappearance rescue path. |

### CEO Completion Summary

| Review Step | Result |
| --- | --- |
| Step 0 | Selective expansion, validation-first sequencing recommended. |
| Section 1 Architecture | 1 sequencing issue found. Boundary preserved. |
| Section 2 Errors | 7 error paths mapped, 6 gaps. |
| Section 3 Security | 2 high/critical strategic security gaps. |
| Section 4 Data/UX | Multiple late/stale/tie/outage edge cases flagged. |
| Section 5 Quality | Keep explicit modules, avoid premature abstraction. |
| Section 6 Tests | Existing 20 tests acknowledged, 6 major gaps identified. |
| Section 7 Performance | Bounded rooms and offchain load strategy needed. |
| Section 8 Observability | Room timeline/debug events needed. |
| Section 9 Deploy | Rollout gates missing. |
| Section 10 Future | Reversibility 3/5. Debt: protocol before game validation. |
| Section 11 Design | UI review required in Phase 2. |

### Phase 1 Premise Gate

Premises that require human confirmation before Phase 2:

1. Should the next plan still prioritize canonical Uniswap v4 hook refactor first, or should it insert validation-first milestones before treating the hook as the critical path?
2. Should paid USDC rooms remain the target MVP, or should the first user-facing test be free-play/testnet until compliance and repeat-play evidence are clearer?
3. Should the market scope remain broad FX/stablecoin pairs, or should MVP constrain to one evidence-backed pair and one room format?

Recommended `/autoplan` answer: approve validation-first sequencing while preserving the pinned architecture boundary.

Premise gate result: **Validation first**. Preserve the v4 architecture boundary, but add demand, compliance, market, and room-fill gates before treating hook hardening as the critical path.

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | Use validation-first sequencing while preserving the pinned hook/escrow/settlement boundary. | User confirmed | Completeness + pragmatic | This tests repeat-play, room liquidity, compliance, and market viability before over-investing in canonical hook hardening. | Hook-first as the immediate critical path. |
| 2 | Design | Make the first player screen room-first instead of protocol-first. | Mechanical | Explicit over clever | Players need to know if they can play now, what they pay, what they can win, and when the room starts before they care about hook architecture. | Leading the first viewport with protocol details. |
| 3 | Design | Require a full UI state matrix before implementation. | Mechanical | Completeness | Commit/reveal, settlement, refunds, stale markets, wallet failures, and Liveblocks degradation are product-critical states. | Leaving states to component implementation. |
| 4 | Design | Prioritize score explainability and replayable result UI. | Mechanical | Completeness | Repeat play depends on understanding why a tile hit, missed, or scored less due to coverage penalty. | A generic result modal. |
| 5 | Design | Specify mobile as board-first with bottom-sheet secondary panels. | Taste | Pragmatic + explicit | The square grid is the product surface; shrinking it behind chat/leaderboard would make mobile play unusable. | Desktop-first grid squeezed onto mobile. |

---

## /autoplan Phase 2 Design Review

### Step 0. Design Scope Assessment

Initial design score: **4/10**.

The plan has a clear game concept and component inventory, but it does not yet define screen hierarchy, screen states, mobile layout, accessibility, or result explainability. It is strong enough for a prototype scaffold, not strong enough for a validation-first MVP.

Existing design leverage:

- `frontend/src/components/FXBentoArcade.tsx` already names the main surfaces: lobby, room list, rules, waiting room, prize pool, board, tile grid, chip bar, countdown, lock zone, leaderboard, result/final modals, claim button.
- `frontend/src/components/fx-bento.css` already has a light kawaii palette and a square grid base.
- The plan already states UX words to use and words to avoid.

Focus areas:

- Player-first lobby hierarchy.
- Active round board hierarchy.
- Full state matrix.
- Result explainability.
- Mobile layout.
- Accessibility and non-color-only status.

### Design Dual Voices

#### CODEX SAYS (design — UX challenge)

- The UI plan is architecture-first and serves a developer more than a player deciding whether to join.
- First hierarchy should answer: can I play now, what do I pay, what can I win, how many players are needed, when does it start, why is the market fair/live, how do I score, and what happens if the room fails.
- The plan names components but does not specify states.
- Missing states include wallet disconnected, wrong chain, insufficient USDC, allowance, join pending/failed, room filling/cancelled/refunded, tile selectable/invalid/locked/committed/revealed/hit/miss, stale market, settlement pending/challenged/finalized, Liveblocks disconnected, and backend unavailable.
- Mobile strategy is absent. The board must be first-class, with sticky countdown/commit and bottom-sheet secondary panels.
- Accessibility requirements are absent.
- The next plan should replace the design preview with a real UI spec centered on join conversion, room fill rate, repeat play, score explanation, refund/challenge comprehension, and paid-readiness gates.

#### CLAUDE SUBAGENT (design — independent review)

- First-screen hierarchy is wrong for users: lead with rooms, selected room details, wallet/entry action, then market/protocol proof.
- Game board hierarchy is under-specified: current price, timers, selectable tiles, score estimate, commitment status, and leaderboard need clear priority.
- Critical states are missing across lobby, room, board, commitment, reveal, settlement, claim, and refund flows.
- Empty-room emotional break is unresolved.
- Commit/reveal is a major UX risk and needs explicit visible states.
- Result explainability must show selected tiles, actual price path, hit window, score multiplier, coverage penalty, final score, rank, and prize/none.
- Locked, unavailable, invalid, hit, and miss tiles need distinct treatments.
- Mobile ambiguity will haunt implementation.
- Trust model must be productized with settlement status: pending attestation, challenge open, finalized, claim available.

### Design Litmus Scorecard

| Dimension | Claude | Codex | Consensus |
| --- | --- | --- | --- |
| Information hierarchy serves player? | No | No | CONFIRMED GAP |
| Interaction states complete? | No | No | CONFIRMED GAP |
| User journey emotionally coherent? | No | Partially, but weak | CONFIRMED GAP |
| UI specificity sufficient? | No | No | CONFIRMED GAP |
| Mobile/responsive specified? | No | No | CONFIRMED GAP |
| Accessibility specified? | Not enough | No | CONFIRMED GAP |
| Trust/settlement productized? | Weak | Weak | CONFIRMED GAP |

Consensus: 7/7 design gaps confirmed, no model disagreement.

### Pass 1. Information Architecture

Score: **4/10 → 8/10 after planned fixes**.

Required first-screen hierarchy:

1. Available rooms and status.
2. Selected room detail: pair, entry, prize pool, players filled/max, start time, rounds, protocol fee, refund rule.
3. Primary CTA: Play FX Bento / Join room / Watch room / Claim refund depending on state.
4. Market health: live, stale, paused, validation mode, oracle/hook source.
5. How scoring works in one compact expandable panel.
6. Protocol proof and contracts only after the player understands the room.

Auto-decision: update lobby spec to lead with FX Bento rooms, not protocol architecture.

### Pass 2. Interaction State Coverage

Score: **3/10 → 8/10 after planned fixes**.

State matrix required:

| Surface | Required states |
| --- | --- |
| Lobby | loading, empty, rooms available, all rooms full, scheduled next room, backend degraded |
| Wallet/entry | disconnected, wrong chain, insufficient USDC, allowance required, join pending, joined, join failed |
| Room | filling, almost full, countdown, locked, cancelled, refund available, spectator |
| Board | price loading, market live, stale, paused, selectable, selected, invalid, locked, committed |
| Commit/reveal | selecting, ready to commit, commit pending, committed hidden, reveal required, reveal pending, revealed, missed reveal |
| Settlement | pending attestation, challenge open, finalized, failed, rescue path |
| Claim/refund | claimable, claim pending, claimed, claim failed, refund pending, refunded |
| Realtime | connected, reconnecting, degraded, presence unavailable |

### Pass 3. User Journey And Emotional Arc

Score: **4/10 → 8/10 after planned fixes**.

Required arc:

```text
See playable room
  -> understand entry/prize/start
  -> choose target tiles with score preview
  -> commit before lock
  -> watch price path and leaderboard tension
  -> reveal and understand result
  -> claim/refund/rematch
```

The emotional breakpoints are empty lobbies, hidden commit/reveal, unexplained scoring, stale markets, and settlement delay. Each needs explicit copy and state.

### Pass 4. AI Slop Risk

Score: **5/10 → 8/10 after planned fixes**.

Risk: a generic pastel card dashboard with a tile grid would look like a demo, not a playable arcade room. The product needs dense, game-first information: board, timers, room fill, score preview, result replay, and rematch.

Design hard rule: no marketing hero as the main app screen. The first screen is the lobby and playable room list.

### Pass 5. Design System Alignment

Score: **5/10 → 7/10 after planned fixes**.

No formal design system exists. Keep the current light kawaii visual direction, but define status tokens:

- selectable
- selected
- invalid
- locked
- committed
- hit
- miss
- stale market
- settlement pending
- claimable

Each state must have non-color cues.

### Pass 6. Responsive And Accessibility

Score: **2/10 → 8/10 after planned fixes**.

Mobile rule: board-first full-screen play.

- Sticky top: room/pair, round timer, lock timer.
- Main: square grid with stable tile dimensions.
- Sticky bottom: chip budget, commit/reveal CTA, invalid-pattern warning.
- Bottom sheets: leaderboard, chat, room rules, result detail.
- Desktop: board center, room/market panel left, leaderboard/chat right.

Accessibility requirements:

- Keyboard grid navigation.
- Visible focus states.
- ARIA grid semantics.
- Screen-reader-safe countdowns.
- Non-color-only tile states.
- Reduced motion setting for result animation.
- Modal focus trap for result/claim/refund flows.
- Minimum 44px touch targets.

### Pass 7. Unresolved Design Decisions

Auto-decided:

- Lobby should be room-first, with protocol proof secondary.
- Mobile should be board-first.
- Result UI must be replayable and explanatory.
- Commit/reveal state must be visible and user-facing.

Still to validate in prototype:

- Exact grid dimensions.
- Whether chat is useful during paid rooms or too distracting.
- Whether score preview should show exact projected score or relative difficulty.
- Whether the first validation build should include free-play leaderboards.

### Required Screen Specs

| Screen | Primary CTA | Primary info | Secondary info |
| --- | --- | --- | --- |
| ArcadeLobby | Join room / Watch / Create test room | playable rooms, start times, players, prize/free-play mode | protocol proof, rules, market status |
| WaitingRoom | Ready / Leave / Refund if cancelled | fill progress, countdown, player list | chat, room rules, market health |
| ActiveRound | Commit selection | grid, current price, lock timer, chip budget, score preview | leaderboard, chat, rules |
| Reveal | Reveal selection | reveal timer, committed picks, pending status | missed reveal rules |
| RoundResult | Continue / Rematch after final | selected tiles, price path, hit/miss, multiplier, coverage penalty, score delta | leaderboard movement |
| FinalLeaderboard | Claim prize / Rematch | rank, prize, pool, fee, settlement status | proof, Merkle/root detail |
| Refund | Claim refund | cancellation reason, amount, tx status | next scheduled room |

### Design Implementation Tasks

| ID | Priority | Component | Task |
| --- | --- | --- | --- |
| D1 | P0 | Frontend spec | Add room-first lobby spec with room card required fields. |
| D2 | P0 | Frontend spec | Add full UI state matrix across lobby, wallet, room, board, commit/reveal, settlement, claim/refund, realtime. |
| D3 | P0 | Game board | Specify board hierarchy, tile state treatments, mobile layout, and sticky commit controls. |
| D4 | P0 | Results | Define replayable result screen with selected tiles, price path, hit window, multiplier, penalty, final score, rank, prize. |
| D5 | P1 | Trust UX | Add settlement status copy for pending attestation, challenge open, finalized, claimable. |
| D6 | P1 | Accessibility | Add keyboard, ARIA, focus, contrast, motion, touch target requirements. |

### Design Completion Summary

| Review Step | Result |
| --- | --- |
| Step 0 | Initial design score 4/10. UI scope confirmed. |
| Pass 1 Info Arch | 4/10 → 8/10 after room-first hierarchy. |
| Pass 2 States | 3/10 → 8/10 after state matrix. |
| Pass 3 Journey | 4/10 → 8/10 after emotional arc and rescue states. |
| Pass 4 AI Slop | 5/10 → 8/10 after game-first screen requirements. |
| Pass 5 Design System | 5/10 → 7/10 after status token set. |
| Pass 6 Responsive/A11y | 2/10 → 8/10 after board-first mobile and accessibility requirements. |
| Pass 7 Decisions | 4 auto-decided, 4 prototype questions left to validate. |
| Overall design score | 4/10 → 8/10 planned. |

Phase 2 complete. Codex: 8 concerns. Claude subagent: 15 issues. Consensus: 7/7 confirmed design gaps, 0 disagreements. Passing to Phase 3.

---

## /autoplan Phase 3 Engineering Review

### Step 0. Engineering Scope Assessment

Initial engineering score: **4/10**.

The scaffold has the right contract names and boundaries, but the current code is not yet a production-quality MVP. It is a useful prototype for validating the protocol thesis and UI loop, while several contract paths must be treated as mock or unsafe until corrected.

Critical principle preserved:

> FXBentoHook anchors the market. FXBentoRoomEscrow holds the money. FXBentoSettlementManager decides winners. Liveblocks only makes it feel multiplayer.

The review confirms this boundary is correct, but the code does not yet fully enforce it.

### Engineering Dual Voices

#### CODEX SAYS (engineering — implementation risk)

- `FXBentoRoomEscrow.settleRoom` can be called by any `SETTLER_ROLE`, and the owner satisfies every role through `RoleAccess`. This can bypass `FXBentoSettlementManager`, its challenge window, and its finalization flow.
- Leave/rejoin corrupts room accounting: `roomPlayers` keeps stale seats, `refunded` is not reset for a new deposit, and min/max player checks can use stale length.
- `FXBentoRoomFactory.setRoomStatus` is not a state machine. Owner or escrow can write arbitrary status values.
- `challengeResults` is a permanent grief switch because any challenge blocks finalization forever.
- Room and round timing are underconstrained: `startTime`, `roundDuration`, `lockBuffer`, room existence, round count, and snapshot binding are not consistently enforced.
- Commit/reveal is not bound to paid entrants.
- The hook is not yet a trustworthy v4 market anchor because callbacks are externally callable and not canonical `BaseHook` callbacks.
- Merkle prize roots do not commit to enough accounting, so overallocated roots become order-dependent.
- Backend state can diverge from chain state immediately.
- Current frontend still contradicts the room-first, board-first design requirements.

#### CLAUDE SUBAGENT (engineering — independent review)

- `FXBentoHook.sol` is not a real Uniswap v4 hook: no `BaseHook`, no canonical callback signatures, no `PoolManager` caller check, and local permission structs instead of v4 permission bits.
- Market freshness exists in registry metadata but is not enforced by round or settlement paths.
- Escrow rejoin/refund accounting can strand funds.
- Settlement challenge flow can freeze rooms indefinitely.
- Settlement manager and escrow role wiring is fragile and not covered by deployment tests.
- Lifecycle sequencing is underconstrained across lobby, lock, cancel, rounds, and settlement.
- Commit/reveal does not verify paid room membership or valid configured rounds.
- No-reveal handling is not protocol-defined.
- Prize roots do not bind total allocation, payout schedule, rankings, score roots, or settlement price roots.
- Backend and Liveblocks currently bypass the trust boundary and must be treated as mock coordination only.

### Engineering Litmus Scorecard

| Dimension | Codex | Subagent | Consensus |
| --- | --- | --- | --- |
| Pinned architecture sound? | Yes | Yes | CONFIRMED |
| Current hook production-ready? | No | No | CRITICAL GAP |
| Escrow accounting safe? | No | No | CRITICAL GAP |
| Settlement manager authoritative? | No | No | CRITICAL GAP |
| Lifecycle state machine complete? | No | No | HIGH GAP |
| Commit/reveal membership bound? | No | No | HIGH GAP |
| Market freshness enforced? | No | No | HIGH GAP |
| Backend production trusted? | No | No | HIGH GAP |

Consensus: the architecture direction is right, but implementation must add enforcement before paid rooms or real settlement.

### Pass 1. Contract Boundary Enforcement

Score: **4/10 → 8/10 after planned fixes**.

Required changes:

| ID | Priority | Area | Required fix |
| --- | --- | --- | --- |
| E1 | P0 | Hook | Rebuild `FXBentoHook.sol` with canonical Uniswap v4 `BaseHook`, `PoolManager` callbacks, permission bits, and hook address mining/deploy tests. |
| E2 | P0 | Escrow/settlement | Make `FXBentoSettlementManager` the normal and exclusive settlement finalizer for escrow roots, or explicitly define a timelocked emergency path. |
| E3 | P0 | Escrow | Fix roster accounting with active player count, per-deposit refund state, and stale-seat-resistant min/max checks. |
| E4 | P0 | Factory | Replace arbitrary status writes with a transition table: caller, from-state, to-state, time guard, invariant. |
| E5 | P0 | Settlement | Replace one-way challenge griefing with bonded challenges, adjudication, timeout, root replacement, or refund rescue. |
| E6 | P0 | Round/market | Bind anchors and settlement prices to hook/oracle snapshot ids and enforce pool `maxStaleSeconds`. |
| E7 | P0 | Commitments | Require paid active membership before commit/reveal and bind round index/grid hash to room config. |
| E8 | P0 | Prize roots | Define root schema with room id, roster, rankings, score root, settlement price root, payout total, fee total, and leftover policy. |

Auto-decision: treat the current Solidity as an MVP scaffold, not deployable paid-room code.

### Pass 2. Validation-First Engineering Sequence

Score: **5/10 → 8/10 after planned fixes**.

Because the user selected validation-first, the engineering path should be:

1. Preserve the contract boundary and document current mock limitations.
2. Build a free-play or testnet validation loop that proves room fill, board comprehension, and repeat play.
3. In parallel, harden the P0 contract invariants that protect paid-room funds.
4. Only after validation gates pass, upgrade hook deployment to canonical v4 and wire production settlement.

Validation gates before mainnet-style paid rooms:

| Gate | Success signal | Blocking risk |
| --- | --- | --- |
| Demand | Players join rooms without manual prompting. | Empty rooms make multiplayer fail. |
| Comprehension | Players can explain score, lock, reveal, refund, and claim. | Paid flow feels arbitrary. |
| Market | Selected FX/stable pool has fresh, manipulation-resistant data. | Snapshot games can be spoofed or stale. |
| Compliance | Room entry/prize wording and access model reviewed. | Product becomes regulated before validation. |
| Security | P0 contract gaps fixed and tested. | Escrow/settlement funds unsafe. |

### Pass 3. Test And Invariant Expansion

Score: **5/10 → 8/10 after planned fixes**.

New test requirements:

- Real v4 hook permissions, `PoolManager` caller restrictions, and HookMiner/CREATE2 address tests.
- Spoofed hook snapshot rejection.
- Stale snapshot rejection for anchor and settlement.
- Leave/rejoin/refund accounting and room-full behavior with leavers.
- Arbitrary status transition rejection.
- Settlement manager role wiring and direct escrow settlement bypass rejection.
- Challenge recovery, timeout, adjudication, or refund rescue.
- Non-paying player commit/reveal rejection.
- No-reveal deterministic scoring.
- Overallocated Merkle roots and order-independent payout validation.
- Multi-leaf Merkle proof cases.
- Fuzz invariant: claimed prizes + claimed fees + refundable/current escrow accounting <= escrow token balance.
- Backend auth tests for Liveblocks access and relay-only commit/reveal semantics.

The required test-plan artifact was created at:

`/Users/criptopoeta/.gstack/projects/BuFi007-fx-bento/main-autoplan-test-plan-20260516-205300.md`

### Pass 4. Backend And SDK Trust Model

Score: **4/10 → 8/10 after planned fixes**.

Required backend changes:

- Treat backend room state as event-derived or explicitly mock-only.
- Require wallet auth for Liveblocks tokens.
- Verify on-chain room membership before granting room presence.
- Make commit/reveal endpoints relay-only and idempotent.
- Sign settlement attestations with typed schemas.
- Persist room, commitment, reveal, settlement, and replay inputs.
- Add chain reorg and duplicate event handling.

Required SDK changes:

- Expose typed room lifecycle states.
- Expose typed commitment/reveal helpers and EIP-712 payload builders.
- Expose claim/refund transaction builders.
- Include validation helpers for payout root schema and UI state mapping.

### Pass 5. Security Posture

Score: **4/10 → 8/10 after planned fixes**.

P0 security posture:

- No paid rooms until escrow roster accounting, settlement authority, lifecycle transitions, challenge recovery, prize root schema, and market freshness are fixed.
- No production hook claims until `FXBentoHook.sol` is a canonical v4 hook and callback authenticity is tested.
- No trusting Liveblocks/backend for money.
- No admin room escrow withdrawal path.
- Emergency pause must not block refunds or valid claims.

### Engineering Implementation Tasks

| ID | Priority | Component | Task |
| --- | --- | --- | --- |
| E1 | P0 | `FXBentoHook.sol` | Refactor through `v4-hook-generator` into canonical `BaseHook` with authentic callbacks and tests. |
| E2 | P0 | `FXBentoRoomEscrow.sol` | Repair active roster/refund accounting and add fuzz coverage. |
| E3 | P0 | `FXBentoSettlementManager.sol` | Make settlement manager authoritative; add challenge resolution/rescue. |
| E4 | P0 | `FXBentoRoomFactory.sol` | Implement explicit room state transitions. |
| E5 | P0 | `FXBentoRoundManager.sol` | Bind rounds to valid room config and fresh market snapshots. |
| E6 | P0 | `FXBentoCommitmentManager.sol` | Bind commit/reveal to active paid entrants and configured rounds. |
| E7 | P0 | `FXBentoRoomEscrow.sol` | Define payout root schema and reject overallocated/order-dependent roots. |
| E8 | P1 | Backend | Make chain-derived state, wallet auth, Liveblocks membership checks, and typed attestation mandatory. |
| E9 | P1 | SDK | Add transaction builders and typed state/payload helpers. |
| E10 | P1 | Frontend | Align implementation to room-first lobby and board-first mobile state matrix. |

### Engineering Completion Summary

| Review Step | Result |
| --- | --- |
| Step 0 | Initial engineering score 4/10. |
| Dual voices | 10 Codex findings, 10 subagent findings, strong consensus. |
| Boundary review | Architecture is right; enforcement incomplete. |
| Contract review | Multiple P0 blockers before paid rooms. |
| Backend review | Mock-only until chain-derived and wallet-authenticated. |
| Frontend review | Needs design Phase 2 alignment. |
| Overall engineering score | 4/10 → 8/10 planned after P0 fixes. |

Decision trail update:

| # | Phase | Decision | Type | Principle | Rationale | Alternative rejected |
| --- | --- | --- | --- | --- | --- | --- |
| 6 | Eng | Treat the current Solidity as scaffold only until P0 escrow, settlement, lifecycle, and hook authenticity fixes land. | Mechanical | Safety | Current code can bypass settlement manager, spoof hook data, strand deposits, and freeze challenge flows. | Ship paid-room MVP from the scaffold. |
| 7 | Eng | Make canonical v4 hook refactor a P0 contract task, but not the only validation task. | Mechanical | Validation-first + safety | The hook must be real before market anchoring claims, while demand and UX validation should proceed in parallel on mocks/testnet. | Spend all early effort on hook hardening before proving room demand. |
| 8 | Eng | Promote backend wallet auth and chain-derived state to P1 before public beta. | Mechanical | Trust boundary | Liveblocks/backend can improve UX but must not become a money source of truth. | Let backend room state drive paid access. |

Phase 3 complete. Passing to Phase 3.5 DX review.

---

## /autoplan Phase 3.5 DX Review

### Step 0. DX Scope Assessment

Initial DX score: **5/10**.

The repo is understandable and has a small command surface, but it does not yet make the safe path obvious enough for a new contributor. The biggest DX issue is that the scaffold can look more production-ready than it is. The README says tests pass, while the engineering review found that the current contracts should be treated as validation scaffolding until P0 safety tasks land.

DX goal: make the next engineer see the architecture boundary, validation-first sequence, mock limitations, and P0 safety queue immediately.

### Developer Journey Map

| Step | Current experience | Required improvement |
| --- | --- | --- |
| Clone repo | Basic README and commands exist. | Add explicit "MVP scaffold, not paid-room deployable yet" status. |
| Understand architecture | `AGENTS.md`, `CLAUDE.md`, and architecture reference preserve the pinned boundary. | Cross-link README to architecture reference, threat model, TODOs, and test plan. |
| Run checks | `forge build`, `forge test`, and `bun run typecheck` work from package scripts. | Add a single `bun run verify` script or Makefile target. |
| Work on hook | Skill references exist in agent guidance. | Add a hook-hardening checklist that names `v4-hook-generator`, `v4-security-foundations`, and `adversarial-uniswap-hooks`. |
| Work on escrow/settlement | Contract names are clear. | Add state machine and invariant docs before code changes. |
| Work on frontend | Component inventory exists. | Add room-first and board-first acceptance criteria in README or frontend spec. |
| Work on backend | Endpoints exist. | Mark backend as mock-only until wallet auth and chain-derived state are implemented. |
| Open PR | No PR template. | Add PR checklist: contract boundary, tests run, trust boundary unchanged, paid-room safety not overclaimed. |

### Developer Empathy Narrative

A new engineer can quickly see what FX Bento is, but they can still make a dangerous wrong assumption: that passing tests mean the paid-room system is ready. The repo needs stronger "you are here" signage:

- This is a validation scaffold.
- Paid escrow is not deployable until P0 items are fixed.
- The hook is currently not canonical v4.
- Backend/Liveblocks are UX-only and mock until wallet auth plus chain-derived state exist.
- The next safest implementation step is not "add more features"; it is either validation UI or P0 contract hardening.

### DX Scorecard

| Dimension | Score | Notes |
| --- | --- | --- |
| Setup clarity | 7/10 | Commands are simple; no single verify command yet. |
| Architecture clarity | 8/10 | Pinned boundary is strong across agent docs and plan. |
| Safety clarity | 5/10 | Threat model lists limitations but README could over-signal readiness. |
| Test clarity | 6/10 | Existing tests pass; new test plan now captures missing P0 coverage. |
| Frontend clarity | 5/10 | Component names exist; acceptance criteria need to be closer to code. |
| Backend clarity | 4/10 | Mock nature and auth gaps need explicit docs. |
| Contributor workflow | 5/10 | No PR template, verify script, or state-machine docs yet. |
| Overall DX | 5/10 → 8/10 planned | Good bones, needs guardrails. |

### Time To Hello World Assessment

Target TTHW:

- Contracts: under 5 minutes to run `forge test`.
- TypeScript: under 5 minutes to run `bun run typecheck`.
- Backend: under 10 minutes to start Hono locally.
- Frontend component preview: not yet defined.

Current blockers:

- No single verification command.
- No frontend preview/dev app command.
- No environment template for Liveblocks or backend auth.
- No "mock vs production" matrix.
- No hook deployment/mining guide.

### DX Implementation Checklist

| ID | Priority | File/Area | Task |
| --- | --- | --- | --- |
| DX1 | P0 | `README.md` | Add status banner: validation scaffold, not paid-room deployable until P0 contract tasks pass. |
| DX2 | P0 | `README.md` | Link architecture reference, threat model, TODOs, and test-plan artifact. |
| DX3 | P0 | `package.json` | Add `verify` script that runs `forge fmt --check`, `forge build`, `forge test`, and `bun run typecheck`. |
| DX4 | P0 | `docs/` | Add room lifecycle state-machine doc before implementing lifecycle code. |
| DX5 | P0 | `docs/` | Add payout root schema doc before changing settlement claims. |
| DX6 | P1 | `.github/` | Add PR template with boundary and verification checklist. |
| DX7 | P1 | Backend docs | Add `.env.example` and mark mock-only endpoints. |
| DX8 | P1 | Frontend docs | Add room-first, board-first, and state-matrix acceptance criteria near components. |
| DX9 | P1 | Hook docs | Add canonical v4 hook deployment/mining notes after refactor. |

### DX Auto-Decisions

- Add a repo-level TODO list now so deferred scope is not lost.
- Keep implementation paused until the final approval gate because the next move can reasonably be either validation UI or contract hardening.
- Prefer a single `verify` command in the next repo-quality pass.
- Make README status more conservative before any public share.

### DX Completion Summary

| Review Step | Result |
| --- | --- |
| Step 0 | Initial DX score 5/10. |
| Journey map | 8 contributor steps mapped. |
| Empathy narrative | Main risk is false production-readiness. |
| Scorecard | Overall DX 5/10 → 8/10 planned. |
| TTHW | Contracts/TS okay; frontend preview and env docs missing. |
| Checklist | 9 DX tasks added. |

Decision trail update:

| # | Phase | Decision | Type | Principle | Rationale | Alternative rejected |
| --- | --- | --- | --- | --- | --- | --- |
| 9 | DX | Make README status more conservative before public use. | Mechanical | Clarity + safety | Current scaffold has passing tests but known P0 paid-room blockers. | Let README imply deployable MVP. |
| 10 | DX | Add one repo verification command in the next quality pass. | Mechanical | Pragmatic | Reduces mistakes and gives agents/contributors a common finish line. | Keep separate commands only. |
| 11 | DX | Pause implementation until approval gate chooses validation UI vs contract hardening. | Taste | Validation-first | Both paths are defensible; user chose validation-first, but the final gate should confirm scope. | Start refactoring contracts immediately without gate. |

Phase 3.5 complete.

---

## /autoplan Final Gate

### Recommended Plan

Approve the validation-first plan with this execution order:

1. Repo-quality pass: conservative README status, `verify` script, PR checklist, lifecycle/root-schema docs.
2. Validation UI pass: room-first lobby, board-first active round, full state matrix, result explainability, free-play/testnet-ready flow.
3. Contract P0 pass: canonical v4 hook, escrow roster accounting, settlement-manager authority, lifecycle state machine, market freshness, payout root schema, challenge rescue.
4. Backend/SDK pass: wallet auth, chain-derived state, typed EIP-712 helpers, Liveblocks membership checks.
5. Security/invariant pass: Foundry fuzz/invariants, adversarial hook review, threat model update.

### Approval Options

| Option | Meaning |
| --- | --- |
| A | Approve as-is. Start with repo-quality pass, then validation UI. |
| B | Approve with overrides. Provide changes to order or scope. |
| B2 | Approve with user challenge responses. Keep plan but answer the remaining prototype questions first. |
| C | Interrogate. Ask more hard questions before implementing. |
| D | Revise. Rewrite plan around a different first milestone. |
| E | Reject. Stop autoplan output and return to direct implementation requests. |
