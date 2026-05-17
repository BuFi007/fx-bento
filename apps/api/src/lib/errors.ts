import type { Context } from "hono";

import { errorHandler } from "@bufinance/worker-base";

const DOMAIN_ERROR_STATUS: Record<string, 400 | 401 | 403 | 404 | 409 | 422 | 503> = {
  bad_signature: 401,
  bad_player_limits: 422,
  bad_payout_split: 422,
  commitment_already_exists: 409,
  contract_room_state_mismatch: 409,
  deadline_expired: 422,
  dev_simulator_disabled: 403,
  duplicate_tile: 422,
  horizontal_wall: 422,
  indexed_room_state_mismatch: 409,
  invalid_tile_count: 422,
  leverage_too_high: 422,
  margin_quote_mismatch: 422,
  min_players_not_met: 409,
  missing_commitment: 409,
  nonce_reused: 409,
  player_not_in_room: 403,
  ponder_read_source_not_configured: 503,
  room_already_settled: 409,
  room_cancelled: 409,
  room_full: 409,
  room_not_active: 409,
  room_not_found: 404,
  room_not_joinable: 409,
  round_out_of_bounds: 422,
  rows_cols_length_mismatch: 422,
  selection_already_revealed: 409,
  too_many_tiles_in_row: 422,
};

export function apiErrorHandler(error: Error, c: Context): Response {
  const status =
    DOMAIN_ERROR_STATUS[error.message] ??
    (error.message.startsWith("Unsupported ") ? 404 : undefined) ??
    (error.message.startsWith("missing_contract_address:") ? 422 : undefined);

  if (status) {
    return c.json(
      {
        success: false,
        error: {
          code: error.message.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_"),
          message: error.message,
          requestId: c.get("requestId"),
        },
      },
      status
    );
  }

  return errorHandler(error, c);
}
