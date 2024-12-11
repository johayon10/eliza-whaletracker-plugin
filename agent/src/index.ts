import { PostgresDatabaseAdapter } from "@ai16z/adapter-postgres";
import { SqliteDatabaseAdapter } from "@ai16z/adapter-sqlite";
import { DirectClientInterface } from "@ai16z/client-direct";
import { DiscordClientInterface } from "@ai16z/client-discord";
import { AutoClientInterface } from "@ai16z/client-auto";
import { TelegramClientInterface } from "@ai16z/client-telegram";
import { TwitterClientInterface } from "@ai16z/client-twitter";
import {
    DbCacheAdapter,
    defaultCharacter,
    FsCacheAdapter,
    ICacheManager,
    IDatabaseCacheAdapter,
    stringToUuid,
    AgentRuntime,
    CacheManager,
    Character,
    IAgentRuntime,
    ModelProviderName,
    elizaLogger,
    settings,
    IDatabaseAdapter,
    validateCharacterConfig,
} from "@ai16z/eliza";
import { bootstrapPlugin } from "@ai16z/plugin-bootstrap";
import { solanaPlugin } from "@ai16z/plugin-solana";
import { nodePlugin } from "@ai16z/plugin-node";
import { coinbaseCommercePlugin } from "@ai16z/plugin-coinbase";
import Database from "better-sqlite3";
import fs from "fs";
import readline from "readline";
import yargs from "yargs";
import path from "path";
import { fileURLToPath } from "url";
import { character } from "./character.ts";
import type { DirectClient } from "@ai16z/client-direct";
import { imageGenerationPlugin } from "@ai16z/plugin-image-generation";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

export const wait = (minTime: number = 1000, maxTime: number = 3000) => {
    const waitTime =
        Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
    return new Promise((resolve) => setTimeout(resolve, waitTime));
};

export function parseArguments(): {
    character?: string;
    characters?: string;
} {
    try {
        return yargs(process.argv.slice(2))
            .option("character", {
                type: "string",
                description: "Path to the character JSON file",
            })
            .option("characters", {
                type: "string",
                description:
                    "Comma separated list of paths to character JSON files",
            })
            .parseSync();
    } catch (error) {
        console.error("Error parsing arguments:", error);
        return {};
    }
}

export async function loadCharacters(
    charactersArg: string
): Promise<Character[]> {
    let characterPaths = charactersArg?.split(",").map((filePath) => {
        if (path.basename(filePath) === filePath) {
            filePath = "../characters/" + filePath;
        }
        return path.resolve(process.cwd(), filePath.trim());
    });

    const loadedCharacters = [];

    if (characterPaths?.length > 0) {
        for (const path of characterPaths) {
            try {
                const character = JSON.parse(fs.readFileSync(path, "utf8"));
                validateCharacterConfig(character);

                loadedCharacters.push(character);
            } catch (e) {
                console.error(`Error loading character from ${path}: ${e}`);
                process.exit(1);
            }
        }
    }

    if (loadedCharacters.length === 0) {
        console.log("No characters found, using default character");
        loadedCharacters.push(defaultCharacter);
    }

    return loadedCharacters;
}

export function getTokenForProvider(
    provider: ModelProviderName,
    character: Character
) {
    switch (provider) {
        case ModelProviderName.OPENAI:
            return (
                character.settings?.secrets?.OPENAI_API_KEY ||
                settings.OPENAI_API_KEY
            );
        case ModelProviderName.LLAMACLOUD:
            return (
                character.settings?.secrets?.LLAMACLOUD_API_KEY ||
                settings.LLAMACLOUD_API_KEY ||
                character.settings?.secrets?.TOGETHER_API_KEY ||
                settings.TOGETHER_API_KEY ||
                character.settings?.secrets?.XAI_API_KEY ||
                settings.XAI_API_KEY ||
                character.settings?.secrets?.OPENAI_API_KEY ||
                settings.OPENAI_API_KEY
            );
        case ModelProviderName.ANTHROPIC:
            return (
                character.settings?.secrets?.ANTHROPIC_API_KEY ||
                character.settings?.secrets?.CLAUDE_API_KEY ||
                settings.ANTHROPIC_API_KEY ||
                settings.CLAUDE_API_KEY
            );
        case ModelProviderName.REDPILL:
            return (
                character.settings?.secrets?.REDPILL_API_KEY ||
                settings.REDPILL_API_KEY
            );
        case ModelProviderName.OPENROUTER:
            return (
                character.settings?.secrets?.OPENROUTER ||
                settings.OPENROUTER_API_KEY
            );
        case ModelProviderName.GROK:
            return (
                character.settings?.secrets?.GROK_API_KEY ||
                settings.GROK_API_KEY
            );
        case ModelProviderName.HEURIST:
            return (
                character.settings?.secrets?.HEURIST_API_KEY ||
                settings.HEURIST_API_KEY
            );
        case ModelProviderName.GROQ:
            return (
                character.settings?.secrets?.GROQ_API_KEY ||
                settings.GROQ_API_KEY
            );
    }
}

function initializeDatabase(dataDir: string) {
    if (process.env.POSTGRES_URL) {
        const db = new PostgresDatabaseAdapter({
            connectionString: process.env.POSTGRES_URL,
        });
        return db;
    } else {
        const filePath =
            process.env.SQLITE_FILE ?? path.resolve(dataDir, "db.sqlite");
        // ":memory:";
        const db = new SqliteDatabaseAdapter(new Database(filePath));
        return db;
    }
}

