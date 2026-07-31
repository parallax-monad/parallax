import type { TokenRef } from "@/lib/types";

/**
 * Wallet abstraction (Model layer).
 *
 * The app never signs or broadcasts. A connected wallet is only used to:
 *  - provide the real `from` address so simulation reflects real account state
 *  - read balances (insufficient balance is a transaction risk)
 *  - read existing token approvals for the transaction-risk dimension
 *
 * Swapping in a real EIP-1193 / wagmi provider later only requires implementing
 * this same interface; the ViewModel and View do not change.
 */
export interface WalletAccount {
  address: string;
  chainId: number;
  label: string;
  isMock: boolean;
}

export interface WalletContext {
  tokenBalance: string | null;
  existingAllowance: string | null;
  allowanceIsUnlimited: boolean;
}

export interface WalletService {
  connect(): Promise<WalletAccount>;
  disconnect(): Promise<void>;
  getAccount(): WalletAccount | null;
  getTokenBalance(token: TokenRef): Promise<string | null>;
  getContext(token: TokenRef, spender: string): Promise<WalletContext>;
}

const MOCK_ACCOUNT: WalletAccount = {
  address: "0x1111111111111111111111111111111111111111",
  chainId: 10143,
  label: "Mock wallet",
  isMock: true,
};

/**
 * Deterministic mock balances/allowances keyed by token symbol, so demo flows
 * can exercise the insufficient-balance and unlimited-approval risk rules
 * without a live provider. Values are clearly synthetic.
 */
const MOCK_BALANCES: Record<string, string> = { MON: "5000", USDC: "250" };
const MOCK_ALLOWANCES: Record<string, { amount: string; unlimited: boolean }> = {
  MON: { amount: "0", unlimited: false },
};

class MockWalletService implements WalletService {
  private account: WalletAccount | null = null;

  async connect(): Promise<WalletAccount> {
    this.account = MOCK_ACCOUNT;
    return this.account;
  }

  async disconnect(): Promise<void> {
    this.account = null;
  }

  getAccount(): WalletAccount | null {
    return this.account;
  }

  async getTokenBalance(token: TokenRef): Promise<string | null> {
    return MOCK_BALANCES[token.symbol] ?? null;
  }

  async getContext(token: TokenRef): Promise<WalletContext> {
    const allowance = MOCK_ALLOWANCES[token.symbol];
    return {
      tokenBalance: MOCK_BALANCES[token.symbol] ?? null,
      existingAllowance: allowance?.amount ?? null,
      allowanceIsUnlimited: allowance?.unlimited ?? false,
    };
  }
}

export const walletService: WalletService = new MockWalletService();
