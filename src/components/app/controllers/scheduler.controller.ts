import { ComponentOptions } from "../../common/component.interface";
import Controller from "../../common/controller.abstract";
import Tenant from "../models/tenant";

/**
 * Schedules user's trigger events
 */
export default class Scheduler extends Controller<
  ["triggered", (playlists: string[] | undefined) => void]
>() {
  public tenant: Tenant;
  private hour: number;
  private timeout?: NodeJS.Timeout;

  public static get relations(): obj[] {
    return Tenant.tenants;
  }

  public constructor(args: ComponentOptions) {
    super(args);
    this.tenant = args.relation as Tenant;
    this.hour = this.tenant.hour;
  }

  public initialize() {
    this.schedule();
  }

  public close(): void {
    if (this.timeout) clearTimeout(this.timeout);
  }

  public trigger(playlists?: string[]): void {
    this.emit("triggered", playlists);
    this.schedule();
  }

  private schedule(): void {
    if (this.timeout) clearTimeout(this.timeout);

    const offset = new Date().getTimezoneOffset() / 60;
    const hour = 1000 * 60 * 60;
    const day = hour * 24;
    const now = Date.now();

    let target = now - (now % day) + (this.hour + offset) * hour;
    while (target <= now) target += day;

    this.timeout = setTimeout(this.trigger.bind(this), target - now);
  }
}
