import { err, sleep, wrn } from "../../../common/utils.class";
import Tenant from "../../models/tenant";
import Endpoint from "./endpoint.abstract";
import { assertType, is } from "typescript-is";
import Form from "../../models/form";
import { gretch } from "gretchen";
import AbortController from "abort-controller";

export default abstract class TelegramBase extends Endpoint {
	protected abstract client: number;

	protected abstract onMessage(message: string): void;
	protected abstract onCommand(command: string): void;
	protected abstract onTagged(channel: string): void;
	protected abstract onPost(
		text: string,
		channel: string,
		file?: string
	): void;
	protected abstract onChat(
		id: number,
		title: string,
		description?: string
	): void;
	protected abstract onCallback(
		data: ICallbackData,
		message: number,
		chat: number
	): void;

	private static url: string;
	private static inited = false;
	private static username: string;
	private static globalAbort: AbortController;
	private static clients: Map<number, TelegramBase> = new Map();

	public static get relations(): Tenant[] {
		return Tenant.tenants.filter(x => x.telegram);
	}

	protected static async initialize(
		token: string,
		instance: TelegramBase
	): Promise<void> {
		this.clients.set(instance.client, instance);

		if (this.inited) return;
		this.url = "https://api.telegram.org/bot" + token + "/";
		this.globalAbort = new AbortController();
		this.inited = true;
		this.subscribe();

		const { username } = await this.call("getMe");
		this.username = username;
	}

	protected static close(): void {
		this.inited = false;
		this.globalAbort.abort();
	}

	protected static async call(
		method: string,
		params: Record<string, any> = {},
		abortController?: AbortController
	): Promise<Record<string, any>> {
		if (!this.inited) return {};

		const mixedAbort = new AbortController();
		this.globalAbort.signal.addEventListener("abort", () => {
			mixedAbort.abort();
		});
		abortController?.signal.addEventListener("abort", () => {
			mixedAbort.abort();
		});

		const response = await fetch(this.url + method, {
			method: "POST",
			headers: Form.headers,
			body: new Form(params),
			signal: mixedAbort.signal
		}).catch(e => {
			const text = JSON.stringify(e);
			throw new Error(`Failed to execute "${method}"!\n${text}`);
		});

		if (Math.floor(response.status / 100) !== 2) {
			throw new Error(
				`Failed to execute "${method}"!\n${response.status}: ${response.statusText}`
			);
		}

		const text = await response.text();

		let data;
		try {
			data = JSON.parse(text);
		} catch {
			throw new Error(
				`JSON parse failed upon "${method}" execution!\n${text}`
			);
		}

		if (!("result" in data)) {
			const text = JSON.stringify(data);
			throw new Error(`Invalid data recieved!\n${text}`);
		}

		return data.result;
	}

	private static async subscribe(offset = 0): Promise<void> {
		if (!this.inited) return;
		const { data, error, status } = await gretch(this.url + "getUpdates", {
			signal: this.globalAbort.signal,
			timeout: 120 * 1000,
			method: "POST",
			json: {
				offset,
				timeout: 60
			}
		}).json();
		if (!this.inited) return;

		//Timeout
		if (status === 502) {
			this.subscribe(offset);
			return;
		}
		//Error
		if (error) {
			const text = JSON.stringify(error);
			err(`Error code ${status} recieved on polling\n${text}`);

			sleep(1000);
			this.subscribe(offset);
			return;
		}
		//Validate
		if (!data.result || !Array.isArray(data.result)) {
			const text = JSON.stringify(data);
			err(`Invalid update data recieved!\n${text}`);

			await sleep(1000);
			this.subscribe(offset);
			return;
		}

		for (const update of data.result) {
			if (!update["update_id"]) continue;
			this.update(update).catch(e =>
				err(`Failed to process update!\n${e?.stack || e}`)
			);
			offset = Math.max(offset, update["update_id"] + 1);
		}
		this.subscribe(offset);
	}

