import { Connection, PublicKey } from "@solana/web3.js";
import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import { elizaLogger } from "@ai16z/eliza";

interface Transaction {
    signature: string;
    type: string;
    timestamp: number;
    tokenAddress?: string;
    amount?: number;
    price?: number;
    wallet: string;
}

interface HeliusTransaction {
    signature: string;
    type: string;
    timestamp: number;
    tokenTransfers?: {
        token: {
            address: string;
        };
        amount: number;
    }[];
    nativeTransfers?: {
        amount: number;
    }[];
}

interface HeliusResponse {
    data: HeliusTransaction[];
}

export class WalletTracker {
    private connection: Connection;
    private anthropic: Anthropic;
    private transactionHistory: Transaction[] = [];
    private wallets: string[];
    private lastAnalysis: number = 0;
    private lastAnalysisResult: any = null;
    private readonly ANALYSIS_INTERVAL = 15 * 60 * 1000;
    private readonly HISTORY_WINDOW = 3 * 60 * 60 * 1000;
    private heliusApiKey: string;

    constructor(config: {
        heliusApiKey: string;
        rpcEndpoint: string;
        anthropicApiKey: string;
        walletAddresses: string;
        analysisInterval?: number;
        historyWindow?: number;
    }) {
        this.heliusApiKey = config.heliusApiKey;
        const rpcUrl = new URL(config.rpcEndpoint);
        rpcUrl.searchParams.append("api-key", config.heliusApiKey);

        this.connection = new Connection(rpcUrl.toString());
        this.anthropic = new Anthropic({
            apiKey: config.anthropicApiKey,
        });

        this.wallets = config.walletAddresses
            .split(",")
            .map((addr) => addr.trim());
        this.ANALYSIS_INTERVAL = config.analysisInterval || 15 * 60 * 1000;
        this.HISTORY_WINDOW = config.historyWindow || 3 * 60 * 60 * 1000;

        elizaLogger.log(`Monitoring ${this.wallets.length} wallets`);
    }

    async start() {
        elizaLogger.log("Starting whale tracker...");

        // Initial fetch and analysis
        await this.fetchAndAnalyzeTransactions();

        // Set up periodic fetching and analysis
        setInterval(async () => {
            await this.fetchAndAnalyzeTransactions();
        }, this.ANALYSIS_INTERVAL);

        elizaLogger.log("Whale tracker started successfully");
    }

    async getLatestAnalysis() {
        if (Date.now() - this.lastAnalysis < this.ANALYSIS_INTERVAL) {
            return this.lastAnalysisResult;
        }
        return await this.fetchAndAnalyzeTransactions();
    }

    private async fetchAndAnalyzeTransactions() {
        elizaLogger.log("\n=== Starting new fetch cycle ===");
        elizaLogger.log("Time:", new Date().toLocaleString());

        try {
            // Clear old transactions outside history window
            const cutoffTime = Date.now() - this.HISTORY_WINDOW;
            this.transactionHistory = this.transactionHistory.filter(
                (tx) => tx.timestamp > cutoffTime
            );

            // Fetch new transactions for each wallet
            for (const wallet of this.wallets) {
                const response = await axios.get<HeliusResponse>(
                    `https://api.helius.xyz/v0/addresses/${wallet}/transactions`,
                    { params: { "api-key": this.heliusApiKey } }
                );

                const newTransactions = response.data.data
                    .filter((tx) => tx.timestamp * 1000 > cutoffTime)
                    .map((tx) => ({
                        signature: tx.signature,
                        type: tx.type,
                        timestamp: tx.timestamp * 1000,
                        tokenAddress: tx.tokenTransfers?.[0]?.token?.address,
                        amount:
                            tx.tokenTransfers?.[0]?.amount ||
                            tx.nativeTransfers?.[0]?.amount,
                        wallet,
                    }));

                this.transactionHistory.push(...newTransactions);
            }

            // Analyze transactions
            const analysis = {
                timestamp: new Date().toISOString(),
                transactionCount: this.transactionHistory.length,
                transactions: this.transactionHistory
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .slice(0, 10),
            };

            this.lastAnalysis = Date.now();
            this.lastAnalysisResult = analysis;

            elizaLogger.log("Analysis complete:", analysis);
            return analysis;
        } catch (error) {
            elizaLogger.error("Error in fetchAndAnalyzeTransactions:", error);
            return null;
        }
    }
}
