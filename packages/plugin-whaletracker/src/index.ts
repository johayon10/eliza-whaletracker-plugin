import { elizaLogger } from "@ai16z/eliza";
import {
    Action,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    Plugin,
    State,
    Handler,
    ActionExample,
} from "@ai16z/eliza";

import { WalletTracker } from "./walletTracker";

interface WhaleTrackerConfig {
    HELIUS_API_KEY: string;
    RPC_ENDPOINT: string;
    ANTHROPIC_API_KEY: string;
    WALLET_ADDRESSES: string;
    analysisInterval?: number;
    historyWindow?: number;
}

interface WhaleTrackerState {
    config: WhaleTrackerConfig;
}

// Extend the State type from @ai16z/eliza
declare module "@ai16z/eliza" {
    interface State {
        plugins: {
            whaleTracker?: WhaleTrackerState;
        };
    }
}

const whaleTracker: Action = {
    name: "WHALE_TRACKER",
    similes: [
        "TRACK_WHALE_WALLETS",
        "MONITOR_WALLET_ACTIVITY",
        "ANALYZE_WALLET_TRANSACTIONS",
    ],
    description:
        "Tracks whale wallet activity on the Solana blockchain and provides insights.",
    validate: async (runtime: IAgentRuntime, message: Memory) => true,
    handler: (async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State | undefined,
        options: any,
        callback: HandlerCallback
    ) => {
        elizaLogger.log("Whale tracker action triggered");

        try {
            const pluginConfig = state?.plugins?.whaleTracker?.config;

            if (!pluginConfig) {
                throw new Error(
                    "Whale tracker plugin configuration not found in state"
                );
            }

            const tracker = new WalletTracker({
                heliusApiKey: pluginConfig.HELIUS_API_KEY,
                rpcEndpoint: pluginConfig.RPC_ENDPOINT,
                anthropicApiKey: pluginConfig.ANTHROPIC_API_KEY,
                walletAddresses: pluginConfig.WALLET_ADDRESSES,
                analysisInterval: pluginConfig.analysisInterval,
                historyWindow: pluginConfig.historyWindow,
            });

            await tracker.start();

            // Get initial analysis
            const initialAnalysis = await tracker.getLatestAnalysis();
            callback({
                text: `🐋 Whale tracker activated!\n${JSON.stringify(initialAnalysis, null, 2)}`,
            });

            // Set up periodic updates
            setInterval(async () => {
                const analysis = await tracker.getLatestAnalysis();
                if (analysis) {
                    callback({
                        text: `🔍 Latest Whale Activity:\n${JSON.stringify(analysis, null, 2)}`,
                    });
                }
            }, 300000); // 5 minutes
        } catch (error) {
            elizaLogger.error("Error in whale tracker:", error);
            callback({
                text: "Error starting whale tracker. Please check configuration and try again.",
            });
        }
    }) as Handler,
    examples: [
        [
            {
                user: "user",
                content: {
                    text: "Track whale movements",
                },
            },
            {
                user: "assistant",
                content: {
                    text: "Starting whale wallet tracking. I'll monitor significant movements and alert you of any interesting patterns.",
                },
            },
        ],
        [
            {
                user: "user",
                content: {
                    text: "What are the whales doing?",
                },
            },
            {
                user: "assistant",
                content: {
                    text: "Analyzing recent whale wallet activity. Let me check the latest transactions...",
                },
            },
        ],
    ],
};

export const whaleTrackerPlugin: Plugin = {
    name: "whaleTracker",
    description: "Whale Wallet Tracker",
    actions: [whaleTracker],
    evaluators: [],
    providers: [],
};

export default whaleTrackerPlugin;
