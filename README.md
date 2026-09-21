# Ludeen Discord Bot — Menzies

TypeScript Discord bot framework for the Menzies server, built with discord.js and Drizzle ORM (Neon Postgres).

## Requirements

- Node.js 20+
- A Discord application + bot token
- A Neon Postgres database

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the env template and fill in your secrets:

```bash
cp .env.example .env
```

| Variable | Where to get it |
| --- | --- |
| `DISCORD_TOKEN` | Discord Developer Portal → Bot → Token |
| `DISCORD_CLIENT_ID` | Discord Developer Portal → Application ID |
| `DISCORD_GUILD_ID` | Menzies server ID (Developer Mode → right-click server → Copy Server ID) |
| `DATABASE_URL` | Neon console → Connection string |
| `GITHUB_TOKEN` | GitHub → Settings → Developer settings → Personal access token (Issues read/write) |
| `GITHUB_REPO_MAP` | JSON map of Discord channel ID → `owner/repo` |
| `GITHUB_WEBHOOK_SECRET` | Shared secret you choose; must match each GitHub repo webhook |
| `MEETING_MAX_UPLOAD_MB` | Max MB per meeting audio file part (default `24`; split into multiple messages if larger) |
| `LOFI_STREAM_URLS` | Comma-separated HTTP(S) audio stream URLs for `/lofi` |

3. Generate and apply database migrations:

```bash
npm run db:generate
npm run db:migrate
```

4. Register slash commands to the Menzies guild:

```bash
npm run deploy-commands
```

5. Start the bot:

```bash
npm run dev
```

## Deploy on Railway

1. Push this repo to GitHub and create a new Railway project from that repo.
2. In Railway → **Variables**, add the same keys as `.env`:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_GUILD_ID`
   - `DATABASE_URL` (Neon connection string)
   - `GITHUB_TOKEN`
   - `GITHUB_REPO_MAP`
   - `GITHUB_WEBHOOK_SECRET`
   - `LOFI_STREAM_URLS`
   - `MEETING_MAX_UPLOAD_MB` (optional)
3. Deploy. Railway runs `npm run build` then `npm start` (see `railway.toml`). Generate a public HTTPS domain for the service (Settings → Networking) so GitHub can reach `/webhooks/github`.
4. Run migrations and command deploy once (locally or via Railway shell):

```bash
npm run db:migrate
npm run deploy-commands
```

The process binds `PORT` (Railway) for **GET /health** and **POST /webhooks/github** while also keeping the Discord gateway connection.

## GitHub (channel → repo)

Each Discord channel can target a different GitHub repo via `GITHUB_REPO_MAP`:

```bash
GITHUB_REPO_MAP={"111111111111111111":"your-org/frontend","222222222222222222":"your-org/backend"}
```

| Command | What it does |
| --- | --- |
| `/issue create` | Create an issue (`title`, optional `body`, `assignees`, `labels`, `milestone`) |
| `/issue edit` | Edit an issue (`number` + any of `title`, `body`, `assignees`, `labels`, `state`, `milestone`) |
| `/issue list` | List open issues (optional `assignee` filter) |
| `/issue view` | View an issue by number |
| `/issue close` | Close an issue (optional comment) |
| `/link github` | Link your Discord account to a GitHub username |
| `/link status` | Show your linked GitHub username |
| `/link unlink` | Remove your GitHub link |
| `/tasks open` | Create/open your **private** task thread (timeline of assigned issues) |
| `/tasks refresh` | Refresh that timeline |
| `/repo here` | Show which repo this channel maps to |
| `/repo list` | List all channel → repo mappings |

`assignees` takes **GitHub usernames**, comma-separated (e.g. `alice,bob`). They must have access to the repo.

### GitHub alerts → category `log*` channels

Each category should have a text channel whose name starts with `log` (e.g. `log`, `log-github`). Map the repo’s main Discord channel in `GITHUB_REPO_MAP`; Ludeen finds that channel’s **category**, then posts alerts into the category’s `log*` channel.

| Event | What appears |
| --- | --- |
| Pull requests | opened / closed / merged / reopened / draft / review requested |
| PR reviews | approved / changes requested / commented |
| Workflow runs / check suites | CI completed (success / failure / cancelled) |
| Releases | published |
| Pushes | default-branch commits only |

**Setup (each mapped repo):**

1. GitHub repo → **Settings → Webhooks → Add webhook**
2. Payload URL: `https://<your-railway-domain>/webhooks/github`
3. Content type: `application/json`
4. Secret: same as `GITHUB_WEBHOOK_SECRET`
5. Events: Pull requests, Pull request reviews, Workflow runs, Check suites, Releases, Pushes (or “Send me everything” — unused events are ignored)

### Private task boards