	private static async check(channel: number): Promise<TelegramBase | null> {
		const admins = await this.call("getChatAdministrators", {
			chat_id: channel
		});

		if (Array.isArray(admins)) {
			for (const admin of admins) {
				const client = this.clients.get(admin.user.id);
				if (!client) continue;
				return client;
			}
		}

		return null;
	}

	private static async update(data: Record<string, any>): Promise<void> {
		if (data["message"]) {
			const message = data["message"];
			if (!is<IMessage>(message)) {
				wrn(`Unkown message recieved!\n${JSON.stringify(message)}`);
				return;
			}

			const { id, username, first_name } = message.from;
			const client = this.clients.get(id);
			if (!client) {
				wrn(
					`Unauthorized access attempt from @${
						username || first_name
					} (${id})!`
				);
				return;
			}

			const text =
				message.text ||
				[message.audio?.performer, message.audio?.title]
					.filter(x => x)
					.join(" - ");

			if (!text) return;

			this.call("deleteMessage", {
				chat_id: id,
				message_id: message.message_id
			});

			if (text[0] == "/") await client.onCommand(text.slice(1));
			else await client.onMessage(text);
		} else if (data["my_chat_member"]) {
			const member = data["my_chat_member"];
			if (!is<IChatMember>(member)) {
				wrn(`Unkown member recieved!\n${JSON.stringify(member)}`);
				return;
			}
			if (member.new_chat_member.status !== "administrator") return;

			const { id, title } = member.chat;
			const client = await this.check(id);
			if (!client) {
				wrn(`Unauthorized "${title}" (${id}) playlist access!`);
				await this.call("leaveChat", { chat_id: id });
				return;
			}

			const { description } = await this.call("getChat", { chat_id: id });
			await client.onChat(id, title, description);
		} else if (data["channel_post"]) {
			const post = data["channel_post"];
			if (!is<IPost>(post)) {
				wrn(`Unkown post recieved!\n${JSON.stringify(post)}`);
				return;
			}

			const { id, title } = post.chat;
			const text = post.text;
			const audio = [post.audio?.performer, post.audio?.title]
				.filter(x => x)
				.join(" - ");

			const client = await this.check(id);
			if (!client) return;

			if (text?.includes(`@${this.username}`)) {
				this.call("deleteMessage", {
					chat_id: id,
					message_id: post.message_id
				});

				await client.onTagged(title);
			} else if (audio) {
				const file = post.audio?.file_id || post.document?.file_id;
				await client.onPost(audio, title, file);
			}
		} else if (data["callback_query"]) {
			const query = data["callback_query"];
			if (!is<IQuery>(query)) {
				wrn(`Unkown post recieved!\n${JSON.stringify(query)}`);
				return;
			}

			const { id, username, first_name } = query.from;
			const client = this.clients.get(id);
			if (!client) {
				wrn(
					`Unauthorized access attempt from @${
						username || first_name
					} (${id})!`
				);
				return;
			}

			this.call("answerCallbackQuery", {
				callback_query_id: query.id
			}).catch(() => {});
			try {
				const parsed = JSON.parse(query.data);
				assertType<ICallbackData>(parsed);
				await client.onCallback(parsed, query.message.message_id, id);
			} catch {
				//Ignore errors here
			}
		}
	}
}

export interface ICallbackData {
	type: string;
	arg?: string;
}

interface IMessage {
	from: { id: number; username?: string; first_name: string };
	message_id: number;
	text?: string;
	audio?: { performer?: string; title: string };
}

interface IChatMember {
	new_chat_member: { status: string };
	chat: { id: number; title: string };
}

interface IPost {
	chat: { id: number; title: string };
	message_id: number;
	text?: string;
	audio?: { performer?: string; title: string; file_id?: string };
	document?: { file_id?: string };
}

interface IQuery {
	id: string;
	from: { id: number; username?: string; first_name: string };
	message: { message_id: number };
	data: string;
}
