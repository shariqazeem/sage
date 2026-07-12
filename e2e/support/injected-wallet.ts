import type { Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex, type Hex } from "viem";

/**
 * A deterministic injected EIP-1193 wallet for the founder-deployment E2E. It produces
 * REAL signatures (SIWE personal_sign + the EIP-712 plan-claim) using a known test key —
 * so the server's cryptographic verification genuinely passes — but it never touches a
 * chain: transactions return a deterministic fake hash, and the server verifies the
 * "receipt" through its SAGE_E2E fake chain (derived from the durable deployment row).
 *
 * Signing runs in the Node test process via page.exposeFunction; window.ethereum is a thin
 * shim installed via addInitScript that forwards every request to it. `capabilities`
 * toggles a truthful EIP-5792 answer so the sequential AND batch paths can both be tested.
 */

// Well-known anvil test key #0 (NOT a secret). Address 0xf39Fd6…2266.
export const FOUNDER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const METIS_SEPOLIA_HEX = "0xe9fe"; // 59902

export interface InjectedWalletOptions {
  privateKey?: Hex;
  /** advertise EIP-5792 wallet_sendCalls support (default false → sequential path). */
  supportsBatch?: boolean;
  /** reject the Nth eth_sendTransaction (1-based) to simulate a declined confirmation. */
  rejectTxIndex?: number;
}

export async function installInjectedWallet(page: Page, opts: InjectedWalletOptions = {}): Promise<string> {
  const account = privateKeyToAccount(opts.privateKey ?? FOUNDER_KEY);
  let txCount = 0;

  await page.exposeFunction("__sageWalletRpc", async (method: string, params: unknown[]): Promise<unknown> => {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "eth_chainId":
        return METIS_SEPOLIA_HEX;
      case "net_version":
        return "59902";
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain":
        return null;
      case "wallet_getCapabilities": {
        // Truthful EIP-5792 answer. Empty (or no atomic) → the UI uses the sequential path.
        if (!opts.supportsBatch) return {};
        return { [METIS_SEPOLIA_HEX]: { atomic: { status: "supported" } } };
      }
      case "personal_sign": {
        const [a, b] = params as [string, string];
        const message = isAddress(a) ? b : a;
        return account.signMessage({ message: { raw: message as Hex } });
      }
      case "eth_signTypedData_v4": {
        const raw = (params as string[]).find((p) => typeof p === "string" && p.trim().startsWith("{"));
        const typed = JSON.parse(raw as string) as {
          domain: Record<string, unknown>;
          types: Record<string, { name: string; type: string }[]>;
          primaryType: string;
          message: Record<string, unknown>;
        };
        const types = { ...typed.types };
        delete types.EIP712Domain;
        // Coerce integer fields back to bigint (JSON stringified them).
        const fields = types[typed.primaryType] ?? [];
        const message: Record<string, unknown> = { ...typed.message };
        for (const f of fields) {
          if (/^u?int/.test(f.type) && message[f.name] != null) message[f.name] = BigInt(message[f.name] as string);
        }
        const domain = { ...typed.domain };
        if (domain.chainId != null) domain.chainId = Number(domain.chainId);
        const signArgs = { domain, types, primaryType: typed.primaryType, message } as unknown as Parameters<typeof account.signTypedData>[0];
        return account.signTypedData(signArgs);
      }
      case "eth_sendTransaction": {
        txCount += 1;
        if (opts.rejectTxIndex && txCount === opts.rejectTxIndex) {
          throw Object.assign(new Error("User rejected the request."), { code: 4001 });
        }
        // Deterministic fake hash from the calldata + counter (no chain).
        const tx = (params as Array<{ to?: string; data?: string }>)[0] ?? {};
        return keccak256(toHex(`${tx.to ?? ""}:${tx.data ?? ""}:${txCount}`));
      }
      case "wallet_sendCalls": {
        txCount += 1;
        return { id: keccak256(toHex(`batch:${txCount}`)) };
      }
      case "wallet_getCallsStatus":
        return { status: "CONFIRMED", receipts: [] };
      case "eth_getBalance":
        return "0xde0b6b3a7640000"; // 1 ETH-equivalent for gas
      default:
        return null;
    }
  });

  await page.addInitScript(() => {
    const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
    const provider = {
      isMetaMask: true,
      request: ({ method, params }: { method: string; params?: unknown[] }) =>
        (window as unknown as { __sageWalletRpc: (m: string, p: unknown[]) => Promise<unknown> }).__sageWalletRpc(method, params ?? []),
      on: (event: string, cb: (...a: unknown[]) => void) => {
        (listeners[event] ??= []).push(cb);
      },
      removeListener: (event: string, cb: (...a: unknown[]) => void) => {
        listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb);
      },
    };
    Object.defineProperty(window, "ethereum", { value: provider, writable: true, configurable: true });
  });

  return account.address;
}

function isAddress(v: string): boolean {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}