1. Each user runs `/link github username:their-github`.
2. From a text channel, run `/tasks open` — the bot creates a **private thread** only they (and the bot) can see.
3. The board lists **open issues assigned to them across all repos in `GITHUB_REPO_MAP`**, grouped as Today / This week / This month / Earlier.
4. Assigning someone via `/issue create` or `/issue edit` refreshes their board if they have one open.

Bot needs **Create Private Threads** + **Send Messages in Threads** in that channel.

## Meeting recording

Records audio from **meeting*** voice channels and posts a compressed file to the matching **meeting-record*** text channel in the **same category**.

> **Discord limit:** a bot can only be in **one voice channel per server** at a time. Different categories cannot record simultaneously in the same guild — stop the active one first. Multiple guilds can record in parallel.

| Naming | Rule |
| --- | --- |
| Voice | Name starts with `meeting` (e.g. `meeting`, `meeting-standup`) |
| Text | Name starts with `meeting-record` (same category as the voice channel) |

| Command | What it does |
| --- | --- |
| `/meeting record start` | Join your current meeting VC and start recording |
| `/meeting record pause` | Pause capture (timeline does not advance) |
| `/meeting record resume` | Resume capture |
| `/meeting record stop` | Stop, compress to Ogg Opus, post to `meeting-record*` |
| `/meeting record status` | List active recordings in the server |

**Who can pause/resume/stop:** the starter, anyone with **Manage Channels**, or a role named **Meeting Recorder**.

**Auto-stop:** if no humans remain in the VC for **3 minutes**, the bot stops, compresses, and uploads.

**Bot permissions:** Connect, Speak, Use Voice Activity, View Channel; on the record text channel: Send Messages, Attach Files, Embed Links.

**Intents:** enable **Server Members** is not required; enable **Guild Voice States** (Gateway intent) in the Discord Developer Portal.

**ffmpeg:** required for compression and stream playback. Railway installs it via [`nixpacks.toml`](nixpacks.toml). Locally: `sudo apt install ffmpeg` (or equivalent).

**Node:** Railway is pinned to **Node 20** (see `.nvmrc` / `nixpacks.toml`). Voice uses `opusscript` + `libsodium-wrappers` so native C++ builds are not required on deploy.

**Large files:** set `MEETING_MAX_UPLOAD_MB` (default 24). After compressing to Ogg Opus, if the file is still over that limit, Ludeen splits it into sequential parts and posts each to `meeting-record*`.

## Lofi radio

Continuous focus music in **any** voice channel. Join a VC, then:

| Command | What it does |
| --- | --- |
| `/lofi start` | Join your VC and stream from `LOFI_STREAM_URLS` |
| `/lofi pause` | Pause playback |
| `/lofi resume` | Resume playback |
| `/lofi stop` | Stop and leave |
| `/lofi status` | Show channel, state, and current stream |

**Rotation:** when a stream ends (or errors), Ludeen advances to the next URL and avoids immediate repeat when 2+ URLs are configured. Live radio streams are inherently non-repeating content.

**Controls / auto-stop:** same as meetings — starter, Manage Channels, or **Meeting Recorder** role; auto-stops after **3 minutes** with no humans.

**Conflict:** cannot run lofi and meeting recording in the same server at once (Discord one-VC-per-bot limit).

Create a GitHub PAT with access to those repos (classic: `repo` scope, or fine-grained: Issues read/write), then redeploy commands:

```bash
npm run deploy-commands
```

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Run with hot reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled bot |
| `npm run deploy-commands` | Register guild slash commands |
| `npm run db:generate` | Generate Drizzle migrations from schema |
| `npm run db:migrate` | Apply migrations to Neon |
| `npm run db:studio` | Open Drizzle Studio |

## Project structure

```
src/
├── index.ts              # Boot: env, DB, login
├── client.ts             # Extended Client
├── config.ts             # Zod env validation
├── db/                   # Drizzle + Neon
├── github/               # Octokit client + channel→repo routing
├── meeting/              # Multi-session voice recording + compress
├── lofi/                 # Focus radio playback sessions
├── webhooks/             # HTTP server + GitHub → Discord log alerts
├── handlers/             # Command & event loaders
├── commands/             # Slash commands by category
├── events/               # Discord gateway events
├── types/                # Shared types
└── deploy-commands.ts    # Guild command registration
```

## Adding a command

Create a file under `src/commands/<category>/`:

```ts
import { SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "../../types/command";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("example")
    .setDescription("Example command"),
  async execute(interaction) {
    await interaction.reply("Hello from Menzies!");
  },
};

export default command;
```

Then run `npm run deploy-commands` and restart the bot.

## Adding an event

Create a file under `src/events/` named after the Discord.js event (e.g. `guildMemberAdd.ts`).