export async function initializeClients(
    character: Character,
    runtime: IAgentRuntime
) {
    const clients = [];
    const clientTypes =
        character.clients?.map((str) => str.toLowerCase()) || [];

    if (clientTypes.includes("auto")) {
        const autoClient = await AutoClientInterface.start(runtime);
        if (autoClient) clients.push(autoClient);
    }

    if (clientTypes.includes("discord")) {
        clients.push(await DiscordClientInterface.start(runtime));
    }

    if (clientTypes.includes("telegram")) {
        const telegramClient = await TelegramClientInterface.start(runtime);
        if (telegramClient) clients.push(telegramClient);
    }

    if (clientTypes.includes("twitter")) {
        const twitterClients = await TwitterClientInterface.start(runtime);
        clients.push(twitterClients);
    }

    if (character.plugins?.length > 0) {
        for (const plugin of character.plugins) {
            if (plugin.clients) {
                for (const client of plugin.clients) {
                    clients.push(await client.start(runtime));
                }
            }
        }
    }

    return clients;
}

export async function createAgent(
    character: Character,
    db: IDatabaseAdapter,
    cache: ICacheManager,
    token: string
) {
    elizaLogger.success(
        elizaLogger.successesTitle,
        "Creating runtime for character",
        character.name
    );

    const plugins = [
        imageGenerationPlugin,
        bootstrapPlugin,
        nodePlugin,
        character.settings.secrets?.WALLET_PUBLIC_KEY ? solanaPlugin : null,
        character.settings.secrets?.COINBASE_COMMERCE_KEY ||
        process.env.COINBASE_COMMERCE_KEY
            ? coinbaseCommercePlugin
            : null,
    ].filter(Boolean);

    console.log(
        "Loading plugins:",
        plugins.map((p) => p.name)
    );

    return new AgentRuntime({
        databaseAdapter: db,
        token,
        modelProvider: character.modelProvider,
        evaluators: [],
        character,
        plugins,
        providers: [],
        actions: [],
        services: [],
        managers: [],
        cacheManager: cache,
    });
}

function intializeFsCache(baseDir: string, character: Character) {
    const cacheDir = path.resolve(baseDir, character.id, "cache");

    const cache = new CacheManager(new FsCacheAdapter(cacheDir));
    return cache;
}

function intializeDbCache(character: Character, db: IDatabaseCacheAdapter) {
    const cache = new CacheManager(new DbCacheAdapter(db, character.id));
    return cache;
}

async function startAgent(character: Character, directClient: DirectClient) {
    try {
        character.id ??= stringToUuid(character.name);
        character.username ??= character.name;

        const token = getTokenForProvider(character.modelProvider, character);
        const dataDir = path.join(__dirname, "../data");

        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const db = initializeDatabase(dataDir);

        await db.init();

        const cache = intializeDbCache(character, db);
        const runtime = await createAgent(character, db, cache, token);

        await runtime.initialize();

        const clients = await initializeClients(character, runtime);

        directClient.registerAgent(runtime);

        return clients;
    } catch (error) {
        elizaLogger.error(
            `Error starting agent for character ${character.name}:`,
            error
        );
        console.error(error);
        throw error;
    }
}

const startAgents = async () => {
    const directClient = await DirectClientInterface.start();
    const args = parseArguments();

    let charactersArg = args.characters || args.character;

    let characters = [character];

    if (charactersArg) {
        characters = await loadCharacters(charactersArg);
    }

    try {
        for (const character of characters) {
            await startAgent(character, directClient as DirectClient);
        }
        elizaLogger.log("Discord bot started and ready to chat!");
    } catch (error) {
        elizaLogger.error("Error starting agents:", error);
    }
};

startAgents().catch((error) => {
    elizaLogger.error("Unhandled error in startAgents:", error);
    process.exit(1); // Exit the process after logging
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

rl.on("SIGINT", () => {
    rl.close();
    process.exit(0);
});

async function handleUserInput(input: string, agentId: string) {
    if (input.toLowerCase() === "exit") {
        rl.close();
        process.exit(0);
        return;
    }

    try {
        const serverPort = parseInt(settings.SERVER_PORT || "3000");

        const response = await fetch(
            `http://localhost:${serverPort}/${agentId}/message`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    text: input,
                    userId: "user",
                    userName: "User",
                    content: {
                        text: input,
                        action: "GENERATE_IMAGE",
                        actionInput: `Surreal digital art interpretation: ${input}`,
                    },
                }),
            }
        );

        const data = await response.json();
        data.forEach((message: any) => {
            console.log(`Agent: ${message.text}`);

            // Log all message properties for debugging
            console.log("Message content:", message.content);
            console.log("Message attachments:", message.attachments);

            // Check for image generation in message
            if (message.content?.action === "GENERATE_IMAGE") {
                console.log("Generating image...");
                if (message.content.actionInput) {
                    console.log(`Image Prompt: ${message.content.actionInput}`);
                }
                if (message.content.imageUrl) {
                    console.log(
                        `Generated Image URL: ${message.content.imageUrl}`
                    );
                }
            }

            // Check for attachments
            if (message.attachments?.length > 0) {
                message.attachments.forEach((attachment: any) => {
                    console.log(`Generated Image: ${attachment.url}`);
                });
            }
        });
    } catch (error) {
        console.error("Error fetching response:", error);
    }
}
