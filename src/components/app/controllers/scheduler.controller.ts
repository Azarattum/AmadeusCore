import { IComponentOptions } from "../../common/component.interface";
import Controller from "../../common/controller.abstract";
import Tenant from "../models/tenant";

/**
 * Schedules user's trigger events
 */
export default class Scheduler extends Controller<"triggered">() {
	public tenant: Tenant;
	private hour: number;
	private timeout?: number;

	public static get relations(): object[] {
		return Tenant.tenants;
	}

	public constructor(args: IComponentOptions) {
		super(args);
		this.tenant = args.relation as Tenant;
		this.hour = this.tenant.hour;
		this.schedule();
	}

	public trigger(playlists?: string[]): void {
		this.emit("triggered", playlists);
		this.schedule();
	}

	private schedule(): void {
		clearTimeout(this.timeout);

		const offset = new Date().getTimezoneOffset() / 60;
		const hour = 1000 * 60 * 60;
		const day = hour * 24;
		const now = Date.now();

		let target = now - (now % day) + (this.hour + offset) * hour;
		if (target <= now) target += day;

		this.timeout = +setTimeout(this.trigger.bind(this), target - now);
	}
}
