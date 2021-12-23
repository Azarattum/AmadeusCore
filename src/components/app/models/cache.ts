import { copyFileSync, existsSync } from "fs";
import { PrismaClient } from "prisma/client/cache";
import { TrackSource } from "./providers/provider.abstract";
import { hash, ITrackPreview } from "./track.interface";

export default class Cache {
	private static prisma: PrismaClient;

	public static initialize(): void {
		const db = "data/cache.db";
		if (!existsSync(db)) {
			copyFileSync("data/cache.dummy", db);
		}

		if (!this.prisma) {
			this.prisma = new PrismaClient({
				datasources: {
					db: {
						url: `file:../${db}`
					}
				}
			});
		}
	}

	/**
	 * Deletes and returns messages from the given chat
	 * @param chat Chat id to pop from
	 */
	public static async popMessages(
		chat: number
	): Promise<Record<number, IMessage>> {
		const predicate = { where: { chat } };
		const data = await this.prisma.message.findMany(predicate);
		await this.prisma.message.deleteMany(predicate);

		const messages = {} as Record<number, IMessage>;
		for (const x of data) {
			messages[x.id] = {
				type: (x.type as ExtendedSource) || undefined,
				query: x.query || undefined,
				page: x.page ?? undefined,

				search: x.search || undefined,
				artists: JSON.parse(x.artists),
				title: x.title,
				album: x.album
			};
		}

		return messages;
	}

	/**
	 * Returns the message if exists
	 * @param chat Chat id where the message is from
	 * @param id Message's id in the chat
	 */
	public static async getMessage(
		chat: number,
		id: number
	): Promise<IMessage | null> {
		const x = await this.prisma.message.findUnique({
			where: { chat_id: { chat, id } }
		});

		return x
			? {
					type: (x.type as ExtendedSource) || undefined,
					query: x.query || undefined,
					page: x.page ?? undefined,

					search: x.search || undefined,
					artists: JSON.parse(x.artists),
					title: x.title,
					album: x.album
			  }
			: null;
	}

	/**
	 * Returns the last message from chat
	 * @param chat Chat id where the message is from
	 */
	public static async lastMessage(chat: number): Promise<IMessage | null> {
		const x = await this.prisma.message.findFirst({
			where: { chat },
			orderBy: { id: "desc" }
		});

		return x
			? {
					type: (x.type as ExtendedSource) || undefined,
					query: x.query || undefined,
					page: x.page ?? undefined,

					search: x.search || undefined,
					artists: JSON.parse(x.artists),
					title: x.title,
					album: x.album
			  }
			: null;
	}

	/**
	 * Saves a message to the cache
	 * @param chat Chat of the message
	 * @param id Id of the message
	 * @param data Message data
	 */
	public static async addMessage(
		chat: number,
		id: number,
		data: IMessage
	): Promise<void> {
		const message = {
			...data,
			type: data.type || null,
			query: data.query || null,
			page: data.page ?? null,
			artists: JSON.stringify(data.artists),
			id,
			chat
		};

		await this.prisma.message.upsert({
			where: {
				chat_id: { chat, id }
			},
			update: message,
			create: message
		});
	}

	/**
	 * Saves file id of a track to the cache
	 * @param track Track preview or track hash
	 * @param fileId File id to save
	 */
	public static async addFile(
		track: ITrackPreview | string,
		fileId: string
	): Promise<void> {
		if (typeof track != "string") track = hash(track);
		const file = { hash: track, file: fileId };

		await this.prisma.file.upsert({
			where: { hash: track },
			update: file,
			create: file
		});
	}

	/**
	 * Returns file id of a track to the cache
	 * @param track Track preview or track hash
	 */
	public static async getFile(
		track: ITrackPreview | string
	): Promise<string | undefined> {
		if (typeof track != "string") track = hash(track);

		const file = await this.prisma.file.findUnique({
			where: { hash: track }
		});

		return file?.file;
	}

	/**
	 * Returns last queries from tenant's history
	 * @param identifier Tenant's identifier
	 * @param limit Count of history items to return
	 */
	public static async getQueries(
		identifier: string,
		limit = 5
	): Promise<string[]> {
		const items = await this.prisma.history.findMany({
			select: { query: true },
			where: { owner: identifier },
			take: limit,
			orderBy: { time: "desc" }
		});

		return items.map(x => x.query);
	}

	/**
	 * Saves tenant's query to its search history cache
	 * @param identifier Tenant's identifier
	 * @param query Search query to save
	 */
	public static async addQuery(
		identifier: string,
		query: string
	): Promise<void> {
		const item = {
			time: new Date(),
			owner: identifier,
			query
		};

		//Insert a new item
		await this.prisma.history.upsert({
			where: { query },
			create: item,
			update: item
		});

		//Remove items which are more than 10 old for the tenant
		await this.prisma.$executeRaw`
			DELETE FROM History
			WHERE
				(time <
					(SELECT time FROM History
					WHERE owner=${identifier}
					ORDER BY time DESC LIMIT 9, 1)
				)
			AND
				owner=${identifier};`;
	}
}
Cache.initialize();

export type ExtendedSource = TrackSource | "similar";

export interface IMessage {
	/**Paging type */
	type?: ExtendedSource;
	/**Paging request */
	query?: string;
	/**Paging state */
	page?: number;

	/**Initial search request */
	search?: string;
	/**Track artists */
	artists: string[];
	/**Track title */
	title: string;
	/**Track album */
	album: string;
}
