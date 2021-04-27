import { IComponent, IComponentType } from "./component.interface";
import { log, LogType } from "./utils.class";
import Exposer from "./exposer.class";

/**
 * Application base class
 */
export default abstract class Application {
	/**Whether to log out initialization status */
	public logging: boolean = true;
	/**Application components */
	protected components: IComponent[];
	/**Configuration for componets initialization */
	protected configs: Map<IComponentType, any[]>;
	/**Application initialization state */
	private initialized = false;
	/**Application's exposer object */
	private readonly exposer: Exposer;
	/**Components types */
	private readonly types: IComponentType[];
	/**Relation map for dynamic components */
	private readonly relations: Map<IComponent, obj | null>;
	/**Handlers map for each component type */
	private readonly handlers: Map<IComponentType, ((self: any) => void)[]>;
	/**Timeout id for debouncing refresh calls */
	private refresher: any;

	/**
	 * Creates an application with components
	 * @param components Application components
	 * @param options Application options
	 */
	public constructor(
		components: IComponentType[],
		{
			scope = globalThis,
			configs = new Map(),
			logging = true
		}: IApplicationOptions = {}
	) {
		this.components = [];
		this.configs = configs;
		this.logging = logging;
		this.types = components;
		this.handlers = new Map();
		this.relations = new Map();
		this.refresher = undefined;
		this.exposer = new Exposer(scope);

		this.registerHandlers();

		const typesOrder = ["Services", "Views", "Controllers"];
		this.types.sort(
			(a, b) => typesOrder.indexOf(a.type) - typesOrder.indexOf(b.type)
		);

		for (const component of this.types) {
			const relations = component.relations;
			if (Array.isArray(relations)) {
				relations.forEach(async relation => {
					await this.registerComponent(component, relation);
				});
			} else {
				this.registerComponent(component);
			}
		}
	}

	/**
	 * Initializes all components
	 */
	public async initialize(
		...configs: [IComponentType, ...any[]][]
	): Promise<void> {
		let exceptions = 0;
		if (this.logging) log("Initializtion started...");
		//Apply configs
		configs.forEach(x => {
			this.configs.set(x.shift().valueOf(), x);
		});

		let lastType = "";
		//Initialize all components
		for (const component of this.components) {
			const type =
				component instanceof Promise
					? (await component).constructor.type
					: (component.constructor as IComponentType).type;

			if (this.logging && type != lastType) {
				log(type, LogType.DIVIDER);
				lastType = type;
			}

			exceptions += 1 * +!(await this.initializeComponent(component));
		}

		this.initialized = true;
		if (this.refresher === -1) this.refresh();

		//Log result
		if (!this.logging) return;
		log("", LogType.DIVIDER);
		if (exceptions) {
			log(
				`Initialization completed with ${exceptions} exceptions!`,
				LogType.WARNING
			);
		} else {
			log("Successfyly initialized!", LogType.OK);
		}
	}

	/**
	 * Looks for changed relations of components and updates them accordingly
	 */
	public refresh(): void {
		if (!this.initialized) {
			this.refresher = -1;
			return;
		}

		clearTimeout(this.refresher);
		this.refresher = setTimeout(() => {
			if (this.logging) log("Refreshing components...");

			//Find all the relevant relations
			const relations: Map<IComponentType, obj[]> = new Map();
			this.types.forEach(type => {
				let array: obj[] | null | undefined = relations.get(type);
				if (array === undefined) {
					array = type.relations;
					if (array == null) return;
					relations.set(type, array);
				}
			});

			const before = this.components.length;
			//Filter non relevant components
			this.components = this.components.filter((component, i) => {
				const relation = this.relations.get(component);
				if (!relation) return true;
				const array = relations.get(
					component.constructor as IComponentType
				);
				if (!array) return true;

				const index = array.indexOf(relation);
				//Component exists on its relation, remove from array
				if (index > -1) {
					array.splice(index, 1);
				}
				//Component's relation no longer exists, remove component
				else {
					this.relations.delete(component);
					component.close?.();
					return false;
				}

				return true;
			});
			const after = this.components.length;
			if (this.logging && before != after) {
				log(`${before - after} composents were closed!`, LogType.OK);
			}

			//Create missing components
			relations.forEach((relations, type) => {
				relations.forEach(async relation => {
					const component = this.registerComponent(type, relation);
					if (component) this.initializeComponent(component);
				});
			});
		});
	}

