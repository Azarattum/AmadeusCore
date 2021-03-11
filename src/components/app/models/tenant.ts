import { createHash } from "crypto";
import { readFileSync } from "fs";

export default class Tenant {
	private static cache: Tenant[] | null;

	private token: string;
	public identifier: string;
	public telegram: number;

	public constructor(tenant: ITenant) {
		this.identifier = tenant.identifier;
		this.telegram = +tenant.telegram;
		this.token = tenant.token;
	}

	public authenticate(password: string): boolean {
		const hash = createHash("sha1")
			.update(password)
			.digest("base64");

		return hash === this.token ? true : false;
	}

	public static get tenants(): Tenant[] {
		if (this.cache) return this.cache;
		const text = readFileSync("data/tenants.json").toString();
		const data = JSON.parse(text).map((x: ITenant) => new Tenant(x));
		this.cache = data;
		return data;
	}

	public static fromIdentiefier(value: string): Tenant {
		const tenant = this.tenants.find(x => x.identifier === value);
		if (!tenant) throw new Error("Trying to access unknown tenant!");
		return tenant;
	}

	public static fromTelegram(id: number): Tenant {
		const tenant = this.tenants.find(x => x.telegram === id);
		if (!tenant) throw new Error("Trying to access unknown tenant!");
		return tenant;
	}

	public static fromCredentials(
		login: string,
		password: string
	): Tenant | null {
		try {
			const tenant = this.fromIdentiefier(login);
			return tenant.authenticate(password) ? tenant : null;
		} catch {
			return null;
		}
	}
}

interface ITenant {
	identifier: string;
	telegram: string;
	token: string;
}
