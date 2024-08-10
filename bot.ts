import { App, LogLevel, GenericMessageEvent } from '@slack/bolt';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';

dotenv.config();

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

async function generateChatGPTResponse(context: string): Promise<string | null> {
    const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
            { role: 'system', content: `You are a ${ROLE}. A real team member.` },
            {
                role: 'assistant', content: `
        Respond with a slack message response suitable to the entire conversation.
        Don't explain that you'll respond, simply respond as if you were in the Slack conversation.
        Avoid overly generic, customer-support like prompts; you're discussing among peers.
        If you want to tag a user from the conversation, use the syntax <@USER_ID>.
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
        prompt = "Here are the most recent messages in a Slack DM.\n" + context;
    } else if (userId && isTextMessage(message)) {
        if (message.text.includes(`<@${userId}>`)) {
            /// Prompt for mentions
            const context = await getLlmContext(message.channel);
            prompt = [
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
        console.log(`Responding in ${friendlyTime}: `, response);
        if (response) {
            await delay(delayTime);
            await say(response);
        }
    } else {
        console.log("    ignoring...");
    }
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
        ? (c: any) => !c.is_user_deleted && !c.is_archived && active_user_ids.includes(c.user) && c.user !== userId
        : (c: any) => c.is_member && !c.is_archived

    if (channels?.length) {
        const filteredChannels = channels.filter(filter);
        const channel = filteredChannels[Math.floor(Math.random() * filteredChannels.length)];
        if (channel && channel.id) {
            console.log(`Preparing to post in ${channel_type}: ${channel.name}`);
            const context = await getLlmContext(channel.id)

            const user = active_users?.find((u) => u.id === channel.user);
            const prompt = channel_type === 'im'
                ? im_prompt(context, user?.real_name ?? 'Unknown')
                : channel_prompt(context, channel.name ?? 'Unknown');

            const response = await generateChatGPTResponse(prompt);
            console.log(`Interval post to ${channel_type}: ${channel.name}:\n\t`, response);
            if (response) {
                await app.client.chat.postMessage({
                    token: process.env.SLACK_BOT_TOKEN,
                    channel: channel.id,
                    text: response,
                });
            }
        } else {
            console.log('No channels (or all filtered):', channels)
        }
    }
}

function im_prompt(context: string, user: string): string {
    let prompt;
    if (context.length) {
        prompt = `You have no conversation history with ${user}. Start a new conversation which may or may not be work-related. It's a DM, so don't bother tagging them.`
    } else {
        prompt = [
            `Here are the most recent messages in a DM with ${user}. Start a new conversation which may or may not related to these messages. It's a DM, so don't bother tagging them.`,
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
            `Here are the most recent messages in a public Slack channel #${channel}.`,
            context,
            `Start a new conversation suitable to the channel which may or may not related to these messages.`
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

let userId: string | null;
(async () => {
    userId = await getUserId(app);
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