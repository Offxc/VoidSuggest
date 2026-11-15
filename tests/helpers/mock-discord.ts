import http from "node:http";
import type { AddressInfo } from "node:net";
import { resetEnvForTests } from "@/server/env";

/**
 * A tiny stand-in for the parts of Discord's API the site uses, so sign-in
 * and member sync can be tested without the network or real credentials.
 */

export interface FakeMember {
  id: string;
  username: string;
  globalName?: string | null;
  nick?: string | null;
  roles: string[];
  joinedAt?: string;
  inGuild?: boolean;
}

export interface FakeChannel {
  id: string;
  type: number;
  guildId: string;
  name: string;
  /** False: posting answers 403, like a bot without Send Messages. */
  canPost: boolean;
  /** False: posts work but Discord drops the embeds, like a bot without Embed Links. */
  canEmbed: boolean;
}

export interface FakeMessage {
  id: string;
  channelId: string;
  payload: any;
}

export const GUILD_ID = "200000000000000001";
export const MEMBER_ROLE = "300000000000000001";

export class MockDiscord {
  members = new Map<string, FakeMember>();
  /** When set, every request answers with this status (to simulate an outage). */
  failWith: number | null = null;
  channels = new Map<string, FakeChannel>();
  messages = new Map<string, FakeMessage>();
  /** When set, creating a message answers with this status (other calls are unaffected). */
  postFailsWith: number | null = null;
  private nextMessage = 700000000000000000n;
  requests: { method: string; url: string; auth: string | undefined; body: string }[] = [];
  private server!: http.Server;
  url = "";

  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks).toString();
      this.requests.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, body });

      const send = (status: number, json?: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(json === undefined ? "" : JSON.stringify(json));
      };
      if (this.failWith) return send(this.failWith, { message: "failure" });

      const url = new URL(req.url ?? "/", "http://mock");
      const path = url.pathname;

      if (req.method === "POST" && path === "/oauth2/token") {
        const form = new URLSearchParams(body);
        const code = form.get("code") ?? "";
        if (!code.startsWith("code-") || !form.get("code_verifier")) return send(400, { error: "invalid_grant" });
        return send(200, { access_token: `tok-${code.slice(5)}`, token_type: "Bearer" });
      }
      if (path === "/users/@me") {
        const token = (req.headers.authorization ?? "").replace("Bearer tok-", "");
        const m = this.members.get(token);
        return m ? send(200, { id: m.id, username: m.username }) : send(401, {});
      }
      const memberMatch = path.match(/^\/guilds\/(\d+)\/members\/(\d+)$/);
      if (memberMatch) {
        const m = this.members.get(memberMatch[2]!);
        return m && m.inGuild !== false ? send(200, this.shape(m)) : send(404, { message: "Unknown Member" });
      }
      if (path === `/guilds/${GUILD_ID}/members`) {
        const after = BigInt(url.searchParams.get("after") ?? "0");
        const limit = Number(url.searchParams.get("limit") ?? "1000");
        const all = [...this.members.values()]
          .filter((m) => m.inGuild !== false && BigInt(m.id) > after)
          .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
          .slice(0, limit);
        return send(200, all.map((m) => this.shape(m)));
      }
      if (path === `/guilds/${GUILD_ID}/roles`) {
        return send(200, [
          { id: GUILD_ID, name: "@everyone", position: 0 },
          { id: MEMBER_ROLE, name: "Member", position: 2 },
          { id: "300000000000000002", name: "Bot role", position: 3, managed: true },
        ]);
      }
      if (path === "/__state") {
        return send(200, { messages: [...this.messages.values()] });
      }
      const channelMatch = path.match(/^\/channels\/(\d+)$/);
      if (channelMatch && req.method === "GET") {
        const c = this.channels.get(channelMatch[1]!);
        return c ? send(200, { id: c.id, type: c.type, guild_id: c.guildId, name: c.name }) : send(404, { message: "Unknown Channel" });
      }
      const postMatch = path.match(/^\/channels\/(\d+)\/messages$/);
      if (postMatch && req.method === "POST") {
        const c = this.channels.get(postMatch[1]!);
        if (!c) return send(404, { message: "Unknown Channel" });
        if (!c.canPost) return send(403, { message: "Missing Permissions" });
        if (this.postFailsWith) return send(this.postFailsWith, { message: "failure" });
        const payload = JSON.parse(body);
        const id = String(++this.nextMessage);
        this.messages.set(id, { id, channelId: c.id, payload });
        return send(200, { id, embeds: c.canEmbed ? (payload.embeds ?? []) : [] });
      }
      const messageMatch = path.match(/^\/channels\/(\d+)\/messages\/(\d+)$/);
      if (messageMatch) {
        const m = this.messages.get(messageMatch[2]!);
        if (!m || m.channelId !== messageMatch[1]) return send(404, { message: "Unknown Message" });
        if (req.method === "PATCH") {
          m.payload = { ...m.payload, ...JSON.parse(body) };
          return send(200, { id: m.id });
        }
        if (req.method === "DELETE") {
          this.messages.delete(m.id);
          return send(204);
        }
      }
      const userMatch = path.match(/^\/users\/(\d+)$/);
      if (userMatch) {
        const m = this.members.get(userMatch[1]!);
        return m ? send(200, { id: m.id, username: m.username, global_name: m.globalName ?? null, avatar: null }) : send(404, {});
      }
      return send(404, { message: "not found" });
    });
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    process.env.DISCORD_API_BASE = this.url;
    resetEnvForTests();
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  addChannel(id: string, options: Partial<Omit<FakeChannel, "id">> = {}): FakeChannel {
    const channel: FakeChannel = { id, type: 0, guildId: GUILD_ID, name: `channel-${id.slice(-4)}`, canPost: true, canEmbed: true, ...options };
    this.channels.set(id, channel);
    return channel;
  }

  /** Messages in a channel, oldest first. */
  inChannel(channelId: string): FakeMessage[] {
    return [...this.messages.values()].filter((m) => m.channelId === channelId);
  }

  /** How many create/edit/delete calls have been made so far. */
  writes(): number {
    return this.requests.filter((r) => r.url.includes("/messages") && r.method !== "GET").length;
  }

  add(member: FakeMember): FakeMember {
    this.members.set(member.id, member);
    return member;
  }

  private shape(m: FakeMember) {
    return {
      user: { id: m.id, username: m.username, global_name: m.globalName ?? null, avatar: null },
      nick: m.nick ?? null,
      avatar: null,
      roles: m.roles,
      joined_at: m.joinedAt ?? new Date(Date.now() - 30 * 86_400_000).toISOString(),
    };
  }
}
