import { Playlist } from "prisma/client/tenant";
import { ComponentOptions } from "../../../common/component.interface";
import Restream from "../../models/restream";
import { TrackPreview, stringify, Tracks } from "../../models/track.interface";
import TelegramBase, { CallbackData } from "./telegram.base";
import { first } from "../../models/generator";
import { err, generateID, shuffle, sleep } from "../../../common/utils.class";
import AbortController from "abort-controller";
import { Readable } from "stream";
import Cache, { ExtendedSource, Message } from "../../models/cache";

const UNTRACKED_TAG = "#untracked";
const DISCOVER_TAG = "#discover";
const LISTEN_TAG = "#listen";
const PER_PAGE = 10;
const CACHE_LIMIT = 10;
const LIMITS = {
  "0": 1, //Searches
  "1": 3, //Downloads
  "2": 1, //Queueing
} as Record<TaskType, number>;

export default class Telegram extends TelegramBase {
  protected client: number;
  private tempMessages: number[] = [];
  private loader?: NodeJS.Timeout;
  private issued: Set<string> = new Set();
  private cache: TrackCache;
  private tasks: Map<string, Task> = new Map();

  public constructor(args: ComponentOptions) {
    super(args);
    this.client = this.tenant.telegram;
    this.cache = {
      search: {},
      artist: {},
      album: {},
      source: {},
      similar: {},
    };
  }

  public async initialize(token: string): Promise<void> {
    if (!token) throw new Error("No telegram token provided!");
    return Telegram.initialize(token, this);
  }

  public async close(): Promise<void> {
    this.tasks.forEach((x, i) => this.endTask(i));
    this.issued.clear();
    Telegram.close();
  }

  public async clear(playlist?: Playlist): Promise<void> {
    const id = playlist?.telegram || this.client;
    const messages = await Cache.popMessages(id);

    this.tasks.forEach((x, i) => x.playlist === id && this.endTask(i));
    await this.clearTemp();

    const promises = Object.keys(messages).map((x) =>
      Telegram.call("deleteMessage", {
        chat_id: id,
        message_id: +x,
      }).catch(() => {})
    );

    await Promise.all(promises);
  }

  public async add(tracks: Tracks, playlist: Playlist): Promise<void> {
    if (!playlist.telegram) return;

    const abort = new AbortController();
    const task = await this.startTask(
      TaskType.Queueing,
      abort,
      playlist.telegram
    );

    for await (const track of tracks) {
      if (this.issued.delete(stringify(track))) continue;
      if (abort.signal.aborted) break;

      await this.upload(track, null, playlist.telegram).catch((e) =>
        err(`Failed to add audio!\n${e?.stack || e}`)
      );
    }

    this.endTask(task);
  }

  protected async onMessage(message: string): Promise<void> {
    this.clearTemp();
    Cache.addQuery(this.tenant.identifier, message).catch((x) => {
      err(`Failed to save history entry!\n${x}`);
    });

    const tracks = await this.requestTracks(message, "search", 0, 1);

    if (tracks[0]) {
      await this.upload(tracks[0], message).catch((e) =>
        err(`Failed to send audio!\n${e?.stack || e}`)
      );
    }
  }

  protected async onVoice(file: string): Promise<void> {
    const task = await this.startTask(TaskType.Searching);

    const data = await Telegram.call("getFile", {
      file_id: file,
    });
    const path = data?.file_path as string | undefined;
    if (!path) return this.endTask(task);
    const url = `https://api.telegram.org/file/bot${Telegram.token}/${path}`;

    const track = await this.want("recognise", url);
    this.endTask(task);
    if (!track) return;
    await this.onMessage(track);
  }

