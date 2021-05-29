import { PrismaClient } from "prisma/client/cache";
import { TrackSource } from "./providers/provider.abstract";
import { hash, IPreview } from "./track.interface";

export default class Cache {
	private static prisma: PrismaClient;

	public static initialize(): void {
		if (!this.prisma) {
			this.prisma = new PrismaClient();
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
		track: IPreview | string,
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
		track: IPreview | string
	): Promise<string | undefined> {
		if (typeof track != "string") track = hash(track);

		const file = await this.prisma.file.findUnique({
			where: { hash: track }
		});

		return file?.file;
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
