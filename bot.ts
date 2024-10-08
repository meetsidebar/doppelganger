import { App, LogLevel, GenericMessageEvent } from '@slack/bolt';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';

const whoami= process.argv[2];
const dotenv_path = whoami ? `.env.${whoami}` : '.env'

dotenv.config({ path: dotenv_path });

const ROLE = process.env.ROLE || 'software developer';

const app = new App({
    token: process.env.SLACK_USER_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,

    // allows receiving events locally without public URL
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
    logLevel: LogLevel.INFO,
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const TAG_INSTRUCTION = "If you want to tag a user from the conversation, use the syntax <@USER_ID>.";

async function generateChatGPTResponse(context: string): Promise<string | null> {
    const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
            { role: 'system', content: `You are a ${ROLE}. A real team member.` },
            {
                role: 'assistant', content: `
        Respond with a slack message response that fits the entire conversation.
        Pay attention to any asks of you or questions that aren't adequately answered. Prioritize more recent messages.
        Don't explain that you'll respond, simply respond as if you were in the Slack conversation.
        Avoid overly generic responses. Be professional, yet casual. Don't be robotic. You're discussing with peers.
        If the conversation has reached a natural end, reply with only one word: end.
      `.trim().replace(/ +/g, ' ')
            },
            { role: 'user', content: context }
        ],
    });
    const response = completion.choices[0]?.message.content || null;
    if (response?.trim() == "end") {
        return null;
    }
    return response
}

function getRandomDelay(min_sec: number = 30, max_sec: number = 180): number {
    return 1000 * Math.floor(Math.random() * (max_sec - min_sec + 1)) + min_sec;
}

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isTextMessage(message: any): message is GenericMessageEvent & { text: string } {
    return typeof message.text === 'string';
}

// Respond to direct messages
app.message(async ({ message, say }) => {
    console.log(`Message event in ${message.channel_type} ${message.channel}: ${(message as any)?.text}`)

    let prompt;
    if (message.channel_type == 'im') {
        /// Prompt for IMs
        const context = await getLlmContext(message.channel);
        prompt = [TAG_INSTRUCTION, "Here are the most recent messages in a Slack DM.", context].join("\n");
    } else if (my_user_id && isTextMessage(message)) {
        if (message.text.includes(`<@${my_user_id}>`)) {
            /// Prompt for mentions
            const context = await getLlmContext(message.channel);
            prompt = [
                TAG_INSTRUCTION,
                "Here are the most recent messages in a Slack channel.",
                context,
                "You were mentioned in this message:",
                message.text
            ].join("\n");
        }
    }
    if (prompt) {
        const response = await generateChatGPTResponse(prompt);
        const delayTime = getRandomDelay(15, 300);
        const friendlyTime = `${Math.round(delayTime / 1000)}s`;
        if (response) {
            console.log(`responding in ${friendlyTime}.\n${response}`);
            await delay(delayTime);
            await say(response);
        } else {
            console.log('    no response needed...')
        }
    } else {
        console.log("  ignoring...");
    }
    console.log("")
});

async function postInRandomChannel(channel_type = 'public_channel') {
    const users = (await app.client.users.list({})).members;
    const channels = (await app.client.conversations.list({
        exclude_archived: true,
        types: channel_type,
    })).channels;
    console.log(`Post to random ${channel_type}: ${channels?.length} channels, ${users?.length} users `)

    const active_users = users?.filter(user => !user.deleted && !user.is_bot && user.id !== 'USLACKBOT' && user.is_email_confirmed) ?? [];
    const active_user_ids = active_users.map(u => u.id)
    const filter = channel_type === "im"
        ? (c: any) => !c.is_user_deleted && !c.is_archived && active_user_ids.includes(c.user) && c.user !== my_user_id
        : (c: any) => c.is_member && !c.is_archived

    if (channels?.length) {
        const filteredChannels = channels.filter(filter);
        const channel = filteredChannels[Math.floor(Math.random() * filteredChannels.length)];
        if (channel && channel.id) {
            const user = active_users?.find((u) => u.id === channel.user);
            const friendly_name = (channel_type === 'im')
                ? user?.real_name
                : channel.name;
            console.log(`Preparing to post in ${channel_type}: ${friendly_name}`);
            const context = await getLlmContext(channel.id)

            const prompt = (channel_type === 'im')
                ? im_prompt(context, user?.real_name ?? 'Unknown')
                : channel_prompt(context, channel.name ?? 'Unknown');

            const response = await generateChatGPTResponse(prompt);
            if (response) {
                console.log(`Interval post to ${channel_type}: ${channel.name}\n${response}`);
                await app.client.chat.postMessage({
                    channel: channel.id,
                    text: response,
                });
            } else {
                console.log("Not making any post this interval.")
            }
        } else {
            console.log('No channels (or all filtered):', channels)
        }
    }
    console.log("")
}

function im_prompt(context: string, user: string): string {
    let prompt;
    if (context.length) {
        prompt = `You have no conversation history with ${user}. Start a new conversation which may or may not be work-related.`
    } else {
        prompt = [
            `Here are the most recent messages in a DM with ${user}. Continue the existing conversation or start new conversation.`,
            context
        ].join("\n");
    }
    return prompt;
}

function channel_prompt(context: string, channel: string): string {
    let prompt;
    if (context.length) {
        prompt = `Start a new conversation suitable for channel #${channel}.`
    } else {
        prompt = [
            TAG_INSTRUCTION,
            `Here are the most recent messages in a public Slack channel #${channel}.`,
            context,
            `Continue the existing conversation or start new conversation.`
        ].join("\n");
    }
    return prompt;
}

async function getUserId(app: App): Promise<string | null> {
    try {
        const response = await app.client.auth.test();
        console.log(`Auth as ${response.user} - ${response.user_id}`)
        return response.user_id ?? null;
    } catch (error) {
        console.error('Error fetching user ID:', error);
        throw (error)
    }
}


// Post to a public channel every hour
setInterval(() => postInRandomChannel('public_channel'), 1 * 60 * 60 * 1000);

// Send a DM to a random active user every 3 hours
setInterval(() => postInRandomChannel('im'), 3 * 60 * 60 * 1000);

let my_user_id: string | null;
(async () => {
    my_user_id = await getUserId(app);
    await app.start(process.env.PORT || 3000);
    console.log('⚡️ Slack bot is running!');

    // Fire off some posts on startup
    await postInRandomChannel('public_channel')
    await postInRandomChannel('im')
})();


async function getLlmContext(channel: string): Promise<string> {
    try {
        // Query recent messages in the channel
        const result = await app.client.conversations.history({
            channel,
            limit: 20,
        });

        // Extract and construct LLM context
        const messages = result.messages ?? [];
        const context = messages.filter((m) => m.text).reverse().map((m) => `${m.user}: ${m.text}`).join("\n")
        // console.log("GPT Context:\n", context);
        return context;
    } catch (error) {
        console.error('Error fetching messages:', error);
        throw error;
    }
}
