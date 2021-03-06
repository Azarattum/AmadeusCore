import { createHash } from "crypto";
import { readFileSync } from "fs";
import { err } from "../../common/utils.class";

export default class Tenant {
  private static cache: Tenant[] | null;

  private token: string;
  public identifier: string;
  public telegram: number;
  public hour: number;
  public batch: number;

  public constructor(tenant: TenantData) {
    this.identifier = tenant.identifier;
    this.telegram = +tenant.telegram;
    this.token = tenant.token;
    this.hour = +(tenant?.hour || 6);
    this.batch = +(tenant?.batch || 100);
  }

  public authenticate(password: string): boolean {
    const hash = createHash("sha1").update(password).digest("base64");

    return hash === this.token ? true : false;
  }

  public static get tenants(): Tenant[] {
    if (this.cache) return this.cache;
    try {
      const reserved = ["cache", "dummy"];

      const text = readFileSync("data/tenants.json").toString();
      const data = [] as Tenant[];
      for (const x of JSON.parse(text) as TenantData[]) {
        const name = x.identifier.toLowerCase();
        if (data.some((y) => y.identifier.toLowerCase() === name)) {
          err(`Dublicate identifiers ("${name}") are not allowed!`);
          continue;
        }
        if (reserved.includes(name)) {
          err(`Tenant identifier "${x.identifier}" is not allowed!`);
          continue;
        }
        data.push(new Tenant(x));
      }

      this.cache = data;
      return data;
    } catch {
      return [];
    }
  }

  public static fromIdentiefier(value: string): Tenant {
    const tenant = this.tenants.find(
      (x) => x.identifier.toLowerCase() === value.toLowerCase()
    );
    if (!tenant) throw new Error("Trying to access unknown tenant!");
    return tenant;
  }

  public static fromTelegram(id: number): Tenant {
    const tenant = this.tenants.find((x) => x.telegram === id);
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

interface TenantData {
  identifier: string;
  telegram: string;
  token: string;
  batch?: string;
  hour?: string;
}
