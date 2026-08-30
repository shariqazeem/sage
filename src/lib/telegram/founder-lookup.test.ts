import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FINDING THE FOUNDER, WHICHEVER CHAIN THEY CAME FROM.
 *
 * `founderChatId` wrapped its lookup in viem's `getAddress`, which THROWS on a Starknet felt —
 * swallowed by an existing try/catch, so a founder who launched from a Starknet wallet was simply
 * unfindable and no log said why. That is the same shape as the three identity lockouts.
 *
 * It bought nothing either way: the query already matches on `lower(...)`, so checksum casing was
 * never load-bearing. Only the throw was.
 *
 * NOT a live outage when it was found — no Starknet campaign has a Telegram-bound founder today,
 * because the walletless path launches on GOAT. These pin the lookup for when one does, and pin
 * the half that must NOT change: every existing EVM row is queried byte-for-byte as before.
 */

const getAgentWalletByAddress = vi.fn((_a: string) => null as { chatId: string } | null);
const sendTelegram = vi.fn(async (_chatId: string, _text: string, _opts?: { html?: boolean }) => true);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/agent-wallets", () => ({
  getAgentWalletByAddress: (a: string) => getAgentWalletByAddress(a),
}));
vi.mock("@/lib/db/recipient-wallets", () => ({ getRecipientWalletByAddress: () => null }));
vi.mock("@/lib/db/campaigns", () => ({ getMissionByHash: () => null }));
vi.mock("./bot", () => ({
  sendTelegram: (...a: unknown[]) => sendTelegram(...(a as [string, string])),
}));

import type { Campaign, Submission } from "@/lib/db/schema";
import { notifyFounderSettled } from "./founder-notify";

const EVM = "0x3a60af43c67dd9d552f180d30d9a042948078341";
/** The user's Ready wallet: a felt, 64 hex digits, with a leading zero. */
const FELT = "0x04F1f6530F84e4A1DB7fa35bAFc313174A2482A54c775C4321487Eb0fE91f434";

const campaign = (posterWallet: string) =>
  ({ id: "c1", title: "T", posterWallet, chainId: 2345, rewardAmount: 500000 }) as unknown as Campaign;
const submission = { id: "s1", wallet: "0xbeef", missionIdHash: null } as unknown as Submission;
const outcome = {
  settled: true, txHash: "0xtx", amountBase: 500000,
  recipient: "0x1111111111111111111111111111111111111111",
} as never;

beforeEach(() => {
  getAgentWalletByAddress.mockClear();
  sendTelegram.mockClear();
});

describe("resolving the founder's chat", () => {
  it("queries an EVM address exactly as it is stored — byte-for-byte, padding intact", async () => {
    // One address in sixteen begins with a zero. Stripping it would orphan those founders.
    const padded = "0x0a60af43c67dd9d552f180d30d9a042948078341";
    await notifyFounderSettled(campaign(padded), submission, outcome);
    expect(getAgentWalletByAddress).toHaveBeenCalledWith(padded);
  });

  it("lower-cases a mixed-case EVM address, which is how rows are written", async () => {
    await notifyFounderSettled(campaign("0x3A60Af43C67dD9d552F180d30D9a042948078341"), submission, outcome);
    expect(getAgentWalletByAddress).toHaveBeenCalledWith(EVM);
  });

  it("does not throw on a Starknet felt — it looks it up", async () => {
    await notifyFounderSettled(campaign(FELT), submission, outcome);
    expect(getAgentWalletByAddress).toHaveBeenCalledTimes(1);
    // Normalised the way a felt is STORED: lower case, leading zeros stripped.
    expect(getAgentWalletByAddress).toHaveBeenCalledWith(
      "0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434",
    );
  });

  it("stays silent when no chat is bound, rather than erroring", async () => {
    getAgentWalletByAddress.mockReturnValue(null);
    await notifyFounderSettled(campaign(FELT), submission, outcome);
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("DMs the founder with the proof link once a chat IS bound", async () => {
    getAgentWalletByAddress.mockReturnValue({ chatId: "2105571539" });
    await notifyFounderSettled(campaign(FELT), submission, outcome);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(String(sendTelegram.mock.calls[0]![1])).toMatch(/proof\/0xtx/);
  });
});
