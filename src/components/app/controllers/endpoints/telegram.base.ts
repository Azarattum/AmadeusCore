import { log, LogType, sleep } from "../../../common/utils.class";
import Form from "../../models/form";
import Tenant from "../../models/tenant";
import Endpoint from "./endpoint.abstract";
import AbortController from "abort-controller";

export default abstract class TelegramBase extends Endpoint {
	protected abstract client: number;

	protected abstract onMessage(message: string): void;
	protected abstract onCommand(command: string): void;
	protected abstract onChat(
		id: number,
		title: string,
		description?: string
	): void;

	private static url: string;
	private static inited = false;
	private static clients: Map<number, TelegramBase> = new Map();
	private static abortController: AbortController;

	public static get relations(): Tenant[] {
		return Tenant.tenants.filter(x => x.telegram);
	}

	protected static async call(
		method: string,
		params: Record<string, any> = {},
		abortController?: AbortController
	): Promise<Response> {
		const mixedAbort = new AbortController();
		this.abortController.signal.addEventListener("abort", (): void => {
			mixedAbort.abort();
		});
		abortController?.signal.addEventListener("abort", (): void => {
			mixedAbort.abort();
		});

		return fetch(this.url + method, {
			method: "POST",
			headers: Form.headers,
			body: new Form(params),
			signal: mixedAbort.signal
		}).catch(e => {
			return {
				status: 503,
				text: (): string => e.toString(),
				json: () => null,
				ok: false
			} as any;
		});
	}

	protected static initialize(token: string, instance: TelegramBase): void {
		this.clients.set(instance.client, instance);
		if (this.inited) return;
		this.url = "https://api.telegram.org/bot" + token + "/";
		this.abortController = new AbortController();
		this.inited = true;
		this.subscribe();
	}

	protected static close(): void {
		this.inited = false;
		this.abortController.abort();
	}

	private static async subscribe(offset = 0): Promise<void> {
		if (!this.inited) return;
		const response = await this.call("getUpdates", {
			offset,
			timeout: 30
		});
		if (!this.inited) return;

		//Timeout
		if (response.status == 502) {
			this.subscribe(offset);
			return;
		}
		//Error
		if (response.status != 200) {
			log(
				`Error code ${
					response.status
				} recieved on polling\n${await response.text()}`,
				LogType.ERROR
			);

			sleep(1000);
			this.subscribe(offset);
			return;
		}

		//Update
		const updates = (await response.json())["result"];
		if (!Array.isArray(updates)) {
			log(`Unknown update data ${updates} recieved!`, LogType.ERROR);

			await sleep(1000);
			this.subscribe(offset);
			return;
		}

		for (const update of updates) {
			this.update(update);
			offset = Math.max(offset, update["update_id"] + 1);
		}
		this.subscribe(offset);
	}

	private static async check(channel: number): Promise<TelegramBase | null> {
		const adminsInfo = await this.call("getChatAdministrators", {
			chat_id: channel
		});

		const admins = (await adminsInfo.json())["result"];
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
			const sender = message["from"]?.["id"];
			const name = message["from"]?.["username"];
			if (!+sender) return;
			const client = this.clients.get(+sender);
			if (!client) {
				log(
					`Unauthorized access attempt from @${name} (${sender})!`,
					LogType.WARNING
				);
				return;
			}

			const text =
				message["text"] ||
				[message.audio.performer, message.audio.title]
					.filter(x => x)
					.join(" - ");

			if (!text) return;

			if (text[0] == "/") client.onCommand(text.slice(1));
			else client.onMessage(text);

			this.call("deleteMessage", {
				chat_id: sender,
				message_id: message["message_id"]
			});
		} else if (data["my_chat_member"]) {
			const update = data["my_chat_member"];
			const member = update["new_chat_member"];
			const chat = update.chat.id;
			const title = update.chat.title;

			if (!member) return;
			if (member.status === "left") return;

			const chatInfo = await this.call("getChat", { chat_id: chat });

			const client = await this.check(chat);
			const info = (await chatInfo.json())["result"];
			if (client) {
				client.onChat(chat, title, info.description);
				return;
			}

			await this.call("leaveChat", { chat_id: chat });
			log(
				`Unauthorized "${title}" (${chat}) playlist access!`,
				LogType.WARNING
			);
		} else if (data["channel_post"]) {
			const post = data["channel_post"];
			const chat = post.chat?.id;
			const text = post.text;

			if (!chat) return;
			if (!text || text[0] !== "/") return;

			const client = await this.check(chat);
			if (!client) return;

			client.onCommand(text.slice(1));

			this.call("deleteMessage", {
				chat_id: chat,
				message_id: post["message_id"]
			});
		}
	}
}
