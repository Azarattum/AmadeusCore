import Exposer from "./exposer.class";

/**
 * Component interface
 */
export interface IComponent {
	/**Initializable name */
	name: string;

	/**Initializable entry */
	initialize?(...args: any[]): void;

	/**Component destructor */
	close?(): void;
}

/**
 * Component type interface
 */
export interface IComponentType<T extends IComponent = IComponent> {
	/**Component type */
	type: string;

	/**Component constructor */
	new (options: IComponentOptions): T;

	/**Component relations */
	relations: obj[] | null;
}

/**
 * Component's constructor options interface
 */
export interface IComponentOptions {
	/**Exposer object to use within component */
	exposer?: Exposer;

	/**Component's relation */
	relation?: obj | null;

	/**Application refresh callback */
	refresh?: () => void;
}

/**
 * Bindable event with name
 */
export type EventBase = [string, func] | string;
/**
 * Name of a bindable event
 */
export type EventName<T extends EventBase> = T extends string ? T : T[0];
/**
 * Callback of a bindable event
 */
export type EventFunc<T extends EventBase> = T extends string ? func : T[1];
/**
 * Resulting type of the event's callback
 */
export type EventResult<T extends EventBase> = ReturnType<
	T[1] extends func ? T[1] : any
>;

/**
 * Exposes function with `this.expose()` of current component.
 * The default name (macthes method's name) is used when `@expose`, `@expose()`.
 * Custom name can be specified with `@expose("<name>")`
 * @param name Custom name for an exposed function
 */
export function expose(...args: any[]): any {
	let name: string = "";
	const decorator = function (
		target: IComponent & { expose: (name: string, func: func) => void },
		key: string,
		descriptor: PropertyDescriptor
	): void {
		name = name || key;
		const original = target.initialize;
		target.initialize = function (...args: any[]): any {
			const func = descriptor.value?.bind(this);
			if (func) this.expose?.(name, func);

			return original?.bind(this)?.(...args);
		};
	};

	if (args.length == 0 || (args.length == 1 && typeof args[0] === "string")) {
		name = args.length ? args[0] : null;
		return decorator;
	} else if (args.length === 3) {
		return decorator(args[0], args[1], args[2]);
	}
}