  protected async onCallback(
    data: CallbackData,
    message: number,
    chat: number
  ): Promise<void> {
    const ctx = await Cache.getMessage(chat, message);
    if (!ctx) return;

    const update = async (list?: Record<string, any>[]): Promise<boolean> => {
      list ||= await this.createList(ctx);
      //Update cached value
      await Cache.addMessage(chat, message, ctx);
      if (!list.length && ctx.type) return false;

      const buttons = [this.createButtons(!!ctx.search), ...list];

      Telegram.call("editMessageReplyMarkup", {
        chat_id: chat,
        message_id: message,
        reply_markup: { inline_keyboard: buttons },
      }).catch(() => {});
      return !!list.length;
    };

    switch (data.type) {
      case "artists": {
        if (!ctx.artists || !ctx.artists.length) return;
        if (ctx.artists.length > 1) {
          await update(
            ctx.artists.map((x) => [
              {
                text: x,
                callback_data: JSON.stringify({
                  type: "artist",
                  arg: x,
                }),
              },
            ])
          );
        } else {
          ctx.page = 0;
          ctx.query = ctx.artists[0];
          ctx.type = "artist";
          await update();
        }
        break;
      }

      case "more": {
        if (!ctx.search) return;
        ctx.page = 0;
        ctx.query = ctx.search;
        ctx.type = "search";
        await update();
        break;
      }

      case "artist": {
        const source = data.arg;
        if (source == null) return;
        ctx.page = 0;
        ctx.query = source;
        ctx.type = "artist";
        await update();
        break;
      }

      case "album": {
        if (!ctx.album) return;
        ctx.page = 0;
        ctx.query = [ctx.artists.join(", "), ctx.album]
          .filter((x) => x)
          .join(" - ");

        ctx.type = "album";
        await update();
        break;
      }

      case "similar": {
        ctx.page = 0;
        ctx.query = "similar";
        ctx.type = "similar";
        await update();
        break;
      }

      case "close": {
        ctx.type = undefined;
        ctx.page = undefined;
        ctx.query = undefined;
        await update();
        break;
      }

      case "next": {
        if (ctx.page == null) return;
        ctx.page++;
        if (!(await update())) {
          ctx.page--;
          await Cache.addMessage(chat, message, ctx);
        }
        break;
      }

      case "prev": {
        if (!ctx.page) return;
        ctx.page--;
        await update();
        break;
      }

      case "download": {
        const source = data.arg;
        if (source == null) return;

        const abort = new AbortController();
        const task = await this.startTask(TaskType.Searching, abort);
        const track = await first(this.want("query", source, "source"));
        if (abort.signal.aborted) return;

        this.endTask(task);
        if (!track) return;
        await this.upload(track, "").catch((e) =>
          err(`Failed to send audio!\n${e?.stack || e}`)
        );
        break;
      }

      case "page": {
        if (!ctx.query || !ctx.type || ctx.page == null) return;
        const tracks = await this.requestFromContext(ctx);

        tracks.forEach((x) =>
          this.upload(x, "").catch((e) =>
            err(`Failed to send audio!\n${e?.stack || e}`)
          )
        );

        break;
      }

      case "shuffle": {
        if (!ctx.query || !ctx.type || ctx.page == null) return;
        let tracks = await this.requestFromContext(ctx, 200);
        tracks = shuffle(tracks).slice(0, 10);

        tracks.forEach((x) =>
          this.upload(x, "").catch((e) =>
            err(`Failed to send audio!\n${e?.stack || e}`)
          )
        );

        break;
      }

      case "all": {
        if (!ctx.query || !ctx.type || ctx.page == null) return;

        const abort = new AbortController();
        const task = await this.startTask(TaskType.Queueing, abort);
        let page = 0;

        while (!abort.signal.aborted) {
          const tracks = await this.requestFromContext({
            ...ctx,
            page,
          });
          if (!tracks.length) break;
          if (abort.signal.aborted) break;

          await Promise.all(
            tracks.map((x) =>
              this.upload(x, "").catch((e) =>
                err(`Failed to send audio!\n${e?.stack || e}`)
              )
            )
          );
          page++;
        }
        this.endTask(task);

        break;
      }
    }
  }

  protected onTagged(id: number, channel: string): void {
    this.tasks.forEach((x, i) => x.playlist === id && this.endTask(i));
    this.emit("triggered", channel);
  }

  protected async onPost(
    text: string,
    channel: string,
    id: number,
    file?: string
  ): Promise<void> {
    const abort = new AbortController();
    const task = await this.startTask(TaskType.Searching, abort, id);
    const track = await first(this.want("query", text, "search"));
    if (abort.signal.aborted) return;

    this.endTask(task);
    if (!track) return;
    this.issued.add(stringify(track));

    const load = track.load;
    track.load = async () => {
      const loaded = await load();
      if (file) loaded.sources.push(`tg://${file}`);
      return loaded;
    };

    this.emit("playlisted", track, channel);
  }

