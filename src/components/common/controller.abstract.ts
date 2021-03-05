/* eslint @typescript-eslint/explicit-function-return-type: 0 */
import { IComponent, IComponentOptions } from "./component.interface";
import Exposer from "./exposer.class";
import Utils from "./utils.class";

/**
 * Event-driven controller generic type builder
 */
export default function Controller<T extends string>() {
	/**
	 * Abstract of the controller class
	 */
	abstract class Controller implements IComponent {
		/**Component type */
		public static type: string = "Controllers";
		/**Controller universal unique id */
		public readonly uuid: string;
		/**Controller name */
		public readonly name: string;
		/**Callbacks storage */
		private callbacks: { [type: string]: Function[] } = {};
		/**Exposer object */
		private exposer: Exposer;
		/**Relation reference */
		private relation: object | null;

		/**
		 * Creates controller class
		 */
		public constructor({ exposer, relation }: IComponentOptions) {
			this.uuid = Utils.generateID();
			this.name = this.constructor.name;
			this.exposer = exposer;
			this.relation = relation || null;
		}

		/**
		 * No relations
		 */
		public static get relations(): object[] | null {
			return null;
		}

		/**
		 * Closes the controller
		 */
		public close(): void {
			//Close the controller
			this.callbacks = {};
			this.exposer.close(this.name.toLowerCase(), this.relation);
		}

		/**
		 * Listens to a specified event in the controller
		 * @param type Event type
		 * @param callback Callback function
		 */
		public on(type: T, callback: Function): void {
			if (!(type in this.callbacks)) this.callbacks[type] = [];
			this.callbacks[type].push(callback);
		}

		/**
		 * Calls all the registered event listeners in the controller
		 * @param type Event type
		 * @param args Arguments to pass to callbacks
		 */
		protected emit(type: T, ...args: any[]): void {
			if (this.callbacks[type]) {
				this.callbacks[type].forEach(x => x.call(x, ...args));
			}
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

			this.exposer.expose(
				this.name.toLowerCase(),
				name,
				exposed,
				this.relation
			);
		}
	}

	//Return controller with specific typings
	return Controller;
}