	/**
	 * Closes all the components
	 */
	public async close(): Promise<void> {
		if (!this.initialized) return;
		if (this.logging) {
			log("", LogType.DIVIDER);
			log("Closing all components...");
		}

		let exceptions = 0;
		const promises = [];
		for (const component of this.components) {
			try {
				if (component.close) {
					promises.push(component.close());
				}

				if (this.logging) {
					log(`${component.name} closed!`, LogType.OK);
				}
			} catch (exception) {
				if (this.logging) {
					log(
						`${component.name} closing exception:\n\t` +
							`${exception.stack.replace(/\n/g, "\n\t")}`,
						LogType.ERROR
					);
				}
				exceptions++;
			}
		}

		this.initialized = false;
		await Promise.all(promises);

		//Log result
		if (!this.logging) return;
		log("", LogType.DIVIDER);

		if (exceptions) {
			log(`Stopped with ${exceptions} exceptions!`, LogType.WARNING);
		} else {
			log("Successfyly stopped!", LogType.OK);
		}
	}

	/**
	 * Returns the first component by the type
	 * @param type Component's type
	 */
	protected getComponent<T extends IComponent>(
		type: IComponentType<T> | { name: string; prototype: T },
		relation?: obj
	): T {
		const component = this.components.find(
			component =>
				component instanceof (type.valueOf() as any) &&
				(!relation || (component as any).relation === relation)
		);

		if (!component) {
			throw new Error(`${type.name} component could not be found!`);
		}

		return component as T;
	}

	/**
	 * Returns components by the type
	 * @param type Component's type
	 */
	protected getComponents<T extends IComponent>(
		type: IComponentType<T> | { name: string; prototype: T },
		relation?: obj
	): T[] {
		return this.components.filter(
			component =>
				component instanceof (type.valueOf() as any) &&
				(!relation || (component as any).relation === relation)
		) as T[];
	}

	/**
	 * Performs full initialization of a component. This includes
	 * resolving promises, calling handlers and a call to inner method
	 * @param component Component to initialize
	 */
	private async initializeComponent(component: IComponent): Promise<boolean> {
		try {
			//Resolve promised component
			if (component instanceof Promise) {
				const index = this.components.indexOf(component);
				const relation = this.relations.get(component);
				const value = await component;

				if (relation) this.relations.set(value, relation);
				this.relations.delete(component);
				this.components[index] = value;
				component = value;
			}

			//Call all component's handlers
			let target = component.constructor as any;
			do {
				const handlers = this.handlers.get(target);
				if (handlers) {
					handlers.forEach(handler => {
						handler(component);
					});
				}
			} while ((target = target.__proto__));

			//Initialize the component with its config
			const args =
				this.configs.get(component.constructor as IComponentType) || [];
			if (component.initialize) {
				await component.initialize(...args);
			}

			//Log result
			if (!this.logging) return true;
			log(`${component.name} initialized!`, LogType.OK);
			return true;
		} catch (exception) {
			//Log error
			if (!this.logging) return false;
			log(
				`${component.name} initialization exception:\n\t` +
					`${exception.stack.replace(/\n/g, "\n\t")}`,
				LogType.ERROR
			);
			return false;
		}
	}

	/**
	 * Creates a new component and adds it to components list
	 * @param component Component type
	 * @param relation Component's relation object
	 */
	private registerComponent(
		component: IComponentType,
		relation?: obj
	): IComponent | null {
		try {
			const created = new component({
				refresh: this.refresh.bind(this),
				exposer: this.exposer,
				relation: relation || null
			});
			if (relation) this.relations.set(created, relation);

			this.components.push(created);
			return created;
		} catch (exception) {
			if (!this.logging) return null;

			log(
				`${component.name} creation exception:\n\t` +
					`${exception.stack.replace(/\n/g, "\n\t")}`,
				LogType.ERROR
			);
			return null;
		}
	}

	/**
	 * This is a placeholder method for registering handlers.
	 * Its content will be extended by `@handle` decorators
	 */
	private registerHandlers(): void {
		//Method's implementation is handled by decorators
	}
}

/**
 * Registers the method below as a handler of a specific component type.
 * It will be called after a creation of any component of this type, but
 * before its initializtion. The main use case is events registration
 * @param type Component type to handle
 */
export function handle<T extends IComponent>(
	type: IComponentType<T> | { name: string; prototype: T }
) {
	return function(
		target: Application,
		_: string,
		descriptor: TypedPropertyDescriptor<(self: T) => any>
	): any {
		if (!descriptor.value) return;
		type = type.valueOf() as any;
		const handler = descriptor.value;

		const original = target["registerHandlers"];
		target["registerHandlers"] = function(...args): any {
			let handlers = this["handlers"].get(type as any);
			if (!handlers) handlers = [];
			handlers.push(handler.bind(this));
			this["handlers"].set(type as any, handlers);
			return original.bind(this)(...args);
		};
	};
}

/**
 * Application options interface
 */
export interface IApplicationOptions {
	/**Component configuration map */
	configs?: Map<IComponentType, any[]>;

	/**Scope for an exposer */
	scope?: Record<string, any>;

	/**Whether to log application output */
	logging?: boolean;
}