  protected async onCommand(command: string, selected?: number): Promise<void> {
    this.clearTemp();

    switch (command) {
      case "clear": {
        this.clear();
        break;
      }
      case "cancel": {
        this.tasks.forEach(
          (x, i) => x.playlist === this.client && this.endTask(i)
        );
        break;
      }
      case "history": {
        const history = await Cache.getQueries(this.tenant.identifier);
        const { message_id: id } = await Telegram.call("sendMessage", {
          disable_notification: true,
          chat_id: this.client,
          text: "...",
          reply_markup: {
            keyboard: history.map((x) => [{ text: x }]),
            one_time_keyboard: true,
          },
        });

        if (!Number.isInteger(+id)) return;
        this.tempMessages.push(+id);
        break;
      }
      case "lyrics": {
        const message = selected
          ? await Cache.getMessage(this.client, selected)
          : await Cache.lastMessage(this.client);
        if (!message) return;

        const task = await this.startTask(TaskType.Searching);
        const lyrics = await this.want("lyrics", stringify(message));
        const { message_id: id } = await Telegram.call("sendMessage", {
          disable_notification: true,
          chat_id: this.client,
          text: lyrics,
          reply_to_message_id: selected,
        });

        this.endTask(task);
        if (!Number.isInteger(+id)) return;
        this.tempMessages.push(+id);
        break;
      }
    }
  }

  protected async onChat(
    chat: number,
    title: string,
    description?: string
  ): Promise<void> {
    const update = {
      telegram: chat,
      type: 0,
    };

    if (!description) {
      return (await this.emit("relisted", title, update)) as any;
    }
    description = description.toLowerCase();

    if (description.includes(UNTRACKED_TAG)) {
      update.type = -1;
    }
    if (description.includes(DISCOVER_TAG)) {
      update.type = 1;
    }
    if (description.includes(LISTEN_TAG)) {
      update.type = 2;
    }

    await this.emit("relisted", title, update);
  }

  private async clearTemp(): Promise<any> {
    //Clear temporary messages
    await Promise.all(
      this.tempMessages.map((x) =>
        Telegram.call("deleteMessage", {
          chat_id: this.client,
          message_id: +x,
        }).catch(() => {})
      )
    );

    this.tempMessages = [];
  }

  private async requestTracks(
    query: string,
    from: ExtendedSource = "search",
    offset = 0,
    count = 10
  ): Promise<TrackPreview[]> {
    let task;
    try {
      const cached = this.cache[from]?.[query];
      const source = cached || {
        history: [],
        iterator:
          from != "similar"
            ? this.want("query", query, from)
            : this.want("similar", query),
      };

      if (!cached) {
        this.cache[from] ??= {};
        this.cache[from][query] = source;
        //Cache control
        const keys = Object.keys(this.cache[from]);
        if (keys.length > CACHE_LIMIT) {
          delete this.cache[from][keys[0]];
        }
      }

      const tracks = [];
      //Load from history
      if (offset < source.history.length) {
        tracks.push(...source.history.slice(offset, offset + count));
      }
      //Request new data
      if (offset + count > source.history.length) {
        const abort = new AbortController();
        if (!offset) {
          task = await this.startTask(TaskType.Searching, abort);
        }

        const length = offset + count - source.history.length;
        const skip = Math.max(offset - source.history.length, 0);

        if (skip) first(source.iterator, skip);
        const loaded = await first(source.iterator, length);
        if (abort.signal.aborted) return tracks;

        source.history.push(...loaded);
        tracks.push(...loaded);
      }
      return tracks;
    } finally {
      if (task) this.endTask(task);
    }
  }

  private async requestFromContext(
    ctx: Message,
    max?: number
  ): Promise<TrackPreview[]> {
    if (ctx.query == null || ctx.type == null || ctx.page == null) {
      return [];
    }

    return await this.requestTracks(
      ctx.type == "similar" ? stringify(ctx) : ctx.query,
      ctx.type,
      max ? 0 : ctx.page * PER_PAGE + (ctx.type == "search" ? 1 : 0),
      max || PER_PAGE
    );
  }

  private async createList(ctx: Message): Promise<Record<string, any>[]> {
    if (ctx.query == null || ctx.type == null || ctx.page == null) {
      return [];
    }

    const tracks = await this.requestFromContext(ctx);

    const list = tracks.map((x, i) => [
      {
        text: `${x.artists.join(", ")} - ${x.title}`,
        callback_data: JSON.stringify({
          type: "download",
          arg: x.sources[0],
        }),
      },
    ]);

    const close = {
      text: "❌",
      callback_data: JSON.stringify({ type: "close" }),
    };

    const prev = {
      text: "👈",
      callback_data: JSON.stringify({ type: "prev" }),
    };

    const next = {
      text: "👉",
      callback_data: JSON.stringify({ type: "next" }),
    };

    const page = {
      text: "⬇️",
      callback_data: JSON.stringify({ type: "page" }),
    };

    const shuffle = {
      text: "🔀",
      callback_data: JSON.stringify({ type: "shuffle" }),
    };

    const all = {
      text: "⏬",
      callback_data: JSON.stringify({ type: "all" }),
    };

    if (list.length) list.push([prev, close, next]);
    if (list.length) list.push([page, shuffle, all]);
    return list;
  }

