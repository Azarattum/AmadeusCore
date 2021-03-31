/* eslint @typescript-eslint/explicit-function-return-type: 0 */
import { IComponent } from "./component.interface";
import Utils from "./utils.class";

/**
 * Event-driven service generic type builder
 */
export default function Service<T extends string>() {
	/**
	 * Abstract of the service class
	 */
	abstract class Service implements IComponent {
		/**Component type */
		public static type: string = "Services";
		/**Service universal unique id */
		public readonly uuid: string;
		/**Service name */
		public readonly name: string;
		/**Event resolution callback */
		private resolve: Function | -1;
		/**Events queue */
		private events: { type: T; args: any[] }[];
		/**Map to all exposed functions */
		private exposed: Map<string, Function>;

		/**
		 * Creates service class
		 */
		public constructor() {
			this.uuid = Utils.generateID();
			this.name = this.constructor.name;
			this.exposed = new Map();
			this.resolve = -1;
			this.events = [];
		}

		/**
		 * No relations
		 */
		public static get relations(): null {
			return null;
		}

		/**
		 * Calls all the registered event listeners in the service
		 * @param type Event type
		 * @param args Arguments to pass to callbacks
		 */
		protected emit(type: T, ...args: any[]): void {
			if (this.resolve !== -1) {
				this.resolve({ type, args });
				this.resolve = -1;
				return;
			}

			this.events.push({ type, args });
		}

		/**
		 * Returns a promise of the next emitted event.
		 * Used by proxy wrapper, should not be used anywhere else!
		 */
		private async listen(): Promise<{ type: T; args: any[] }> {
			const event = new Promise<{ type: T; args: any[] }>(resolve => {
				const event = this.events.shift();
				if (event) {
					resolve(event);
					return;
				}
				this.resolve = resolve;
			});

			return event;
		}

		/**
		 * Calls function by its id from exposed list.
		 * Used by proxy wrapper, should not be used anywhere else!
		 * @param id Exposed function unique id
		 * @param args Call arguments
		 */
		private async call(id: string, ...args: any[]): Promise<any> {
			const func = this.exposed.get(id);
			if (func) return func(...args);
		}

		/**
		 * Exposes function to be used in global window scope.
		 * Either a custom function can be provided or a method
		 * of current service class (the names must match)
		 * @param name Name of the exposed function (in the scope of service)
		 * @param func Exposed function
		 */
		protected expose(name: string, func: Function | null = null): void {
			const exposed =
				func || ((this as any)[name] as Function).bind(this);
			const id =
				name +
				"_" +
				new Array(4)
					.fill(0)
					.map(() =>
						Math.floor(
							Math.random() * Number.MAX_SAFE_INTEGER
						).toString(16)
					)
					.join("-");

			this.exposed.set(id, exposed);
			this.emit("__exposed" as any, name, id);
		}

		/**
		 * Listens to a specified event in the service
		 * @param type Event type
		 * @param callback Callback function
		 */
		public on(type: T, callback: Function): void {
			//Functionality will be taken by wrapper
		}

		/**
		 * Closes the service
		 */
		public async close() {
			this.exposed.clear();
			this.resolve = -1;
			this.events = [];

			if ((self as any).ports) {
				for (const port of (self as any).ports) {
					port.close();
				}
				(self as any).ports = [];
			}
		}
	}

	//Return service with specific typings
	return Service;
}
