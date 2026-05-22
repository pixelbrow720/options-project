/**
 * Helper to post a summary message to the configured Discord webhook via the
 * backend's relay endpoint. The relay endpoint may not exist yet — that's
 * fine; we log a console.warn on 404 instead of throwing so callers (e.g.
 * "Share to Discord" buttons) remain non-fatal.
 */

import axios from "axios";
import { api } from "@/lib/api";

export interface DiscordWebhookField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordWebhookPayload {
  symbol: string;
  message: string;
  fields?: DiscordWebhookField[];
}

const DISCORD_POST_PATH = "/public/discord/post";

export async function postDiscordSummary(
  payload: DiscordWebhookPayload,
): Promise<void> {
  try {
    await api.post(DISCORD_POST_PATH, payload);
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      console.warn(
        `[discord-webhook] ${DISCORD_POST_PATH} returned 404 — relay endpoint not yet deployed. Payload dropped.`,
        { symbol: payload.symbol },
      );
      return;
    }
    throw err;
  }
}