  private createButtons(moreButton: boolean = false): Record<string, any>[] {
    const options = {
      "👤": "artists",
      "📻": "similar",
      "💿": "album",
    } as Record<string, string>;
    if (moreButton) options["🔎"] = "more";

    return Object.entries(options).map((x) => ({
      text: x[0],
      callback_data: JSON.stringify({
        type: x[1],
      }),
    }));
  }

  private async startTask(
    type: TaskType,
    abort?: AbortController,
    playlist: number = this.client
  ): Promise<string> {
    const id = generateID();

    const limit = LIMITS[type];
    let resolve: (() => void) | undefined;
    let waiting: Promise<void> | undefined;
    const tasks = [...this.tasks.values()].filter(
      (x) => x.type === type && !x.resolve
    );

    if (tasks.length >= limit) {
      waiting = new Promise((loaded) => {
        resolve = loaded;
      });
    }

    this.tasks.set(id, { type, playlist, abort, resolve });
    await waiting;

    const action = (): void => {
      const tasks = [...this.tasks.values()];
      const isSearching = tasks.some(
        (x) => x.type === TaskType.Searching && x.playlist === this.client
      );
      const isUploading = tasks.some(
        (x) => x.type === TaskType.Uploading && x.playlist === this.client
      );
      if (!isSearching && !isUploading) {
        if (this.loader) clearInterval(this.loader);
        return;
      }

      Telegram.call("sendChatAction", {
        chat_id: this.client,
        action: isUploading ? "upload_voice" : "record_voice",
      });
    };
    if (this.loader) clearInterval(this.loader);
    this.loader = setInterval(action, 3000);
    action();

    return id;
  }

  private endTask(id: string) {
    const task = this.tasks.get(id);
    if (!task) return;
    task.abort?.abort();
    this.tasks.get(id)?.abort?.abort();
    this.tasks.delete(id);

    //Resove the first queued element
    for (const value of this.tasks.values()) {
      if (value.type !== task.type) continue;
      if (!value.resolve) continue;
      value.resolve();
      value.resolve = undefined;
      break;
    }
  }

  private async upload(
    preview: TrackPreview,
    query: string | null,
    chat = this.client
  ): Promise<void> {
    let source: Readable | undefined;
    const abort = new AbortController();
    const task = await this.startTask(TaskType.Uploading, abort, chat);
    if (abort.signal.aborted) return;
    try {
      const track = await preview.load();
      if (abort.signal.aborted) return;
      let tg = track.sources.find((x) => x.startsWith("tg://"))?.slice(5);
      tg ||= await Cache.getFile(preview);

      const buttons = query !== null ? this.createButtons(!!query) : null;

      let message;
      if (tg) {
        message = await Telegram.call(
          "sendAudio",
          {
            chat_id: chat,
            audio: tg,
            disable_notification: true,
            reply_markup: buttons ? { inline_keyboard: [buttons] } : undefined,
          },
          abort
        );
      } else {
        const stream = await Restream.fromTrack(track);
        if (abort.signal.aborted) return;
        source = stream.source;
        message = await Telegram.call(
          "sendAudio",
          {
            chat_id: chat,
            audio: [source, stream.filename],
            title: track.title,
            performer: track.artists.join(", "),
            duration: track.length,
            disable_notification: true,
            reply_markup: buttons ? { inline_keyboard: [buttons] } : undefined,
          },
          abort
        );
      }

      const id = message.message_id;
      const file = message.audio?.file_id || message.document?.file_id;

      await Cache.addMessage(chat, id, {
        title: track.title,
        artists: track.artists,
        album: track.album,
        search: query || undefined,
      });
      if (!file) return;
      await Cache.addFile(preview, file);
      track.sources.push(`tg://${file}`);
    } catch (e) {
      //Check retry after timeout
      const timeout = +e.toString()?.match(/Retry after ([0-9]+)/)?.[1];
      if (timeout) {
        await sleep(timeout * 1000);
        return await this.upload(preview, query, chat);
      }

      if (!e.toString().includes('"type":"aborted"')) {
        throw e;
      }
    } finally {
      source?.destroy();
      this.endTask(task);
    }
  }
}

interface Task {
  type: TaskType;
  playlist: number;
  abort?: AbortController;
  resolve?: () => void;
}

enum TaskType {
  Searching,
  Uploading,
  Queueing,
}

type TrackCache = Record<
  ExtendedSource,
  Record<string, { history: TrackPreview[]; iterator: Tracks }>
>;
